#!/usr/bin/env python3
"""Domain models for OCR extraction requests.

Strictly framework-independent (no FastAPI or Paddle imports).
Enforces single-source validation, language options, and table detection settings.
"""

from __future__ import annotations

import re
import uuid
from typing import Any, Literal
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, field_validator

from src.domain.errors import InvalidRequestError

LanguageOption = Literal["vi", "en", "vi+en"]
SUPPORTED_LANGUAGES = {"vi", "en", "vi+en"}


class BaseDomainModel(BaseModel):
    """Base domain model forbidding undeclared fields to prevent schema leakage."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class UploadSource(BaseDomainModel):
    """Document source originating from a streamed/chunked direct client upload."""

    model_config = ConfigDict(extra="forbid", arbitrary_types_allowed=True, populate_by_name=True)

    type: Literal["upload"] = "upload"
    stream: Any = Field(..., description="Async or sync stream/iterable of chunk bytes")
    filename: str = Field(default="document.bin", description="Sanitized client basename")
    content_type: str | None = Field(default=None, description="Client-declared MIME type if provided")

    @field_validator("filename")
    @classmethod
    def sanitize_client_filename(cls, v: str) -> str:
        if not v or not v.strip():
            return "document.bin"
        # Strip path separators and null bytes to eliminate path traversal attacks
        cleaned = re.sub(r'[\/\\:\*\?"<>\|\x00]', "_", v.strip())
        cleaned = re.sub(r"^\.+", "", cleaned)  # strip leading dots (.e.g ../)
        if not cleaned:
            return "document.bin"
        return cleaned[:255]


class ArtifactSource(BaseDomainModel):
    """Document source referencing a workflow artifact stored in workflow storage."""

    type: Literal["artifact"] = "artifact"
    artifact_id: uuid.UUID = Field(..., alias="artifactId", description="UUID of workflow storage artifact")

    @field_validator("artifact_id", mode="before")
    @classmethod
    def parse_uuid(cls, v: Any) -> uuid.UUID:
        if isinstance(v, uuid.UUID):
            return v
        try:
            return uuid.UUID(str(v))
        except (ValueError, AttributeError, TypeError):
            raise InvalidRequestError(f"Invalid artifactId UUID format: '{v}'")


class UrlSource(BaseDomainModel):
    """Document source referencing an external HTTPS document URL."""

    type: Literal["url"] = "url"
    file_url: str = Field(..., alias="fileUrl", description="Approved HTTPS URL for document retrieval")

    @field_validator("file_url")
    @classmethod
    def validate_url_syntax(cls, v: str) -> str:
        if not isinstance(v, str) or not v.strip():
            raise InvalidRequestError("fileUrl must be a non-empty string")
        if len(v) > 4096:
            raise InvalidRequestError("fileUrl exceeds maximum length of 4096 characters")
        parsed = urlparse(v)
        if parsed.scheme != "https":
            raise InvalidRequestError("fileUrl must use the https:// scheme")
        if not parsed.hostname:
            raise InvalidRequestError("fileUrl must contain a valid hostname")
        try:
            port = parsed.port
        except ValueError as exc:
            raise InvalidRequestError("fileUrl must contain a valid port") from exc
        if port not in (None, 443):
            raise InvalidRequestError("fileUrl must use port 443")
        if parsed.username or parsed.password:
            raise InvalidRequestError("fileUrl must not contain userinfo credentials")
        if parsed.fragment:
            raise InvalidRequestError("fileUrl must not contain URL fragments")
        return v


class OcrRequest(BaseDomainModel):
    """Generic OCR extraction request representing exactly one source and normalized options."""

    model_config = ConfigDict(extra="forbid", arbitrary_types_allowed=True, populate_by_name=True)

    request_id: uuid.UUID = Field(default_factory=uuid.uuid4, alias="requestId")
    workspace_id: uuid.UUID | str | None = Field(default=None, alias="workspaceId")
    source: UploadSource | ArtifactSource | UrlSource
    language: LanguageOption = "vi+en"
    detect_tables: bool = Field(default=True, alias="detectTables")

    @field_validator("language", mode="before")
    @classmethod
    def validate_language_option(cls, v: Any) -> str:
        if not isinstance(v, str) or v not in SUPPORTED_LANGUAGES:
            raise InvalidRequestError(
                f"Invalid language option '{v}'. Supported languages: {', '.join(sorted(SUPPORTED_LANGUAGES))}"
            )
        return str(v)

    @field_validator("detect_tables", mode="before")
    @classmethod
    def coerce_detect_tables(cls, v: Any) -> bool:
        if isinstance(v, bool):
            return v
        if isinstance(v, str):
            lower = v.strip().lower()
            if lower in ("true", "1", "yes"):
                return True
            if lower in ("false", "0", "no"):
                return False
            raise InvalidRequestError(f"Invalid boolean value for detectTables: '{v}'")
        if isinstance(v, int):
            if v in (0, 1):
                return bool(v)
            raise InvalidRequestError(f"Invalid boolean value for detectTables: '{v}'")
        raise InvalidRequestError(f"Invalid type for detectTables: {type(v).__name__}")


def validate_single_source(
    upload_stream: Any | None = None,
    filename: str | None = None,
    source_payload: dict[str, Any] | None = None,
    language: str = "vi+en",
    detect_tables: bool | str = True,
    workspace_id: uuid.UUID | str | None = None,
    request_id: uuid.UUID | str | None = None,
) -> OcrRequest:
    """Validate that exactly one source is present and build a validated OcrRequest.

    Raises:
        InvalidRequestError: When multiple sources are supplied, or no source is supplied,
                             or options/syntax are invalid.
    """
    req_uuid: uuid.UUID
    if request_id is None:
        req_uuid = uuid.uuid4()
    elif isinstance(request_id, uuid.UUID):
        req_uuid = request_id
    else:
        try:
            req_uuid = uuid.UUID(str(request_id))
        except (ValueError, TypeError):
            raise InvalidRequestError(f"Invalid requestId format: '{request_id}'")

    has_upload = upload_stream is not None
    has_json = source_payload is not None

    # Reject mixed file + source JSON
    if has_upload and has_json:
        raise InvalidRequestError(
            "Multiple document sources provided. Request cannot contain both uploaded file and JSON source"
        )

    if not has_upload and not has_json:
        raise InvalidRequestError("Exactly one document source (upload, artifact, or url) must be provided")

    source: UploadSource | ArtifactSource | UrlSource

    if has_upload:
        source = UploadSource(
            stream=upload_stream,
            filename=filename or "document.bin",
        )
    else:
        assert source_payload is not None
        allowed_top_level = {"source", "language", "detectTables", "detect_tables"}
        if "source" not in source_payload:
            allowed_top_level = {
                "type",
                "artifactId",
                "artifact_id",
                "fileUrl",
                "file_url",
                "language",
                "detectTables",
                "detect_tables",
            }
        unknown_top_level = set(source_payload) - allowed_top_level
        if unknown_top_level:
            raise InvalidRequestError(
                f"Unsupported request fields: {', '.join(sorted(unknown_top_level))}"
            )

        # Extract inner 'source' object if wrapped in top-level JSON request
        raw_source = source_payload.get("source", source_payload)
        if not isinstance(raw_source, dict):
            raise InvalidRequestError("Malformed source descriptor: expected JSON object")

        allowed_source_fields = {"type", "artifactId", "artifact_id", "fileUrl", "file_url"}
        unknown_source_fields = set(raw_source) - allowed_source_fields
        if unknown_source_fields:
            raise InvalidRequestError(
                f"Unsupported source fields: {', '.join(sorted(unknown_source_fields))}"
            )

        # Reject mixed artifact and url in single source object
        has_art = "artifactId" in raw_source or "artifact_id" in raw_source
        has_url = "fileUrl" in raw_source or "file_url" in raw_source
        if has_art and has_url:
            raise InvalidRequestError("Multiple source descriptors inside source JSON: contains both artifact and url")

        source_type = raw_source.get("type")
        if source_type == "artifact" or (source_type is None and has_art):
            art_id = raw_source.get("artifactId") or raw_source.get("artifact_id")
            if not art_id:
                raise InvalidRequestError("Missing artifactId for artifact source")
            source = ArtifactSource(artifactId=art_id)
        elif source_type == "url" or (source_type is None and has_url):
            url_val = raw_source.get("fileUrl") or raw_source.get("file_url")
            if not url_val:
                raise InvalidRequestError("Missing fileUrl for url source")
            source = UrlSource(fileUrl=url_val)
        else:
            raise InvalidRequestError(f"Unrecognized or unsupported source type: '{source_type}'")

        # Top-level options may override in JSON payload
        if "language" in source_payload:
            language = source_payload["language"]
        if "detectTables" in source_payload:
            detect_tables = source_payload["detectTables"]
        elif "detect_tables" in source_payload:
            detect_tables = source_payload["detect_tables"]

    # Validate language option
    if not isinstance(language, str) or language not in SUPPORTED_LANGUAGES:
        raise InvalidRequestError(
            f"Invalid language option '{language}'. Supported: {', '.join(sorted(SUPPORTED_LANGUAGES))}"
        )

    return OcrRequest(
        requestId=req_uuid,
        workspaceId=workspace_id,
        source=source,
        language=language,  # type: ignore[arg-type]
        detectTables=detect_tables,  # type: ignore[arg-type]
    )
