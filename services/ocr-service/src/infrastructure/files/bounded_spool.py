#!/usr/bin/env python3
"""Bounded file spooling with strict byte capping, filename sanitization, and cleanup ownership."""

from __future__ import annotations

import inspect
import os
import re
import shutil
import tempfile
import uuid
from collections.abc import AsyncIterator, Iterator
from pathlib import Path
from types import TracebackType
from typing import Self

from src.domain.errors import FileTooLargeError

# 10 MiB = 10 * 1024 * 1024 bytes = 10,485,760 bytes
MAX_FILE_BYTES = 10_485_760
DEFAULT_SPOOL_CHUNK_SIZE = 64 * 1024  # 64 KiB buffer


def sanitize_basename(filename: str | None) -> str:
    """Sanitize client-provided filename into a safe basename.

    Guarantees:
    - Never retains directory path components (eliminates path traversal)
    - Strips control characters, null bytes, and Windows/Unix reserved path characters
    - Strips leading dots (prevents hidden files or ../)
    - Truncates to 255 characters
    - Returns 'document.bin' if input is empty or invalid
    """
    if not filename or not isinstance(filename, str) or not filename.strip():
        return "document.bin"

    # Extract basename only
    base = os.path.basename(filename.strip().replace("\\", "/"))

    # Remove null bytes, control characters, and forbidden path characters
    cleaned = re.sub(r'[\x00-\x1f\x7f\/\\:\*\?"<>\|]', "_", base)
    cleaned = re.sub(r"^\.+", "", cleaned).strip()

    if not cleaned:
        return "document.bin"

    return cleaned[:255]


class SpooledFile:
    """Represents a boundedly spooled document file with explicit cleanup ownership."""

    def __init__(
        self,
        file_path: Path,
        file_name: str,
        size_bytes: int,
        temp_dir: Path,
    ) -> None:
        self.file_path = file_path
        self.file_name = file_name
        self.size_bytes = size_bytes
        self.temp_dir = temp_dir
        self._cleaned = False

    def cleanup(self) -> None:
        """Safely clean up spooled file and enclosing per-request temp directory."""
        if self._cleaned:
            return
        self._cleaned = True
        if self.temp_dir.exists():
            shutil.rmtree(self.temp_dir, ignore_errors=True)

    def __enter__(self) -> Self:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: TracebackType | None,
    ) -> None:
        self.cleanup()

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: TracebackType | None,
    ) -> None:
        self.cleanup()

    def __repr__(self) -> str:
        return (
            f"SpooledFile(path={self.file_path}, name='{self.file_name}', "
            f"bytes={self.size_bytes}, cleaned={self._cleaned})"
        )


