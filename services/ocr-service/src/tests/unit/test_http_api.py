#!/usr/bin/env python3
"""Unit tests for the FastAPI private HTTP ingress (/v1/extractions).

Tests HTTP boundary behaviors:
- multipart upload forwards file stream, language, detectTables, and request/workspace context to the use case;
- JSON source request supports artifactId/fileUrl;
- generated or echoed X-Request-ID;
- missing bearer auth outside development is rejected;
- explicit APP_ENV=development plus OCR_ALLOW_UNAUTHENTICATED_DEV=true permits local testing;
- OcrDomainError maps to the sanitized {error, requestId} envelope;
- malformed request/content type returns INVALID_REQUEST.
"""

from __future__ import annotations

import io
import uuid
import warnings
from typing import Any

import pytest

# Suppress Starlette testclient httpx deprecation warning
warnings.filterwarnings("ignore", category=DeprecationWarning)

from starlette.testclient import TestClient

from src.api.dependencies import get_extract_text_use_case
from src.domain.errors import (
    ArtifactNotFoundError,
    CorruptFileError,
    FileTooLargeError,
    InternalError,
    InvalidRequestError,
    OcrDomainError,
    TableExtractionFailedError,
    UnauthenticatedError,
)
from src.domain.models.ocr_request import (
    ArtifactSource,
    OcrRequest,
    UploadSource,
    UrlSource,
)
from src.domain.models.ocr_result import (
    BoundingBox,
    DocumentInfo,
    ExtractionMetadata,
    OcrExtractionResult,
    PageInfo,
    TextBlock,
    TextResult,
)
from src.main import app


def _build_dummy_extraction_result(request_id: uuid.UUID) -> OcrExtractionResult:
    """Construct a minimal valid OcrExtractionResult conforming to the contract schema."""
    return OcrExtractionResult(
        schemaVersion="1.0",
        requestId=request_id,
        document=DocumentInfo(
            fileName="document.png",
            mimeType="image/png",
            pages=1,
            pageInfo=[PageInfo(page=1, width=800, height=600, dpi=None)],
        ),
        text=TextResult(rawText="Contract text content"),
        confidence=0.98,
        blocks=[
            TextBlock(
                id="p1-b1",
                order=0,
                text="Contract text content",
                confidence=0.98,
                page=1,
                boundingBox=BoundingBox(x=10.0, y=20.0, width=200.0, height=30.0),
            )
        ],
        tables=[],
        metadata=ExtractionMetadata(
            language="vi+en",
            resolvedLanguage="latin-multilingual",
            processingTimeMs=35,
            engine="fake-paddleocr",
            engineVersion="3.7.0",
            modelRevision="test-manifest-v1",
            tableDetection="not_requested",
            quality="OK",
            preprocessing=[],
            warnings=[],
        ),
    )


class FakeExtractTextUseCase:
    """Test fake for ExtractTextUseCase at the HTTP boundary."""

    def __init__(
        self,
        result: OcrExtractionResult | None = None,
        error: Exception | None = None,
    ) -> None:
        self.call_count: int = 0
        self.received_request: OcrRequest | None = None
        self.result: OcrExtractionResult | None = result
        self.error: Exception | None = error

    async def execute(self, request: OcrRequest) -> OcrExtractionResult:
        self.call_count += 1
        self.received_request = request
        if self.error is not None:
            raise self.error
        if self.result is not None:
            return self.result.model_copy(update={"requestId": request.request_id})
        return _build_dummy_extraction_result(request.request_id)


@pytest.fixture
def fake_use_case() -> FakeExtractTextUseCase:
    return FakeExtractTextUseCase()


@pytest.fixture
def client(fake_use_case: FakeExtractTextUseCase) -> TestClient:
    app.dependency_overrides[get_extract_text_use_case] = lambda: fake_use_case
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def default_auth_headers() -> dict[str, str]:
    return {"Authorization": "Bearer test-service-jwt"}


# ===========================================================================
# 1. Multipart Upload
# ===========================================================================


