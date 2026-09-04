import { delay } from './client';

export interface OcrConfig {
  language: string;
  detectTables: boolean;
}

export interface OcrExtractionResult {
  fileName: string;
  fileType: string;
  pages: number;
  confidence: number;
  rawText: string;
  detectedFields: Array<{ label: string; value: string }>;
}

const SUPPORTED_FILE_PATTERN = /\.(pdf|png|jpe?g|webp)$/i;
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

const SAMPLE_FIELDS = [
  { label: 'Invoice number', value: 'INV-2026-0042' },
  { label: 'Vendor', value: 'Công ty TNHH Minh Long' },
  { label: 'Total amount', value: '15,000,000 VND' },
];

export const ocrApi = {
  async extractText(file: File, config: OcrConfig): Promise<OcrExtractionResult> {
    if (!file || (!file.type.startsWith('image/') && !SUPPORTED_FILE_PATTERN.test(file.name))) {
      throw new Error('Unsupported file. Upload a PDF, PNG, JPG, or WEBP document.');
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw new Error('File is too large. OCR accepts documents up to 10 MB.');
    }

    await delay(850);

    const pages = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf') ? 2 : 1;
    const tableHint = config.detectTables ? '\nLine items detected: 3 rows.' : '';

    return {
      fileName: file.name,
      fileType: file.type || 'application/octet-stream',
      pages,
      confidence: 98.4,
      rawText: `INVOICE INV-2026-0042\nVendor: Công ty TNHH Minh Long\nTotal: 15,000,000 VND${tableHint}`,
      detectedFields: SAMPLE_FIELDS,
    };
  },
};
