#!/usr/bin/env python3
"""Safe, SSRF-resistant URL fetcher with DNS pinning, default-deny allowlist, and zero credential leakage."""

from __future__ import annotations

import asyncio
import http.client
import ipaddress
import logging
import re
import shutil
import socket
import ssl
import time
from abc import ABC, abstractmethod
from pathlib import Path
from urllib.parse import urlparse, urlunparse

from src.domain.errors import (
    FileTooLargeError,
    SourceFetchFailedError,
    SourceTimeoutError,
    SourceUnavailableError,
    SourceUrlNotAllowedError,
)
from src.infrastructure.files.bounded_spool import (
    MAX_FILE_BYTES,
    BoundedSpooler,
    SpooledFile,
    sanitize_basename,
)

logger = logging.getLogger("weav.ocr.safe_url_fetcher")

# Strict timeouts from spec section 4
CONNECT_TIMEOUT_SEC = 3.0
READ_IDLE_TIMEOUT_SEC = 5.0
TOTAL_TIMEOUT_SEC = 15.0


def canonicalize_hostname(host: str) -> str:
    """Normalize a URL hostname to lowercase IDNA ASCII without a root dot."""
    try:
        canonical = host.rstrip(".").encode("idna").decode("ascii").lower()
    except (UnicodeError, AttributeError):
        raise SourceUrlNotAllowedError("URL host is not a valid IDNA hostname")
    if not canonical or len(canonical) > 253:
        raise SourceUrlNotAllowedError("URL host is not a valid IDNA hostname")
    return canonical


def redact_url_secrets(url: str) -> str:
    """Redact sensitive query parameters and credentials from URL for safe logging/error messages."""
    try:
        parsed = urlparse(url)
        # Always strip userinfo
        netloc = parsed.hostname or ""
        if parsed.port and parsed.port != 443:
            netloc = f"{netloc}:{parsed.port}"

        # If query string has any parameters, redact them
        new_query = "REDACTED" if parsed.query else ""

        redacted = urlunparse((
            parsed.scheme,
            netloc,
            parsed.path,
            parsed.params,
            new_query,
            "",  # strip fragment
        ))
        return redacted
    except (TypeError, ValueError):
        return "https://[REDACTED_URL]"


class DnsResolver(ABC):
    """Abstract DNS resolver seam enabling testable address validation and pinning."""

    @abstractmethod
    def resolve(self, host: str, port: int = 443) -> list[ipaddress.IPv4Address | ipaddress.IPv6Address]:
        """Resolve all A and AAAA records for host."""
        ...


class DefaultDnsResolver(DnsResolver):
    """System DNS resolver using socket.getaddrinfo."""

    def resolve(self, host: str, port: int = 443) -> list[ipaddress.IPv4Address | ipaddress.IPv6Address]:
        try:
            addr_info = socket.getaddrinfo(host, port, socket.AF_UNSPEC, socket.SOCK_STREAM)
        except socket.gaierror as e:
            raise SourceFetchFailedError(f"DNS resolution failed for host: {e}", retryable=True)

        results: list[ipaddress.IPv4Address | ipaddress.IPv6Address] = []
        for family, _, _, _, sockaddr in addr_info:
            ip_str = sockaddr[0]
            try:
                ip_obj = ipaddress.ip_address(ip_str)
                if ip_obj not in results:
                    results.append(ip_obj)
            except ValueError:
                continue

        if not results:
            raise SourceFetchFailedError(f"No IP addresses resolved for host '{host}'", retryable=True)
        return results


class HttpResponseSeam(ABC):
    """Abstract HTTP response seam for streaming bytes with idle/total timeouts."""

    @property
    @abstractmethod
    def status_code(self) -> int:
        ...

    @property
    @abstractmethod
    def headers(self) -> dict[str, str]:
        ...

    @abstractmethod
    def read_chunk(self, chunk_size: int = 64 * 1024) -> bytes:
        ...

    @abstractmethod
    def close(self) -> None:
        ...


class HttpTransportSeam(ABC):
    """Abstract HTTP transport seam ensuring verified IP is pinned and TLS hostname preserved."""

    @abstractmethod
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
        """Execute HTTP request directly against pinned_ip while presenting host for SNI / TLS validation."""
        ...