class TestMultipartUpload:
    def test_multipart_upload_forwards_stream_options_and_context(
        self, client: TestClient, fake_use_case: FakeExtractTextUseCase, default_auth_headers: dict[str, str]
    ) -> None:
        """Multipart upload forwards file stream, language, detectTables, and workspace/request context."""
        req_id = str(uuid.uuid4())
        workspace_id = str(uuid.uuid4())
        file_bytes = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDRtestcontent"

        headers = {
            **default_auth_headers,
            "X-Request-ID": req_id,
            "X-Workspace-ID": workspace_id,
        }
        files = {
            "file": ("invoice.png", io.BytesIO(file_bytes), "image/png"),
        }
        data = {
            "language": "vi",
            "detectTables": "false",
        }

        response = client.post("/v1/extractions", headers=headers, files=files, data=data)

        assert response.status_code == 200
        assert response.headers.get("X-Request-ID") == req_id

        body = response.json()
        assert body["schemaVersion"] == "1.0"
        assert body["requestId"] == req_id
        assert body["text"]["rawText"] == "Contract text content"

        assert fake_use_case.call_count == 1
        req = fake_use_case.received_request
        assert req is not None
        assert isinstance(req.source, UploadSource)
        assert req.source.filename == "invoice.png"
        assert req.source.stream is not None

        if hasattr(req.source.stream, "seek"):
            req.source.stream.seek(0)
        if hasattr(req.source.stream, "read"):
            read_bytes = req.source.stream.read()
            assert read_bytes == file_bytes

        assert req.language == "vi"
        assert req.detect_tables is False
        assert str(req.workspace_id) == workspace_id
        assert str(req.request_id) == req_id

    def test_multipart_upload_default_options(
        self, client: TestClient, fake_use_case: FakeExtractTextUseCase, default_auth_headers: dict[str, str]
    ) -> None:
        """Multipart upload without language or detectTables uses default options ('vi+en', True)."""
        req_id = str(uuid.uuid4())
        workspace_id = str(uuid.uuid4())

        headers = {
            **default_auth_headers,
            "X-Request-ID": req_id,
            "X-Workspace-ID": workspace_id,
        }
        files = {
            "file": ("doc.png", io.BytesIO(b"\x89PNG\r\n\x1a\n"), "image/png"),
        }

        response = client.post("/v1/extractions", headers=headers, files=files)

        assert response.status_code == 200
        req = fake_use_case.received_request
        assert req is not None
        assert req.language == "vi+en"
        assert req.detect_tables is True


# ===========================================================================
# 2. JSON Source Requests (Artifact and URL)
# ===========================================================================


class TestJsonSourceRequests:
    def test_json_artifact_source_supports_artifact_id(
        self, client: TestClient, fake_use_case: FakeExtractTextUseCase, default_auth_headers: dict[str, str]
    ) -> None:
        """JSON request with artifactId forwards ArtifactSource to use case."""
        req_id = str(uuid.uuid4())
        workspace_id = str(uuid.uuid4())
        artifact_id = uuid.uuid4()

        headers = {
            **default_auth_headers,
            "X-Request-ID": req_id,
            "X-Workspace-ID": workspace_id,
        }
        payload = {
            "source": {
                "type": "artifact",
                "artifactId": str(artifact_id),
            },
            "language": "en",
            "detectTables": True,
        }

        response = client.post("/v1/extractions", headers=headers, json=payload)

        assert response.status_code == 200
        assert response.headers.get("X-Request-ID") == req_id

        assert fake_use_case.call_count == 1
        req = fake_use_case.received_request
        assert req is not None
        assert isinstance(req.source, ArtifactSource)
        assert req.source.artifact_id == artifact_id
        assert req.language == "en"
        assert req.detect_tables is True
        assert str(req.workspace_id) == workspace_id
        assert str(req.request_id) == req_id

    def test_json_url_source_supports_file_url(
        self, client: TestClient, fake_use_case: FakeExtractTextUseCase, default_auth_headers: dict[str, str]
    ) -> None:
        """JSON request with fileUrl forwards UrlSource to use case."""
        req_id = str(uuid.uuid4())
        workspace_id = str(uuid.uuid4())
        target_url = "https://files.internal.weav/contracts/document.pdf"

        headers = {
            **default_auth_headers,
            "X-Request-ID": req_id,
            "X-Workspace-ID": workspace_id,
        }
        payload = {
            "source": {
                "type": "url",
                "fileUrl": target_url,
            },
            "language": "vi+en",
            "detectTables": False,
        }

        response = client.post("/v1/extractions", headers=headers, json=payload)

        assert response.status_code == 200
        assert response.headers.get("X-Request-ID") == req_id

        assert fake_use_case.call_count == 1
        req = fake_use_case.received_request
        assert req is not None
        assert isinstance(req.source, UrlSource)
        assert req.source.file_url == target_url
        assert req.language == "vi+en"
        assert req.detect_tables is False


