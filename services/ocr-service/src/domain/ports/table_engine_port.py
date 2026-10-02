#!/usr/bin/env python3
"""Port interface for optional table detection and structure recognition."""

from __future__ import annotations

from abc import ABC, abstractmethod

from src.domain.models.ocr_result import TableResult, TextBlock
from src.domain.ports.document_loader_port import LoadedDocument


class TableEnginePort(ABC):
    """Abstract port for table layout analysis and cell extraction engines."""

    @abstractmethod
    async def extract_tables(
        self,
        document: LoadedDocument,
        blocks: list[TextBlock],
    ) -> list[TableResult]:
        """Detect tables, reconstruct grid rows and columns, and map text blocks to cells.

        Returns:
            Empty list if no tables are detected or detectTables is false.
        """
        ...
