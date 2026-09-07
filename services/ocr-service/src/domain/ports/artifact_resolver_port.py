#!/usr/bin/env python3
"""Port interface for resolving and downloading workflow artifacts with tenant boundaries."""

from __future__ import annotations

import uuid
from abc import ABC, abstractmethod
from datetime import datetime
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field


class ArtifactDescriptor(BaseModel):
    """Sanitized metadata descriptor for a managed workflow artifact."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    artifact_id: uuid.UUID = Field(..., alias="artifactId", description="Unique artifact identifier")
    workspace_id: uuid.UUID | str = Field(..., alias="workspaceId", description="Owning workspace identifier")
    download_url: str = Field(..., alias="downloadUrl", description="Short-lived signed HTTPS download URL")
    file_name: str = Field(..., alias="fileName", description="Sanitized original document filename")
    mime_type: str = Field(..., alias="mimeType", description="Declared MIME type of artifact")
    size_bytes: int = Field(..., ge=0, alias="sizeBytes", description="Declared byte size of artifact")
    sha256: str | None = Field(default=None, description="Optional SHA-256 digest")
    expires_at: datetime | None = Field(default=None, alias="expiresAt", description="Descriptor expiration timestamp")
    is_deleted: bool = Field(default=False, alias="isDeleted", description="Whether artifact has been soft-deleted")


class ArtifactResolverPort(ABC):
    """Abstract boundary for resolving artifact descriptors and streaming downloads."""

    @abstractmethod
    async def resolve_descriptor(
        self,
        workspace_id: uuid.UUID | str,
        artifact_id: uuid.UUID | str,
    ) -> ArtifactDescriptor:
        """Fetch and validate artifact descriptor bound to the given workspace.

        Raises:
            ArtifactNotFoundError: If artifact does not exist, belongs to another workspace,
                                   is expired, or has been deleted.
        """
        ...

    @abstractmethod
    async def resolve_and_download(
        self,
        workspace_id: uuid.UUID | str,
        artifact_id: uuid.UUID | str,
        target_dir: Path,
    ) -> tuple[Path, ArtifactDescriptor]:
        """Verify workspace ownership first, and only then download artifact into target_dir.

        Under NO circumstances may the downloader be invoked if workspace verification
        fails or the artifact is not found/expired/deleted.

        Raises:
            ArtifactNotFoundError: If artifact is missing, cross-tenant, expired, or deleted.
            FileTooLargeError: If artifact exceeds 10 MiB limit.
        """
        ...
