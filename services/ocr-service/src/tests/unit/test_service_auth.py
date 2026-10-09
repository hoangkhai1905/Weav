#!/usr/bin/env python3
"""Unit tests for Service JWT verification and the URL allowlist wiring."""

from __future__ import annotations

import time
import uuid
import warnings
from pathlib import Path

import jwt
import pytest

warnings.filterwarnings("ignore", category=DeprecationWarning)

from starlette.testclient import TestClient

from src.api.dependencies import create_extract_text_use_case, get_extract_text_use_case
from src.main import app
from src.tests.unit.service_jwt_helpers import WORKSPACE_ID, make_key, mint, write_jwks
from src.tests.unit.test_http_api import FakeExtractTextUseCase

WF, GW = "weav-workflow", "weav-api-gateway"


@pytest.fixture
def keys(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    wf_key, gw_key = make_key(), make_key()
    wf_path = write_jwks(tmp_path / "wf.json", wf_key, "workflow-dev-1")
    gw_path = write_jwks(tmp_path / "gw.json", gw_key, "gateway-dev-1")
    monkeypatch.setenv("OCR_TRUSTED_ISSUERS", f"{WF}={wf_path},{GW}={gw_path}")
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("OCR_ALLOW_UNAUTHENTICATED_DEV", raising=False)
    return wf_key, gw_key


@pytest.fixture
def use_case():
    fake = FakeExtractTextUseCase()
    app.dependency_overrides[get_extract_text_use_case] = lambda: fake
    yield fake
    app.dependency_overrides.clear()


@pytest.fixture
def post(use_case):
    def _post(token: str | None = None, **headers: str):
        hdrs = {"X-Request-ID": str(uuid.uuid4()), **headers}
        if token:
            hdrs["Authorization"] = f"Bearer {token}"
        with TestClient(app) as client:
            return client.post(
                "/v1/extractions",
                json={"source": {"type": "artifact", "artifactId": str(uuid.uuid4())}},
                headers=hdrs,
            )

    return _post


def test_workflow_token_accepted_and_workspace_from_claim(keys, post, use_case) -> None:
    resp = post(mint(keys[0], "workflow-dev-1", WF))
    assert resp.status_code == 200
    assert str(use_case.received_request.workspace_id) == WORKSPACE_ID


def test_matching_workspace_header_accepted(keys, post) -> None:
    resp = post(mint(keys[0], "workflow-dev-1", WF), **{"X-Workspace-ID": WORKSPACE_ID.upper()})
    assert resp.status_code == 200


def test_gateway_preview_token_accepted(keys, post) -> None:
    assert post(mint(keys[1], "gateway-dev-1", GW)).status_code == 200


def test_audience_list_accepted(keys, post) -> None:
    assert post(mint(keys[0], "workflow-dev-1", WF, aud=["weav-ocr"])).status_code == 200


@pytest.mark.parametrize(
    "build",
    [
        pytest.param(lambda k: mint(make_key(), "workflow-dev-1", WF), id="bad-signature"),
        pytest.param(lambda k: mint(k[0], "unknown-kid", WF), id="unknown-kid"),
        pytest.param(lambda k: mint(k[0], None, WF), id="missing-kid"),
        pytest.param(lambda k: mint(k[1], "gateway-dev-1", WF), id="issuer-bound-to-other-key"),
        pytest.param(lambda k: mint(k[0], "workflow-dev-1", "evil-issuer"), id="unknown-issuer"),
        pytest.param(
            lambda k: mint(k[0], "workflow-dev-1", WF, drop=("execution_id",)),
            id="missing-execution-id",
        ),
        pytest.param(lambda k: mint(k[0], "workflow-dev-1", WF, drop=("jti",)), id="missing-jti"),
        pytest.param(
            lambda k: mint(k[0], "workflow-dev-1", WF, workspace_id="nope"),
            id="bad-workspace-uuid",
        ),
        pytest.param(
            lambda k: mint(
                k[0], "workflow-dev-1", WF, iat=int(time.time()) - 300, exp=int(time.time()) - 200
            ),
            id="expired",
        ),
        pytest.param(
            lambda k: mint(k[0], "workflow-dev-1", WF, exp=int(time.time()) + 121),
            id="lifetime-too-long",
        ),
        pytest.param(
            lambda k: mint("x" * 32, "workflow-dev-1", WF, algorithm="HS256"), id="hs256"
        ),
        pytest.param(
            lambda k: jwt.encode({"iss": WF}, None, algorithm="none", headers={"kid": "workflow-dev-1"}),
            id="alg-none",
        ),
        pytest.param(lambda k: "not-a-jwt", id="garbage"),
    ],
)
def test_invalid_tokens_are_401(keys, post, build) -> None:
    resp = post(build(keys))
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "UNAUTHENTICATED"
    assert "eyJ" not in resp.text


@pytest.mark.parametrize(
    "overrides",
    [{"aud": "someone-else"}, {"scope": "other:scope"}, {"mode": "preview"}],
    ids=["wrong-aud", "wrong-scope", "wrong-mode-for-workflow"],
)
def test_wrong_aud_scope_mode_are_403(keys, post, overrides) -> None:
    resp = post(mint(keys[0], "workflow-dev-1", WF, **overrides))
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "FORBIDDEN"


def test_gateway_token_with_execution_mode_is_403(keys, post) -> None:
    assert post(mint(keys[1], "gateway-dev-1", GW, mode="execution")).status_code == 403


def test_workspace_header_mismatch_is_403(keys, post) -> None:
    resp = post(mint(keys[0], "workflow-dev-1", WF), **{"X-Workspace-ID": str(uuid.uuid4())})
    assert resp.status_code == 403


def test_no_header_with_dev_bypass_is_allowed(keys, post, monkeypatch) -> None:
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("OCR_ALLOW_UNAUTHENTICATED_DEV", "true")
    assert post().status_code == 200


def test_dev_bypass_still_verifies_a_sent_token(keys, post, monkeypatch) -> None:
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("OCR_ALLOW_UNAUTHENTICATED_DEV", "true")
    assert post("garbage").status_code == 401


def test_no_header_without_bypass_is_401(keys, post) -> None:
    assert post().status_code == 401


def test_issuers_unset_fails_closed(keys, post, monkeypatch) -> None:
    token = mint(keys[0], "workflow-dev-1", WF)
    monkeypatch.delenv("OCR_TRUSTED_ISSUERS")
    assert post(token).status_code == 401


def test_missing_jwks_file_fails_closed(keys, post, monkeypatch) -> None:
    monkeypatch.setenv("OCR_TRUSTED_ISSUERS", f"{WF}=/nonexistent/jwks.json")
    assert post(mint(keys[0], "workflow-dev-1", WF)).status_code == 401


def test_url_allowlist_env_reaches_fetcher(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OCR_URL_ALLOWLIST", "files.example.com, .cdn.example.org")
    policy = create_extract_text_use_case().url_fetcher.policy
    assert policy.is_allowed("files.example.com", "/a.pdf")
    assert policy.is_allowed("x.cdn.example.org", "/a.pdf")
    assert not policy.is_allowed("evil.com", "/a.pdf")
    monkeypatch.delenv("OCR_URL_ALLOWLIST")
    assert not create_extract_text_use_case().url_fetcher.policy.is_allowed(
        "files.example.com", "/a.pdf"
    )