class RealHttpResponse(HttpResponseSeam):
    """Wraps http.client.HTTPResponse."""

    def __init__(self, conn: http.client.HTTPSConnection, resp: http.client.HTTPResponse) -> None:
        self._conn = conn
        self._resp = resp
        self._headers = {k.lower(): v for k, v in resp.getheaders()}

    @property
    def status_code(self) -> int:
        return self._resp.status

    @property
    def headers(self) -> dict[str, str]:
        return self._headers

    def read_chunk(self, chunk_size: int = 64 * 1024) -> bytes:
        return self._resp.read(chunk_size)

    def close(self) -> None:
        try:
            self._resp.close()
            self._conn.close()
        except OSError:
            pass


class PinnedHttpsConnection(http.client.HTTPSConnection):
    """HTTPS connection that dials a validated IP while preserving SNI/hostname checks."""

    def __init__(
        self,
        host: str,
        pinned_ip: str,
        port: int,
        timeout: float,
        context: ssl.SSLContext,
    ) -> None:
        super().__init__(host=host, port=port, timeout=timeout, context=context)
        self._pinned_ip = pinned_ip

    def connect(self) -> None:
        raw_socket = socket.create_connection((self._pinned_ip, self.port), self.timeout)
        try:
            self.sock = self._context.wrap_socket(raw_socket, server_hostname=self.host)
        except BaseException:
            raw_socket.close()
            raise


class RealHttpTransport(HttpTransportSeam):
    """Standard library TLS transport pinned to a pre-validated IP address."""

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
        ssl_ctx = ssl.create_default_context()
        # Connect directly to pinned IP address
        conn = PinnedHttpsConnection(
            host=host,
            pinned_ip=pinned_ip,
            port=port,
            timeout=connect_timeout,
            context=ssl_ctx,
        )

        try:
            conn.request(method, path_and_query, headers=headers)
            # Set socket timeout for read operations
            if conn.sock:
                conn.sock.settimeout(read_timeout)
            resp = conn.getresponse()
            return RealHttpResponse(conn, resp)
        except TimeoutError:
            conn.close()
            raise SourceTimeoutError(f"HTTP connection or read timed out for host '{host}'")
        except (OSError, ssl.SSLError, http.client.HTTPException) as e:
            conn.close()
            raise SourceFetchFailedError(f"Failed to connect to '{host}': {e}", retryable=True)


class UrlAllowlistPolicy:
    """Security allowlist policy for URL source retrieval with default deny."""

    def __init__(
        self,
        allowed_domains: set[str] | None = None,
        allowed_path_prefixes: dict[str, list[str]] | None = None,
    ) -> None:
        self.allowed_domains = {d.lower() for d in (allowed_domains or set())}
        self.allowed_path_prefixes = {
            k.lower(): v for k, v in (allowed_path_prefixes or {}).items()
        }

    def is_allowed(self, host: str, path: str) -> bool:
        host_lower = host.lower()
        matched = any(
            host_lower == domain.lstrip(".")
            or host_lower.endswith(f".{domain.lstrip('.')}")
            for domain in self.allowed_domains
        )
        if not matched:
            return False

        # If domain has specific path restrictions, enforce them
        if host_lower in self.allowed_path_prefixes:
            prefixes = self.allowed_path_prefixes[host_lower]
            return any(path.startswith(p) for p in prefixes)

        return True


