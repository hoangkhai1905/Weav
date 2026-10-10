#!/usr/bin/env python3
"""Service JWT verification for the private /v1/extractions ingress.

Implements ServiceJwtAuth from packages/contracts/http/ocr/openapi.yaml:
RS256 only, explicit ``kid``, per-issuer JWKS, fixed audience/scope, per-issuer mode,
and a maximum token lifetime. Tenant context comes from the verified ``workspace_id``
claim; ``X-Workspace-ID`` is only compared against it, never trusted.

Environment:
- OCR_TRUSTED_ISSUERS: comma-separated ``issuer=/path/to/jwks.json`` pairs. Each issuer is
  bound to its own key set. Unset or empty means no token is accepted (fail closed).
- APP_ENV=development + OCR_ALLOW_UNAUTHENTICATED_DEV=true: requests *without* an
  Authorization header are allowed. A header that is sent is always verified.
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from functools import lru_cache
from typing import Any

import jwt
from jwt import PyJWK

from src.domain.errors import ForbiddenError, UnauthenticatedError

logger = logging.getLogger(__name__)

AUDIENCE = "weav-ocr"
SCOPE = "ocr:extract"
MAX_LIFETIME_SECONDS = 120
LEEWAY_SECONDS = 30
ALGORITHMS = ["RS256"]

# issuer -> required token mode. Workflow execution tokens also need execution ids.
_ISSUER_MODES = {"weav-workflow": "execution", "weav-api-gateway": "preview"}
_REQUIRED_CLAIMS = ["iss", "aud", "scope", "mode", "workspace_id", "iat", "exp", "jti"]


def is_dev_auth_bypass_enabled() -> bool:
    """Check whether local development unauthenticated access is explicitly enabled."""
    app_env = os.environ.get("APP_ENV", "").strip().lower()
    allow_unauth_dev = (
        os.environ.get("OCR_ALLOW_UNAUTHENTICATED_DEV", "").strip().lower()
    )
    return app_env == "development" and allow_unauth_dev == "true"


def _trusted_issuers() -> dict[str, str]:
    """Parse OCR_TRUSTED_ISSUERS into {issuer: jwks_path}."""
    pairs: dict[str, str] = {}
    for item in os.environ.get("OCR_TRUSTED_ISSUERS", "").split(","):
        issuer, sep, path = item.partition("=")
        if sep and issuer.strip() and path.strip():
            pairs[issuer.strip()] = path.strip()
    return pairs


@lru_cache(maxsize=16)
def _read_jwks(path: str, mtime_ns: int) -> dict[str, PyJWK]:
    """Parse a JWKS file into {kid: key}; ``mtime_ns`` only keys the cache so rotations reload."""
    with open(path, encoding="utf-8") as handle:
        document = json.load(handle)
    keys: dict[str, PyJWK] = {}
    for entry in document.get("keys", []):
        kid = entry.get("kid")
        if isinstance(kid, str) and entry.get("kty") == "RSA":
            keys[kid] = PyJWK(entry)
    return keys


def _load_keys(issuer: str, path: str) -> dict[str, PyJWK]:
    """Load an issuer's keys; any failure is logged without key material and yields no keys."""
    try:
        return _read_jwks(path, os.stat(path).st_mtime_ns)
    except (OSError, ValueError, TypeError, AttributeError, jwt.PyJWTError) as exc:  # fail closed
        logger.warning(
            "OCR trusted issuer JWKS unavailable issuer=%s path=%s error=%s",
            issuer,
            path,
            type(exc).__name__,
        )
        return {}


def _parse_uuid(value: Any) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        return None


def verify_service_jwt(token: str) -> tuple[uuid.UUID, dict[str, Any]]:
    """Verify a Service JWT and return (workspace_id, claims).

    Raises UnauthenticatedError for an invalid/expired token and ForbiddenError for a valid
    token whose audience, scope, or mode does not permit OCR extraction.
    """
    try:
        header = jwt.get_unverified_header(token)
        unverified = jwt.decode(token, options={"verify_signature": False})
    except jwt.PyJWTError:
        raise UnauthenticatedError("Invalid service token") from None

    kid = header.get("kid")
    issuer = unverified.get("iss")
    if header.get("alg") not in ALGORITHMS or not isinstance(kid, str) or not kid:
        raise UnauthenticatedError("Invalid service token")
    path = _trusted_issuers().get(issuer) if isinstance(issuer, str) else None
    key = _load_keys(issuer, path).get(kid) if path else None
    if key is None or issuer not in _ISSUER_MODES:
        raise UnauthenticatedError("Invalid service token")

    try:
        # aud is checked below so a wrong audience is 403 rather than 401.
        claims = jwt.decode(
            token,
            key.key,
            algorithms=ALGORITHMS,
            issuer=issuer,
            leeway=LEEWAY_SECONDS,
            options={"require": _REQUIRED_CLAIMS, "verify_aud": False},
        )
    except jwt.ExpiredSignatureError:
        raise UnauthenticatedError("Service token expired") from None
    except jwt.PyJWTError:
        raise UnauthenticatedError("Invalid service token") from None

    workspace_id = _parse_uuid(claims["workspace_id"])
    jti = claims["jti"]
    if (
        workspace_id is None
        or not isinstance(jti, str)
        or not jti
        or not isinstance(claims["iat"], int | float)
        or claims["exp"] - claims["iat"] > MAX_LIFETIME_SECONDS
    ):
        raise UnauthenticatedError("Invalid service token")

    audience = claims["aud"]
    audiences = [audience] if isinstance(audience, str) else audience
    scope = claims["scope"]
    if (
        not isinstance(audiences, list)
        or AUDIENCE not in audiences
        or not isinstance(scope, str)
        or SCOPE not in scope.split()
        or claims["mode"] != _ISSUER_MODES[issuer]
    ):
        raise ForbiddenError("Service token not permitted for this operation")

    if issuer == "weav-workflow" and not (
        _parse_uuid(claims.get("execution_id"))
        and _parse_uuid(claims.get("node_execution_id"))
    ):
        raise UnauthenticatedError("Invalid service token")

    return workspace_id, claims


def authenticate_request(
    authorization: str | None, workspace_header: str | None
) -> uuid.UUID | str | None:
    """Authenticate the caller and return the workspace context for the use case.

    With a verified token the workspace is the ``workspace_id`` claim; a differing
    X-Workspace-ID header is rejected with 403. Without any Authorization header the
    development bypass (header-supplied workspace) applies only when explicitly enabled.
    """
    if not authorization:
        if not is_dev_auth_bypass_enabled():
            raise UnauthenticatedError("Authentication required")
        if not workspace_header:
            return None
        return _parse_uuid(workspace_header) or workspace_header

    parts = authorization.split()
    if len(parts) != 2 or parts[0] != "Bearer" or not parts[1].strip():
        raise UnauthenticatedError("Invalid authorization scheme; Bearer token required")

    workspace_id, _ = verify_service_jwt(parts[1])
    if workspace_header and _parse_uuid(workspace_header) != workspace_id:
        raise ForbiddenError("X-Workspace-ID does not match the service token")
    return workspace_id