class BoundedSpooler:
    """Consumes chunked byte streams into a per-request temp directory up to a strict cap."""

    def __init__(
        self,
        max_bytes: int = MAX_FILE_BYTES,
        temp_root: Path | None = None,
    ) -> None:
        self.max_bytes = max_bytes
        self.temp_root = temp_root

    def create_per_request_dir(self) -> Path:
        """Create an isolated, per-request temporary directory with restrictive permissions."""
        base_dir = str(self.temp_root) if self.temp_root else None
        dir_path = tempfile.mkdtemp(prefix=f"weav_ocr_{uuid.uuid4().hex[:12]}_", dir=base_dir)
        return Path(dir_path)

    async def spool(
        self,
        stream: AsyncIterator[bytes] | Iterator[bytes] | bytes,
        client_filename: str | None = None,
        target_dir: Path | None = None,
    ) -> SpooledFile:
        """Spool incoming chunked stream to disk enforcing max_bytes limit.

        A stream exceeding max_bytes (even by 1 byte, e.g. 10,485,761) will immediately
        stop consuming, clean up the written file, and raise FileTooLargeError.

        Raises:
            FileTooLargeError: When streamed bytes exceed max_bytes.
            asyncio.CancelledError: On cancellation, triggering cleanup.
        """
        owning_dir = target_dir or self.create_per_request_dir()
        safe_basename = sanitize_basename(client_filename)

        # Internal spool file uses an opaque, collision-free name — NEVER client filename as path
        spool_path = owning_dir / f"spool_{uuid.uuid4().hex[:8]}.dat"
        total_bytes = 0

        try:
            # The stream may be async, but writes stay bounded and local to the request.
            with open(spool_path, "wb") as f:  # noqa: ASYNC230
                if isinstance(stream, bytes):
                    total_bytes = len(stream)
                    if total_bytes > self.max_bytes:
                        raise FileTooLargeError(
                            f"Document file size ({total_bytes} bytes) exceeds 10 MiB ({self.max_bytes} bytes) limit"
                        )
                    f.write(stream)
                elif hasattr(stream, "__aiter__"):
                    async for chunk in stream:  # type: ignore[union-attr]
                        if not chunk:
                            continue
                        total_bytes += len(chunk)
                        if total_bytes > self.max_bytes:
                            raise FileTooLargeError(
                                f"Document file size ({total_bytes} bytes) exceeds 10 MiB ({self.max_bytes} bytes) limit"
                            )
                        f.write(chunk)
                elif hasattr(stream, "__iter__"):
                    for chunk in stream:  # type: ignore[union-attr]
                        if not chunk:
                            continue
                        total_bytes += len(chunk)
                        if total_bytes > self.max_bytes:
                            raise FileTooLargeError(
                                f"Document file size ({total_bytes} bytes) exceeds 10 MiB ({self.max_bytes} bytes) limit"
                            )
                        f.write(chunk)
                elif hasattr(stream, "read"):
                    # File-like object
                    while True:
                        if inspect.iscoroutinefunction(stream.read):
                            chunk = await stream.read(DEFAULT_SPOOL_CHUNK_SIZE)  # type: ignore[misc]
                        else:
                            chunk = stream.read(DEFAULT_SPOOL_CHUNK_SIZE)  # type: ignore[misc]
                        if not chunk:
                            break
                        total_bytes += len(chunk)
                        if total_bytes > self.max_bytes:
                            raise FileTooLargeError(
                                f"Document file size ({total_bytes} bytes) exceeds 10 MiB ({self.max_bytes} bytes) limit"
                            )
                        f.write(chunk)
                else:
                    raise TypeError(f"Unsupported stream type: {type(stream).__name__}")

            return SpooledFile(
                file_path=spool_path,
                file_name=safe_basename,
                size_bytes=total_bytes,
                temp_dir=owning_dir,
            )

        except BaseException:
            # Explicit cleanup ownership on error / cancellation
            if spool_path.exists():
                spool_path.unlink(missing_ok=True)
            if target_dir is None and owning_dir.exists():
                shutil.rmtree(owning_dir, ignore_errors=True)
            raise


class SpoolContext:
    """Context manager for managing per-request spool directories with guaranteed cleanup."""

    def __init__(self, temp_root: Path | None = None, max_bytes: int = MAX_FILE_BYTES) -> None:
        self.spooler = BoundedSpooler(max_bytes=max_bytes, temp_root=temp_root)
        self.temp_dir: Path | None = None
        self.spooled_files: list[SpooledFile] = []

    async def __aenter__(self) -> Self:
        self.temp_dir = self.spooler.create_per_request_dir()
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: TracebackType | None,
    ) -> None:
        self.cleanup()

    def __enter__(self) -> Self:
        self.temp_dir = self.spooler.create_per_request_dir()
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: TracebackType | None,
    ) -> None:
        self.cleanup()

    async def spool_stream(
        self,
        stream: AsyncIterator[bytes] | Iterator[bytes] | bytes,
        client_filename: str | None = None,
    ) -> SpooledFile:
        """Spool stream inside this context's managed per-request directory."""
        if self.temp_dir is None:
            self.temp_dir = self.spooler.create_per_request_dir()

        spooled = await self.spooler.spool(
            stream=stream,
            client_filename=client_filename,
            target_dir=self.temp_dir,
        )
        self.spooled_files.append(spooled)
        return spooled

    def cleanup(self) -> None:
        """Clean up all spooled files and the per-request temporary directory."""
        for sf in self.spooled_files:
            sf.cleanup()
        self.spooled_files.clear()
        if self.temp_dir and self.temp_dir.exists():
            shutil.rmtree(self.temp_dir, ignore_errors=True)
