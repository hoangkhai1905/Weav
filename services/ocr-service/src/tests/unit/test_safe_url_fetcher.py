#!/usr/bin/env python3
"""Unit tests for safe URL fetcher, SSRF prevention, DNS pinning, and redirect blocking."""

from __future__ import annotations

import ipaddress
import socket
import ssl
from collections.abc import Callable
from pathlib import Path

import pytest

from src.domain.errors import (
    FileTooLargeError,
    SourceUnavailableError,
    SourceUrlNotAllowedError,
)
from src.infrastructure.files.bounded_spool import MAX_FILE_BYTES
from src.infrastructure.files.safe_url_fetcher import (
    DnsResolver,
    HttpResponseSeam,
    HttpTransportSeam,
    PinnedHttpsConnection,
    SafeUrlFetcher,
    UrlAllowlistPolicy,
    redact_url_secrets,
)

# ---------------------------------------------------------------------------
# Test Doubles for DNS Resolution and HTTP Transport
# ---------------------------------------------------------------------------


class FakeDnsResolver(DnsResolver):
    """In-memory DNS resolver enabling deterministic IP resolution testing."""

    def __init__(self, ip_map: dict[str, list[str]] | None = None) -> None:
        self.ip_map = ip_map or {}
        self.call_count = 0
        self.resolved_hosts: list[str] = []

    def resolve(self, host: str, port: int = 443) -> list[ipaddress.IPv4Address | ipaddress.IPv6Address]:
        self.call_count += 1
        self.resolved_hosts.append(host)
        if host in self.ip_map:
            return [ipaddress.ip_address(ip) for ip in self.ip_map[host]]
        # Default to a safe public IP (e.g. 93.184.216.34)
        return [ipaddress.ip_address("93.184.216.34")]


class FakeHttpResponse(HttpResponseSeam):
    """Configurable in-memory HTTP response."""

    def __init__(
        self,
        status_code: int = 200,
        headers: dict[str, str] | None = None,
        body_chunks: list[bytes] | None = None,
    ) -> None:
        self._status_code = status_code
        self._headers = {k.lower(): v for k, v in (headers or {}).items()}
        self._chunks = list(body_chunks or [])
        self.closed = False

    @property
    def status_code(self) -> int:
        return self._status_code

    @property
    def headers(self) -> dict[str, str]:
        return self._headers

    def read_chunk(self, chunk_size: int = 64 * 1024) -> bytes:
        if self._chunks:
            return self._chunks.pop(0)
        return b""

    def close(self) -> None:
        self.closed = True


class FakeHttpTransport(HttpTransportSeam):
    """In-memory HTTP transport recording connection calls and pinned IPs."""

    def __init__(
        self,
        handler: Callable[[str, str, str], HttpResponseSeam] | None = None,
    ) -> None:
        self.handler = handler
        self.call_count = 0
        self.calls: list[dict[str, str | int | float | dict]] = []

    def execute_request(
        self,
        method: str,
        host: str,
        pinned_ip: str,
        port: int,
        path_and_query: str,
        headers: dict[str, str],
        connect_timeout: float,
        read_timeout: float,
    ) -> HttpResponseSeam:
        self.call_count += 1
        self.calls.append({
            "method": method,
            "host": host,
            "pinned_ip": pinned_ip,
            "port": port,
            "path_and_query": path_and_query,
            "headers": headers,
            "connect_timeout": connect_timeout,
            "read_timeout": read_timeout,
        })
        if self.handler:
            return self.handler(host, pinned_ip, path_and_query)
        return FakeHttpResponse(status_code=200, body_chunks=[b"%PDF-1.4\n%%EOF\n"])


# ---------------------------------------------------------------------------
# Unit Tests: SSRF, DNS Pinning, and Fetch Policies
# ---------------------------------------------------------------------------