# ===========================================================================
# 3. X-Request-ID Behavior
# ===========================================================================


class TestRequestIdPropagation:
    def test_echoes_client_provided_x_request_id(
        self, client: TestClient, default_auth_headers: dict[str, str]
    ) -> None:
        """When client supplies a valid X-Request-ID, it is echoed in response header and body."""
        client_req_id = str(uuid.uuid4())
        headers = {
            **default_auth_headers,
            "X-Request-ID": client_req_id,
        }
        payload = {
            "source": {
                "type": "artifact",
                "artifactId": str(uuid.uuid4()),
            },
        }

        response = client.post("/v1/extractions", headers=headers, json=payload)

        assert response.status_code == 200
        assert response.headers.get("X-Request-ID") == client_req_id
        assert response.json()["requestId"] == client_req_id

    def test_generates_x_request_id_when_omitted(
        self, client: TestClient, fake_use_case: FakeExtractTextUseCase, default_auth_headers: dict[str, str]
    ) -> None:
        """When X-Request-ID is absent from request, service generates a valid UUID."""
        headers = {**default_auth_headers}
        payload = {
            "source": {
                "type": "artifact",
                "artifactId": str(uuid.uuid4()),
            },
        }

        response = client.post("/v1/extractions", headers=headers, json=payload)

        assert response.status_code == 200
        generated_id = response.headers.get("X-Request-ID")
        assert generated_id is not None
        parsed = uuid.UUID(generated_id)
        assert str(parsed) == generated_id
        assert response.json()["requestId"] == generated_id
        assert str(fake_use_case.received_request.request_id) == generated_id

    def test_rejects_malformed_x_request_id_with_400(
        self, client: TestClient, default_auth_headers: dict[str, str]
    ) -> None:
        """When X-Request-ID is not a valid UUID, returns 400 INVALID_REQUEST."""
        headers = {
            **default_auth_headers,
            "X-Request-ID": "not-a-valid-uuid-1234",
        }
        payload = {
            "source": {
                "type": "artifact",
                "artifactId": str(uuid.uuid4()),
            },
        }

        response = client.post("/v1/extractions", headers=headers, json=payload)

        assert response.status_code == 400
        body = response.json()
        assert body["error"]["code"] == "INVALID_REQUEST"
        assert "requestId" in body
        assert response.headers.get("X-Request-ID") is not None


# ===========================================================================
# 4. Authentication & Development Mode
# ===========================================================================


