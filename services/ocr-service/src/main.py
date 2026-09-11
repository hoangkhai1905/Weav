#!/usr/bin/env python3
"""FastAPI composition root for Weav OCR Service."""

from __future__ import annotations

import logging
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

from src.api.dependencies import create_extract_text_use_case, set_extract_text_use_case
from src.api.routes import resolve_request_id, router
from src.domain.errors import (
    InternalError,
    InvalidRequestError,
    OcrDomainError,
)

logger = logging.getLogger("weav.ocr.main")


def get_request_id(request: Request) -> uuid.UUID:
    """Retrieve or generate correlation request ID safely."""
    req_id = getattr(request.state, "request_id", None)
    if isinstance(req_id, uuid.UUID):
        return req_id
    req_id, _ = resolve_request_id(request)
    request.state.request_id = req_id
    return req_id


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Wire real infrastructure adapters at application startup."""
    use_case = create_extract_text_use_case()
    set_extract_text_use_case(use_case)
    yield
    set_extract_text_use_case(None)


app = FastAPI(
    title="Weav OCR Service",
    version="1.0.0",
    description="HTTP API for Weav OCR document extraction",
    docs_url="/docs",
    redoc_url=None,
    openapi_url="/openapi.json",
    lifespan=lifespan,
)


@app.exception_handler(OcrDomainError)
async def ocr_domain_error_handler(
    request: Request, exc: OcrDomainError
) -> JSONResponse:
    """Map OcrDomainError to the sanitized contract error envelope."""
    request_id = get_request_id(request)
    headers = {"X-Request-ID": str(request_id)}
    return JSONResponse(
        status_code=exc.status_code,
        content=exc.to_envelope(request_id),
        headers=headers,
    )


@app.exception_handler(RequestValidationError)
@app.exception_handler(ValidationError)
async def validation_exception_handler(
    request: Request, exc: Exception
) -> JSONResponse:
    """Map Pydantic and request validation failures to sanitized INVALID_REQUEST envelope."""
    request_id = get_request_id(request)
    headers = {"X-Request-ID": str(request_id)}
    error = InvalidRequestError("Invalid extraction request")
    return JSONResponse(
        status_code=400,
        content=error.to_envelope(request_id),
        headers=headers,
    )


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(
    request: Request, exc: StarletteHTTPException
) -> JSONResponse:
    """Map Starlette HTTP exceptions to the canonical error envelope."""
    request_id = get_request_id(request)
    headers = {"X-Request-ID": str(request_id)}

    if exc.status_code == 401:
        code = "UNAUTHENTICATED"
    elif exc.status_code == 403:
        code = "FORBIDDEN"
    elif exc.status_code == 404:
        code = "ARTIFACT_NOT_FOUND"
    elif exc.status_code == 413:
        code = "FILE_TOO_LARGE"
    elif exc.status_code == 415:
        code = "UNSUPPORTED_MEDIA_TYPE"
    else:
        code = "INVALID_REQUEST"

    envelope = {
        "error": {
            "code": code,
            "message": str(exc.detail) if exc.detail else "HTTP request error",
            "retryable": False,
            "details": {},
        },
        "requestId": str(request_id),
    }
    return JSONResponse(
        status_code=exc.status_code,
        content=envelope,
        headers=headers,
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Catch-all for unhandled exceptions, strictly preventing tracebacks/paths from leaking."""
    request_id = get_request_id(request)
    headers = {"X-Request-ID": str(request_id)}
    error = InternalError("An internal error occurred while processing the document")
    return JSONResponse(
        status_code=500,
        content=error.to_envelope(request_id),
        headers=headers,
    )


app.include_router(router)