class TestSafeUrlFetcher:
    """Validates SSRF prevention, allowlist default-deny, DNS pinning, and redirect blocking."""

    @pytest.fixture
    def allowlist_policy(self) -> UrlAllowlistPolicy:
        return UrlAllowlistPolicy(
            allowed_domains={"files.example.com", "storage.weav.internal"},
            allowed_path_prefixes={"files.example.com": ["/approved/"]},
        )

    @pytest.mark.asyncio
    async def test_redirect_302_to_metadata_is_blocked_without_following(
        self, allowlist_policy: UrlAllowlistPolicy, tmp_path: Path
    ):
        """Allowlisted public hostname with a 302 redirect to 169.254.169.254 must NOT be followed."""
        dns = FakeDnsResolver({"files.example.com": ["93.184.216.34"]})

        # Handler returns a 302 redirect pointing to AWS metadata IP
        def redirect_handler(host: str, pinned_ip: str, path: str) -> HttpResponseSeam:
            return FakeHttpResponse(
                status_code=302,
                headers={"Location": "http://169.254.169.254/latest/meta-data/"},
            )

        transport = FakeHttpTransport(handler=redirect_handler)
        fetcher = SafeUrlFetcher(policy=allowlist_policy, dns_resolver=dns, transport=transport)

        with pytest.raises(SourceUrlNotAllowedError) as exc_info:
            await fetcher.fetch("https://files.example.com/approved/report.pdf", target_dir=tmp_path)

        err_msg = str(exc_info.value)
        assert "HTTP redirects are not permitted" in err_msg
        # Downstream metadata endpoint was NEVER requested
        assert transport.call_count == 1
        assert transport.calls[0]["pinned_ip"] == "93.184.216.34"
        assert not any("169.254.169.254" in str(c["host"]) for c in transport.calls)

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "unsafe_ip",
        [
            "127.0.0.1",           # IPv4 loopback
            "127.0.0.53",          # systemd-resolved loopback
            "10.0.0.1",            # RFC1918 Class A
            "172.16.5.10",         # RFC1918 Class B
            "192.168.1.1",         # RFC1918 Class C
            "169.254.169.254",     # Link-local / AWS metadata
            "0.0.0.0",             # Unspecified
            "::1",                 # IPv6 loopback
            "fc00::1",             # IPv6 unique local
            "fe80::1",             # IPv6 link-local
            "::ffff:127.0.0.1",    # IPv4-mapped IPv6 loopback
            "::ffff:169.254.169.254",  # IPv4-mapped IPv6 metadata
            "::ffff:10.0.0.5",     # IPv4-mapped IPv6 private
            "100.64.0.1",          # RFC6598 carrier-grade NAT
            "192.0.2.1",           # TEST-NET documentation range
            "2001:db8::1",         # IPv6 documentation range
        ],
    )
    async def test_dns_resolving_to_unsafe_address_is_blocked_before_connect(
        self, allowlist_policy: UrlAllowlistPolicy, tmp_path: Path, unsafe_ip: str
    ):
        """DNS rebinding / SSRF resolving to private or metadata addresses must be blocked before connect."""
        dns = FakeDnsResolver({"files.example.com": [unsafe_ip]})
        transport = FakeHttpTransport()
        fetcher = SafeUrlFetcher(policy=allowlist_policy, dns_resolver=dns, transport=transport)

        with pytest.raises(SourceUrlNotAllowedError) as exc_info:
            await fetcher.fetch("https://files.example.com/approved/data.pdf", target_dir=tmp_path)

        assert "forbidden private or restricted address" in str(exc_info.value)
        # Transport connection was NEVER attempted
        assert transport.call_count == 0

    @pytest.mark.asyncio
    async def test_dns_pinning_seam_proves_destination_ip_is_pinned(
        self, allowlist_policy: UrlAllowlistPolicy, tmp_path: Path
    ):
        """Verify the transport receives the exact resolved IP and host for SNI / TLS validation."""
        dns = FakeDnsResolver({"files.example.com": ["93.184.216.34"]})
        transport = FakeHttpTransport()
        fetcher = SafeUrlFetcher(policy=allowlist_policy, dns_resolver=dns, transport=transport)

        spooled = await fetcher.fetch(
            "https://files.example.com/approved/annual_report.pdf", target_dir=tmp_path
        )
        assert spooled.file_path.exists()
        assert transport.call_count == 1
        recorded = transport.calls[0]
        # Pinned destination IP matches the validated address
        assert recorded["pinned_ip"] == "93.184.216.34"
        # Host header / SNI retains the canonical domain
        assert recorded["host"] == "files.example.com"
        assert recorded["port"] == 443

    def test_real_pinned_connection_uses_validated_ip_and_tls_hostname(self, monkeypatch):
        """The concrete transport dials the checked IP and sends the original host to TLS."""
        calls: dict[str, object] = {}

        class FakeSocket:
            def close(self) -> None:
                calls["closed"] = True

        class FakeTlsContext:
            def wrap_socket(self, raw_socket: FakeSocket, server_hostname: str) -> FakeSocket:
                calls["raw_socket"] = raw_socket
                calls["server_hostname"] = server_hostname
                return raw_socket

        def fake_create_connection(address: tuple[str, int], timeout: float) -> FakeSocket:
            calls["address"] = address
            calls["timeout"] = timeout
            return FakeSocket()

        monkeypatch.setattr(socket, "create_connection", fake_create_connection)
        connection = PinnedHttpsConnection(
            host="files.example.com",
            pinned_ip="93.184.216.34",
            port=443,
            timeout=3.0,
            context=ssl.create_default_context(),
        )
        connection._context = FakeTlsContext()  # type: ignore[assignment]

        connection.connect()

        assert calls["address"] == ("93.184.216.34", 443)
        assert calls["server_hostname"] == "files.example.com"

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "bad_url,reason",
        [
            ("http://files.example.com/approved/doc.pdf", "scheme"),
            ("ftp://files.example.com/approved/doc.pdf", "scheme"),
            ("file:///etc/passwd", "scheme"),
            ("https://files.example.com:8443/approved/doc.pdf", "port"),
            ("https://user:password@files.example.com/approved/doc.pdf", "userinfo"),
            ("https://files.example.com/approved/doc.pdf#page=2", "fragment"),
            ("https://localhost/approved/doc.pdf", "localhost"),
            ("https://127.0.0.1/approved/doc.pdf", "literal"),
            ("https://169.254.169.254/approved/doc.pdf", "literal"),
            ("https://[::1]/approved/doc.pdf", "literal"),
            ("https://unauthorized-domain.com/doc.pdf", "allowlist"),
            ("https://files.example.com/unapproved-path/doc.pdf", "path allowlist"),
        ],
    )
    async def test_disallowed_urls_rejected_before_network(
        self, allowlist_policy: UrlAllowlistPolicy, tmp_path: Path, bad_url: str, reason: str
    ):
        transport = FakeHttpTransport()
        fetcher = SafeUrlFetcher(policy=allowlist_policy, transport=transport)

        with pytest.raises(SourceUrlNotAllowedError):
            await fetcher.fetch(bad_url, target_dir=tmp_path)

        assert transport.call_count == 0

    @pytest.mark.asyncio
    async def test_oversized_url_stream_raises_file_too_large(
        self, allowlist_policy: UrlAllowlistPolicy, tmp_path: Path
    ):
        """Stream exceeding 10 MiB limit must raise FileTooLargeError and abort immediately."""
        chunk_10mb = b"A" * MAX_FILE_BYTES
        overflow_chunk = b"B" * 1024

        def large_response_handler(host: str, ip: str, path: str) -> HttpResponseSeam:
            return FakeHttpResponse(status_code=200, body_chunks=[chunk_10mb, overflow_chunk])

        transport = FakeHttpTransport(handler=large_response_handler)
        dns = FakeDnsResolver({"files.example.com": ["93.184.216.34"]})
        fetcher = SafeUrlFetcher(policy=allowlist_policy, dns_resolver=dns, transport=transport)

        with pytest.raises(FileTooLargeError) as exc_info:
            await fetcher.fetch("https://files.example.com/approved/huge.pdf", target_dir=tmp_path)

        assert exc_info.value.code == "FILE_TOO_LARGE"
        assert exc_info.value.status_code == 413

    @pytest.mark.asyncio
    async def test_upstream_not_found_raises_source_unavailable(
        self, allowlist_policy: UrlAllowlistPolicy, tmp_path: Path
    ):
        def not_found_handler(host: str, ip: str, path: str) -> HttpResponseSeam:
            return FakeHttpResponse(status_code=404)

        transport = FakeHttpTransport(handler=not_found_handler)
        dns = FakeDnsResolver({"files.example.com": ["93.184.216.34"]})
        fetcher = SafeUrlFetcher(policy=allowlist_policy, dns_resolver=dns, transport=transport)

        with pytest.raises(SourceUnavailableError) as exc_info:
            await fetcher.fetch("https://files.example.com/approved/missing.pdf", target_dir=tmp_path)

        assert exc_info.value.code == "SOURCE_UNAVAILABLE"
        assert exc_info.value.status_code == 422

    def test_signed_url_secrets_are_redacted(self):
        signed_url = (
            "https://s3.amazonaws.com/bucket/doc.pdf"
            "?X-Amz-Algorithm=AWS4-HMAC-SHA256"
            "&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20260907%2Fus-east-1%2Fs3%2Faws4_request"
            "&X-Amz-Signature=d25f7a0c8b67f1b74288b8e6"
            "&session_token=secret_token_123"
        )
        redacted = redact_url_secrets(signed_url)

        # Confirm sensitive query tokens do NOT appear in redacted string
        assert "d25f7a0c8b67f1b74288b8e6" not in redacted
        assert "secret_token_123" not in redacted
        assert "AKIAIOSFODNN7EXAMPLE" not in redacted
        assert "s3.amazonaws.com/bucket/doc.pdf" in redacted
        assert "REDACTED" in redacted
