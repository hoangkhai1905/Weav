#!/usr/bin/env python3
"""Test helpers: in-test RSA key pairs, JWKS files, and Service JWT minting."""

from __future__ import annotations

import json
import time
import uuid
from pathlib import Path
from typing import Any

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from jwt.algorithms import RSAAlgorithm

WORKSPACE_ID = "11111111-2222-3333-4444-555555555555"


def make_key() -> rsa.RSAPrivateKey:
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def write_jwks(path: Path, key: rsa.RSAPrivateKey, kid: str) -> str:
    jwk = json.loads(RSAAlgorithm.to_jwk(key.public_key()))
    jwk.update(kid=kid, alg="RS256", use="sig")
    path.write_text(json.dumps({"keys": [jwk]}), encoding="utf-8")
    return str(path)


def mint(
    key: Any,
    kid: str | None,
    issuer: str,
    *,
    algorithm: str = "RS256",
    drop: tuple[str, ...] = (),
    **overrides: Any,
) -> str:
    """Mint a token; defaults form a valid token for ``issuer`` (workflow or gateway)."""
    now = int(time.time())
    claims: dict[str, Any] = {
        "iss": issuer,
        "aud": "weav-ocr",
        "scope": "ocr:extract",
        "mode": "execution" if issuer == "weav-workflow" else "preview",
        "workspace_id": WORKSPACE_ID,
        "iat": now,
        "exp": now + 60,
        "jti": str(uuid.uuid4()),
    }
    if issuer == "weav-workflow":
        claims["execution_id"] = str(uuid.uuid4())
        claims["node_execution_id"] = str(uuid.uuid4())
    claims.update(overrides)
    for name in drop:
        claims.pop(name, None)
    headers = {"kid": kid} if kid else {}
    return jwt.encode(claims, key, algorithm=algorithm, headers=headers)
