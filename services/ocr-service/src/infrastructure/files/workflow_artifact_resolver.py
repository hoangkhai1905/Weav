#!/usr/bin/env python3
"""Workflow artifact resolver binding workspace ownership before download."""

from __future__ import annotations

import uuid
from abc import ABC, abstractmethod
from datetime import UTC, datetime
from pathlib import Path

from src.domain.errors import ArtifactNotFoundError, FileTooLargeError
from src.domain.ports.artifact_resolver_port import (
    ArtifactDescriptor,
    ArtifactResolverPort,
)
from src.infrastructure.files.bounded_spool import (
    MAX_FILE_BYTES,
    BoundedSpooler,
    SpooledFile,
    sanitize_basename,
)
from src.infrastructure.files.safe_url_fetcher import SafeUrlFetcher


class WorkflowDescriptorClientPort(ABC):
    """Abstract client interface for querying Workflow Service artifact descriptors."""

    @abstractmethod
    async def get_descriptor(
        self,
        workspace_id: uuid.UUID | str,
        artifact_id: uuid.UUID | str,
    ) -> ArtifactDescriptor | None:
        """Fetch artifact descriptor from internal workflow service.

        Returns None if artifact does not exist.
        """
        ...


class DownloaderPort(ABC):
    """Abstract interface for downloading artifact content."""

    @abstractmethod
    async def download(
        self,
        download_url: str,
        target_dir: Path,
        filename: str | None = None,
    ) -> SpooledFile:
        ...


class SafeUrlDownloader(DownloaderPort):
    """Downloader adapter utilizing SafeUrlFetcher."""

    def __init__(self, fetcher: SafeUrlFetcher) -> None:
        self.fetcher = fetcher

    async def download(
        self,
        download_url: str,
        target_dir: Path,
        filename: str | None = None,
    ) -> SpooledFile:
        spooled = await self.fetcher.fetch(download_url, target_dir=target_dir)
        if filename:
            spooled.file_name = sanitize_basename(filename)
        return spooled


class WorkflowArtifactResolver(ArtifactResolverPort):
    """Resolves workflow artifacts with workspace boundary checks and safe streaming downloads.

    Never accesses databases directly; communicates via typed descriptor client boundary.
    Guarantees that cross-tenant, missing, expired, or deleted artifacts are rejected
    with ArtifactNotFoundError BEFORE the downloader is ever invoked.
    """

    def __init__(
        self,
        descriptor_client: WorkflowDescriptorClientPort,
        downloader: DownloaderPort | None = None,
        spooler: BoundedSpooler | None = None,
    ) -> None:
        self.descriptor_client = descriptor_client
        self.downloader = downloader
        self.spooler = spooler or BoundedSpooler(max_bytes=MAX_FILE_BYTES)

    async def resolve_descriptor(
        self,
        workspace_id: uuid.UUID | str,
        artifact_id: uuid.UUID | str,
    ) -> ArtifactDescriptor:
        """Fetch and validate artifact descriptor with strict workspace ownership check."""
        if not workspace_id:
            raise ArtifactNotFoundError("Workspace context is required to resolve artifacts")

        descriptor = await self.descriptor_client.get_descriptor(workspace_id, artifact_id)
        if descriptor is None:
            raise ArtifactNotFoundError(f"Artifact '{artifact_id}' not found")

        # Bind workspace and artifact ownership
        if str(descriptor.workspace_id) != str(workspace_id):
            raise ArtifactNotFoundError(
                f"Artifact '{artifact_id}' does not belong to workspace '{workspace_id}'"
            )

        # Check soft-deletion
        if descriptor.is_deleted:
            raise ArtifactNotFoundError(f"Artifact '{artifact_id}' has been deleted")

        # Check expiration
        if descriptor.expires_at is not None:
            now = datetime.now(UTC)
            exp = descriptor.expires_at
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=UTC)
            if exp < now:
                raise ArtifactNotFoundError(f"Artifact '{artifact_id}' has expired")

        # Check declared byte limit
        if descriptor.size_bytes > MAX_FILE_BYTES:
            raise FileTooLargeError(
                f"Artifact '{artifact_id}' declared size ({descriptor.size_bytes} bytes) exceeds 10 MiB limit"
            )

        return descriptor

    async def resolve_and_download(
        self,
        workspace_id: uuid.UUID | str,
        artifact_id: uuid.UUID | str,
        target_dir: Path,
    ) -> tuple[Path, ArtifactDescriptor]:
        """Verify ownership first, and only then download artifact into target_dir.

        If ownership or validity checks fail, ArtifactNotFoundError is raised immediately,
        and downloader is NEVER called.
        """
        descriptor = await self.resolve_descriptor(workspace_id, artifact_id)

        if self.downloader is None:
            raise RuntimeError("Downloader is not configured on WorkflowArtifactResolver")

        spooled = await self.downloader.download(
            download_url=descriptor.download_url,
            target_dir=target_dir,
            filename=descriptor.file_name,
        )

        return spooled.file_path, descriptor
