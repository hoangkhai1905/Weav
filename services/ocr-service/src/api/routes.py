#!/usr/bin/env python3
"""HTTP API routes for the OCR Service conforming to packages/contracts/http/ocr/openapi.yaml."""

from __future__ import annotations

import contextlib
import os
import uuid

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from starlette.datastructures import UploadFile

from src.api.dependencies import get_extract_text_use_case
from src.application.use_cases.extract_text_use_case import ExtractTextUseCase
from src.domain.errors import (
    InvalidRequestError,
    UnauthenticatedError,
)
from src.domain.models.ocr_request import validate_single_source

router = APIRouter(tags=["extractions"])


def is_dev_auth_bypass_enabled() -> bool:
    """Check whether local development unauthenticated access is explicitly enabled."""
    app_env = os.environ.get("APP_ENV", "").strip().lower()
    allow_unauth_dev = (
        os.environ.get("OCR_ALLOW_UNAUTHENTICATED_DEV", "").strip().lower()
    )
    return app_env == "development" and allow_unauth_dev == "true"


def verify_authorization(authorization: str | None) -> None:
    """Require Bearer authorization unless APP_ENV=development AND OCR_ALLOW_UNAUTHENTICATED_DEV=true."""
    if is_dev_auth_bypass_enabled() and not authorization:
        return

    if not authorization:
        raise UnauthenticatedError("Authentication required")

    parts = authorization.split()
    if len(parts) != 2 or parts[0] != "Bearer" or not parts[1].strip():
        raise UnauthenticatedError(
            "Invalid authorization scheme; Bearer token required"
        )


def resolve_request_id(request: Request) -> tuple[uuid.UUID, bool]:
    """Extract and validate client-provided X-Request-ID or generate a new UUID."""
    raw_header = request.headers.get("X-Request-ID")
    if raw_header is not None:
        try:
            return uuid.UUID(raw_header), True
        except (ValueError, TypeError, AttributeError):
            return uuid.uuid4(), False
    return uuid.uuid4(), True


@router.post("/v1/extractions", response_model=None)
async def extract_ocr(
    request: Request,
    use_case: ExtractTextUseCase = Depends(get_extract_text_use_case),  # noqa: B008
) -> JSONResponse:
    """Private service extraction endpoint accepting multipart/form-data or application/json."""
    # 1. Resolve and validate X-Request-ID
    req_id, is_valid_req_id = resolve_request_id(request)
    request.state.request_id = req_id

    if not is_valid_req_id:
        raise InvalidRequestError("Invalid X-Request-ID header: must be a valid UUID")

    # 2. Enforce Bearer authorization
    auth_header = request.headers.get("authorization")
    verify_authorization(auth_header)

    # 3. Extract and propagate X-Workspace-ID
    workspace_header = request.headers.get("X-Workspace-ID")
    workspace_id: uuid.UUID | str | None = None
    if workspace_header:
        try:
            workspace_id = uuid.UUID(workspace_header)
        except (ValueError, TypeError):
            workspace_id = workspace_header

    # 4. Check Content-Type header
    content_type = request.headers.get("content-type", "").lower()
    if not content_type.startswith(("multipart/form-data", "application/json")):
        raise InvalidRequestError(
            f"Unsupported Content-Type '{request.headers.get('content-type', '')}'. "
            "Must be multipart/form-data or application/json"
        )

    # 5. Parse request body
    if content_type.startswith("multipart/form-data"):
        try:
            form = await request.form()
        except Exception as exc:
            raise InvalidRequestError("Malformed multipart/form-data request") from exc

        file_item = form.get("file")
        if file_item is None or not isinstance(file_item, UploadFile):
            raise InvalidRequestError("Multipart request must include a 'file' field")

        with contextlib.suppress(OSError, AttributeError):
            file_item.file.seek(0)

        language_val = form.get("language")
        if language_val is None or language_val == "":
            language_val = "vi+en"

        detect_tables_val = form.get("detectTables")
        if detect_tables_val is None or detect_tables_val == "":
            detect_tables_val = True

        ocr_request = validate_single_source(
            upload_stream=file_item.file,
            filename=file_item.filename or "document.bin",
            language=str(language_val),
            detect_tables=detect_tables_val,
            workspace_id=workspace_id,
            request_id=req_id,
        )

    else:
        try:
            payload = await request.json()
        except Exception as exc:
            raise InvalidRequestError("Malformed JSON syntax in request body") from exc

        if not isinstance(payload, dict):
            raise InvalidRequestError("JSON request payload must be a JSON object")

        if "source" not in payload and not any(
            k in payload for k in ("artifactId", "artifact_id", "fileUrl", "file_url")
        ):
            raise InvalidRequestError("Missing required 'source' field in JSON request")

        ocr_request = validate_single_source(
            source_payload=payload,
            workspace_id=workspace_id,
            request_id=req_id,
        )

    # 6. Execute use case
    result = await use_case.execute(ocr_request)

    # 7. Return contract response with serialized aliases and echoed X-Request-ID
    return JSONResponse(
        status_code=200,
        content=result.model_dump(by_alias=True, mode="json"),
        headers={"X-Request-ID": str(req_id)},
    )