class TestAuthenticationAndDevBypass:
    def test_missing_bearer_auth_outside_dev_is_rejected(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Missing bearer authorization outside development environment returns 401 UNAUTHENTICATED."""
        monkeypatch.setenv("APP_ENV", "production")
        monkeypatch.delenv("OCR_ALLOW_UNAUTHENTICATED_DEV", raising=False)

        payload = {
            "source": {
                "type": "artifact",
                "artifactId": str(uuid.uuid4()),
            },
        }

        response = client.post("/v1/extractions", json=payload)

        assert response.status_code == 401
        body = response.json()
        assert body["error"]["code"] == "UNAUTHENTICATED"
        assert body["error"]["retryable"] is False
        assert "requestId" in body

    def test_invalid_bearer_auth_format_rejected(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Authorization header not starting with Bearer is rejected with 401."""
        monkeypatch.setenv("APP_ENV", "production")
        headers = {"Authorization": "Basic dXNlcjpwYXNz"}
        payload = {
            "source": {
                "type": "artifact",
                "artifactId": str(uuid.uuid4()),
            },
        }

        response = client.post("/v1/extractions", headers=headers, json=payload)

        assert response.status_code == 401
        body = response.json()
        assert body["error"]["code"] == "UNAUTHENTICATED"

    def test_dev_env_without_allow_unauthenticated_dev_still_rejected(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """APP_ENV=development alone without explicit OCR_ALLOW_UNAUTHENTICATED_DEV=true still rejects."""
        monkeypatch.setenv("APP_ENV", "development")
        monkeypatch.setenv("OCR_ALLOW_UNAUTHENTICATED_DEV", "false")

        payload = {
            "source": {
                "type": "artifact",
                "artifactId": str(uuid.uuid4()),
            },
        }

        response = client.post("/v1/extractions", json=payload)

        assert response.status_code == 401
        body = response.json()
        assert body["error"]["code"] == "UNAUTHENTICATED"

    def test_explicit_dev_mode_and_allow_unauthenticated_permits_request(
        self, client: TestClient, fake_use_case: FakeExtractTextUseCase, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Explicit APP_ENV=development plus OCR_ALLOW_UNAUTHENTICATED_DEV=true permits unauthenticated request."""
        monkeypatch.setenv("APP_ENV", "development")
        monkeypatch.setenv("OCR_ALLOW_UNAUTHENTICATED_DEV", "true")

        payload = {
            "source": {
                "type": "artifact",
                "artifactId": str(uuid.uuid4()),
            },
        }

        response = client.post("/v1/extractions", json=payload)

        assert response.status_code == 200
        assert fake_use_case.call_count == 1


# ===========================================================================
# 5. OcrDomainError Mapping & Sanitization
# ===========================================================================


class TestDomainErrorMapping:
    @pytest.mark.parametrize(
        ("error_factory", "expected_status", "expected_code"),
        [
            (
                lambda: FileTooLargeError("Document file size exceeds 10 MiB limit"),
                413,
                "FILE_TOO_LARGE",
            ),
            (
                lambda: ArtifactNotFoundError("Artifact not found in workspace"),
                404,
                "ARTIFACT_NOT_FOUND",
            ),
            (
                lambda: CorruptFileError("Document file is corrupted or unreadable"),
                422,
                "CORRUPT_FILE",
            ),
            (
                lambda: TableExtractionFailedError("Table extraction pipeline failed"),
                502,
                "TABLE_EXTRACTION_FAILED",
            ),
            (
                lambda: InvalidRequestError("Multiple document sources provided"),
                400,
                "INVALID_REQUEST",
            ),
        ],
    )
    def test_ocr_domain_error_maps_to_contract_error_envelope(
        self,
        client: TestClient,
        fake_use_case: FakeExtractTextUseCase,
        default_auth_headers: dict[str, str],
        error_factory: Any,
        expected_status: int,
        expected_code: str,
    ) -> None:
        """OcrDomainError maps to exact status code and sanitized ApiErrorEnvelope."""
        req_id = str(uuid.uuid4())
        domain_error = error_factory()
        fake_use_case.error = domain_error

        headers = {
            **default_auth_headers,
            "X-Request-ID": req_id,
        }
        payload = {
            "source": {
                "type": "artifact",
                "artifactId": str(uuid.uuid4()),
            },
        }

        response = client.post("/v1/extractions", headers=headers, json=payload)

        assert response.status_code == expected_status
        assert response.headers.get("X-Request-ID") == req_id

        body = response.json()
        assert body["requestId"] == req_id
        assert body["error"]["code"] == expected_code
        assert body["error"]["message"] == domain_error.message
        assert body["error"]["retryable"] == domain_error.retryable
        assert isinstance(body["error"]["details"], dict)

    def test_sanitized_error_envelope_never_leaks_traceback_or_paths(
        self, client: TestClient, fake_use_case: FakeExtractTextUseCase, default_auth_headers: dict[str, str]
    ) -> None:
        """Error responses must never leak stack traces, server file paths, or raw exception details."""
        req_id = str(uuid.uuid4())
        fake_use_case.error = InternalError("Unexpected engine crash at /app/src/internal/engine.py:42")

        headers = {
            **default_auth_headers,
            "X-Request-ID": req_id,
        }
        payload = {
            "source": {
                "type": "artifact",
                "artifactId": str(uuid.uuid4()),
            },
        }

        response = client.post("/v1/extractions", headers=headers, json=payload)

        assert response.status_code == 500
        body = response.json()
        assert "traceback" not in body
        assert "stack" not in body
        raw_text = response.text
        assert "Traceback (most recent call last)" not in raw_text
        assert 'File "' not in raw_text


# ===========================================================================
# 6. Malformed Requests and Content Types
# ===========================================================================


class TestMalformedRequests:
    def test_unsupported_content_type_returns_400_invalid_request(
        self, client: TestClient, default_auth_headers: dict[str, str]
    ) -> None:
        """Content types other than multipart/form-data and application/json return 400 INVALID_REQUEST."""
        req_id = str(uuid.uuid4())
        headers = {
            **default_auth_headers,
            "X-Request-ID": req_id,
            "Content-Type": "text/plain",
        }

        response = client.post("/v1/extractions", headers=headers, content=b"raw plain text")

        assert response.status_code == 400
        body = response.json()
        assert body["error"]["code"] == "INVALID_REQUEST"
        assert body["requestId"] == req_id

    def test_malformed_json_syntax_returns_400_invalid_request(
        self, client: TestClient, default_auth_headers: dict[str, str]
    ) -> None:
        """Syntactically invalid JSON payload returns 400 INVALID_REQUEST."""
        req_id = str(uuid.uuid4())
        headers = {
            **default_auth_headers,
            "X-Request-ID": req_id,
            "Content-Type": "application/json",
        }

        response = client.post("/v1/extractions", headers=headers, content=b'{"source": {unquoted}}')

        assert response.status_code == 400
        body = response.json()
        assert body["error"]["code"] == "INVALID_REQUEST"
        assert body["requestId"] == req_id

    def test_multipart_missing_file_part_returns_400_invalid_request(
        self, client: TestClient, default_auth_headers: dict[str, str]
    ) -> None:
        """Multipart form upload with no 'file' field returns 400 INVALID_REQUEST."""
        req_id = str(uuid.uuid4())
        headers = {
            **default_auth_headers,
            "X-Request-ID": req_id,
        }
        data = {
            "language": "vi",
            "detectTables": "true",
        }

        response = client.post("/v1/extractions", headers=headers, data=data)

        assert response.status_code == 400
        body = response.json()
        assert body["error"]["code"] == "INVALID_REQUEST"
        assert body["requestId"] == req_id

    def test_json_missing_source_field_returns_400_invalid_request(
        self, client: TestClient, default_auth_headers: dict[str, str]
    ) -> None:
        """JSON payload missing required 'source' field returns 400 INVALID_REQUEST."""
        req_id = str(uuid.uuid4())
        headers = {
            **default_auth_headers,
            "X-Request-ID": req_id,
        }
        payload = {
            "language": "vi+en",
            "detectTables": True,
        }

        response = client.post("/v1/extractions", headers=headers, json=payload)

        assert response.status_code == 400
        body = response.json()
        assert body["error"]["code"] == "INVALID_REQUEST"
        assert body["requestId"] == req_id

    def test_invalid_language_option_returns_400_invalid_request(
        self, client: TestClient, default_auth_headers: dict[str, str]
    ) -> None:
        """Unsupported language option returns 400 INVALID_REQUEST."""
        req_id = str(uuid.uuid4())
        headers = {
            **default_auth_headers,
            "X-Request-ID": req_id,
        }
        payload = {
            "source": {
                "type": "artifact",
                "artifactId": str(uuid.uuid4()),
            },
            "language": "french_unsupported",
        }

        response = client.post("/v1/extractions", headers=headers, json=payload)

        assert response.status_code == 400
        body = response.json()
        assert body["error"]["code"] == "INVALID_REQUEST"
        assert body["requestId"] == req_id

    def test_invalid_detect_tables_option_returns_400_invalid_request(
        self, client: TestClient, default_auth_headers: dict[str, str]
    ) -> None:
        """Invalid detectTables value in multipart form returns 400 INVALID_REQUEST."""
        req_id = str(uuid.uuid4())
        headers = {
            **default_auth_headers,
            "X-Request-ID": req_id,
        }
        files = {
            "file": ("test.png", io.BytesIO(b"\x89PNG\r\n\x1a\n"), "image/png"),
        }
        data = {
            "detectTables": "not_a_boolean_value",
        }

        response = client.post("/v1/extractions", headers=headers, files=files, data=data)

        assert response.status_code == 400
        body = response.json()
        assert body["error"]["code"] == "INVALID_REQUEST"
        assert body["requestId"] == req_id