class SafeUrlFetcher:
    """SSRF-resistant document fetcher enforcing strict schemes, DNS pinning, byte caps, and timeouts."""

    def __init__(
        self,
        policy: UrlAllowlistPolicy | None = None,
        dns_resolver: DnsResolver | None = None,
        transport: HttpTransportSeam | None = None,
        spooler: BoundedSpooler | None = None,
    ) -> None:
        self.policy = policy or UrlAllowlistPolicy()
        self.dns_resolver = dns_resolver or DefaultDnsResolver()
        self.transport = transport or RealHttpTransport()
        self.spooler = spooler or BoundedSpooler(max_bytes=MAX_FILE_BYTES)

    def is_unsafe_address(self, ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
        """Evaluate whether an IP address belongs to internal, loopback, private, link-local, or metadata ranges."""
        # Check IPv4-mapped IPv6 addresses (e.g. ::ffff:127.0.0.1 or ::ffff:169.254.169.254)
        if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
            ip = ip.ipv4_mapped

        # Loopback (127.0.0.0/8, ::1)
        if ip.is_loopback:
            return True

        # Private RFC1918 / RFC4193 (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, fc00::/7)
        if ip.is_private:
            return True

        # Link-local (169.254.0.0/16, fe80::/10)
        if ip.is_link_local:
            return True

        # Multicast (224.0.0.0/4, ff00::/8)
        if ip.is_multicast:
            return True

        # Reserved / Unspecified (240.0.0.0/4, 0.0.0.0, ::)
        if ip.is_reserved or ip.is_unspecified:
            return True

        # Cloud metadata explicitly
        ip_str = str(ip)
        if ip_str in ("169.254.169.254", "fd00:ec2::254"):
            return True

        # Only globally routable addresses are valid egress destinations. This
        # also blocks CGNAT, documentation, benchmarking, and other special-use
        # ranges that are not covered consistently by ipaddress.is_private.
        return not ip.is_global

    async def fetch(self, url: str, target_dir: Path | None = None) -> SpooledFile:
        """Fetch remote document from URL into a boundedly spooled local file.

        Enforces:
        - HTTPS scheme and port 443 only
        - Rejection of userinfo, fragments, IP literals, localhost
        - Default-deny allowlist policy
        - Pre-resolution and validation of all A/AAAA records
        - Destination IP pinning on transport (prevents DNS rebinding TOCTOU)
        - Absolute refusal to follow HTTP redirects
        - Streamed byte limit of 10 MiB (10,485,760 bytes)
        - Connect <=3s, read idle <=5s, total <=15s timeouts
        - Redaction of signed URL secrets in any captured errors or logs
        """
        redacted_url = redact_url_secrets(url)

        # 1. URL syntax and structure validation
        if not url or not isinstance(url, str) or not url.strip():
            raise SourceUrlNotAllowedError("Source URL must be a non-empty string")

        if len(url) > 4096:
            raise SourceUrlNotAllowedError("Source URL exceeds maximum permitted length of 4096 characters")

        parsed = urlparse(url)

        if parsed.scheme != "https":
            raise SourceUrlNotAllowedError(f"URL scheme '{parsed.scheme}' is forbidden. HTTPS is required")

        if parsed.port is not None and parsed.port != 443:
            raise SourceUrlNotAllowedError(f"URL port '{parsed.port}' is forbidden. Port 443 is required")

        if parsed.username or parsed.password or "@" in (parsed.netloc or ""):
            raise SourceUrlNotAllowedError("URL userinfo credentials are not permitted")

        if parsed.fragment:
            raise SourceUrlNotAllowedError("URL fragments are not permitted")

        raw_host = parsed.hostname
        if not raw_host:
            raise SourceUrlNotAllowedError("URL host cannot be empty")

        host_lower = canonicalize_hostname(raw_host)
        if host_lower == "localhost" or host_lower.endswith(".localhost"):
            raise SourceUrlNotAllowedError("Requests to localhost are strictly forbidden")

        # Reject direct IP literals (IPv4, IPv6, hex, octal formats)
        try:
            ipaddress.ip_address(host_lower)
            raise SourceUrlNotAllowedError(f"Direct IP literal hostname '{host_lower}' is forbidden")
        except ValueError:
            pass

        # Reject abnormal octal/decimal IP literals (e.g. 2130706433 or 0177.0.0.1)
        if re.match(r"^(\d+|0x[0-9a-fA-F]+)(\.(\d+|0x[0-9a-fA-F]+))*$", host_lower):
            raise SourceUrlNotAllowedError(f"Numeric IP literal hostname '{host_lower}' is forbidden")

        # 2. Allowlist policy check (default deny)
        path = parsed.path or "/"
        if not self.policy.is_allowed(host_lower, path):
            raise SourceUrlNotAllowedError(
                f"URL host '{host_lower}' is not permitted by workspace security policy"
            )

        # 3. DNS Resolution and address safety check
        resolved_ips = self.dns_resolver.resolve(host_lower, 443)
        if not resolved_ips:
            raise SourceFetchFailedError(f"DNS resolution returned no addresses for {host_lower}")

        for ip in resolved_ips:
            if self.is_unsafe_address(ip):
                raise SourceUrlNotAllowedError(
                    f"URL resolves to forbidden private or restricted address: {ip}"
                )

        # 4. Pin destination to verified IP
        pinned_ip = str(resolved_ips[0])

        # Prepare request parameters
        path_and_query = parsed.path or "/"
        if parsed.query:
            path_and_query = f"{path_and_query}?{parsed.query}"

        # No ambient credentials or ambient proxies
        headers = {
            "Host": host_lower,
            "User-Agent": "Weav-OCR-Service/1.0",
            "Accept": "application/pdf,image/png,image/jpeg,image/webp,*/*",
            "Connection": "close",
        }

        # 5. Execute request with strict timeouts and streaming byte cap
        start_time = time.monotonic()

        # Run transport execution in executor to respect connect/read timeouts safely
        loop = asyncio.get_running_loop()
        try:
            resp = await asyncio.wait_for(
                loop.run_in_executor(
                    None,
                    self.transport.execute_request,
                    "GET",
                    host_lower,
                    pinned_ip,
                    443,
                    path_and_query,
                    headers,
                    CONNECT_TIMEOUT_SEC,
                    READ_IDLE_TIMEOUT_SEC,
                ),
                timeout=CONNECT_TIMEOUT_SEC + 1.0,
            )
        except TimeoutError:
            raise SourceTimeoutError(f"Connection to source timed out ({redacted_url})")

        try:
            status = resp.status_code

            # 6. Reject HTTP redirects (301, 302, 303, 307, 308) - NEVER follow
            if 300 <= status < 400:
                location = resp.headers.get("location", "")
                raise SourceUrlNotAllowedError(
                    f"HTTP redirects are not permitted (received status {status} to {redact_url_secrets(location)})"
                )

            if 400 <= status < 500:
                raise SourceUnavailableError(f"Source document not found or unavailable (HTTP {status})")

            if status >= 500:
                raise SourceFetchFailedError(f"Upstream server returned error (HTTP {status})", retryable=True)

            if status != 200:
                raise SourceFetchFailedError(f"Unexpected HTTP status {status} from source", retryable=False)

            # 7. Stream response body under 10 MiB cap and total 15s timeout
            created_temp_dir = target_dir is None
            owning_dir = target_dir or self.spooler.create_per_request_dir()
            filename_hint = sanitize_basename(parsed.path.rsplit("/", 1)[-1] if "/" in parsed.path else "download.bin")
            spool_path = owning_dir / "url_spool.dat"

            total_bytes = 0

            def _stream_to_disk() -> int:
                nonlocal total_bytes
                with open(spool_path, "wb") as f:
                    while True:
                        now = time.monotonic()
                        if (now - start_time) > TOTAL_TIMEOUT_SEC:
                            raise SourceTimeoutError("Total fetch deadline exceeded 15 seconds")

                        chunk = resp.read_chunk()
                        if not chunk:
                            break

                        total_bytes += len(chunk)
                        if total_bytes > MAX_FILE_BYTES:
                            raise FileTooLargeError(
                                f"Source document ({total_bytes} bytes) exceeds 10 MiB ({MAX_FILE_BYTES} bytes) limit"
                            )
                        f.write(chunk)
                return total_bytes

            try:
                # Enforce total deadline
                time_remaining = max(0.5, TOTAL_TIMEOUT_SEC - (time.monotonic() - start_time))
                await asyncio.wait_for(
                    loop.run_in_executor(None, _stream_to_disk),
                    timeout=time_remaining,
                )
            except TimeoutError as exc:
                if spool_path.exists():
                    spool_path.unlink(missing_ok=True)
                if created_temp_dir and owning_dir.exists():
                    shutil.rmtree(owning_dir, ignore_errors=True)
                raise SourceTimeoutError("Source document retrieval exceeded total 15 seconds deadline") from exc
            except BaseException:
                if spool_path.exists():
                    spool_path.unlink(missing_ok=True)
                if created_temp_dir and owning_dir.exists():
                    shutil.rmtree(owning_dir, ignore_errors=True)
                raise

            return SpooledFile(
                file_path=spool_path,
                file_name=filename_hint,
                size_bytes=total_bytes,
                temp_dir=owning_dir,
            )

        finally:
            resp.close()
