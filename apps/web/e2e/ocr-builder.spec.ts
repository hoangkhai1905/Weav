import { test, expect } from '@playwright/test';

test.describe('OCR Builder Inspector Gateway Integration', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript({ content: "window.localStorage.setItem('weav_lang_v1', 'EN')" });
    await page.addInitScript({ content: "window.localStorage.setItem('weav_token', 'test-bearer-token-12345')" });
  });

  test('sends typed multipart request to API Gateway public route and renders contract fields', async ({ page }) => {
    let capturedUrl = '';
    let capturedMethod = '';
    let capturedAuthHeader: string | null = null;
    let capturedRequestIdHeader: string | null = null;
    let capturedBody: string | null = null;

    await page.route('**/api/v1/workspaces/*/ocr/extractions', async (route) => {
      const request = route.request();
      capturedUrl = request.url();
      capturedMethod = request.method();
      capturedAuthHeader = request.headers()['authorization'] || null;
      capturedRequestIdHeader = request.headers()['x-request-id'] || null;
      capturedBody = request.postData() || '';

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          schemaVersion: '1.0',
          requestId: 'b9d3f820-2f1a-4c28-98e3-f65a4891b012',
          document: {
            fileName: 'contract.pdf',
            mimeType: 'application/pdf',
            pages: 2,
            pageInfo: [
              { page: 1, width: 1200, height: 1600, dpi: 200 },
              { page: 2, width: 1200, height: 1600, dpi: 200 },
            ],
          },
          text: {
            rawText: 'HỢP ĐỒNG KINH TẾ\nĐiều 1: Phạm vi công việc và điều khoản thanh toán.\nĐiều 2: Cam kết chất lượng dịch vụ.',
          },
          confidence: 0.945,
          blocks: [
            {
              id: 'p1-b1',
              order: 0,
              text: 'HỢP ĐỒNG KINH TẾ',
              confidence: 0.98,
              page: 1,
              boundingBox: { x: 100, y: 150, width: 500, height: 40 },
            },
          ],
          tables: [
            {
              id: 'p2-t1',
              page: 2,
              boundingBox: { x: 80, y: 300, width: 900, height: 400 },
              rowCount: 4,
              columnCount: 3,
              confidence: 0.91,
              cells: [],
            },
          ],
          metadata: {
            language: 'vi+en',
            resolvedLanguage: 'latin-multilingual',
            processingTimeMs: 620,
            engine: 'paddleocr',
            engineVersion: '3.7.0',
            modelRevision: 'approved-manifest-v1',
            tableDetection: 'completed',
            quality: 'OK',
            preprocessing: [{ page: 1, steps: ['grayscale', 'deskew'] }],
            warnings: [],
          },
        }),
      });
    });

    await page.goto('/workflows/wf-001/builder', { waitUntil: 'domcontentloaded' });

    // Add / open OCR node
    const ocrBtn = page.getByRole('button', { name: 'OCR Text Extract' });
    await expect(ocrBtn).toBeVisible();
    await ocrBtn.click();

    const inspector = page.getByTestId('workflow-inspector');
    await expect(inspector).toBeVisible();
    await expect(inspector).toContainText('OCR Text Extract');

    // Select file
    const fileInput = inspector.getByTestId('ocr-file-input');
    await fileInput.setInputFiles({
      name: 'contract.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 Mock PDF Content'),
    });

    await expect(inspector.getByText('contract.pdf', { exact: true })).toBeVisible();

    // Verify language & table detection controls
    const langSelect = inspector.locator('#ocr-language');
    await expect(langSelect).toHaveValue('vi+en');

    // Click extract
    await inspector.getByRole('button', { name: 'Extract text' }).click();

    // Verify request attributes
    expect(capturedMethod).toBe('POST');
    expect(capturedUrl).toContain('/api/v1/workspaces/ws-main/ocr/extractions');
    expect(capturedAuthHeader).toBe('Bearer test-bearer-token-12345');
    expect(capturedRequestIdHeader).toBeTruthy();
    expect(capturedBody).toContain('name="language"');
    expect(capturedBody).toContain('vi+en');
    expect(capturedBody).toContain('name="detectTables"');
    expect(capturedBody).toContain('true');
    expect(capturedBody).toContain('filename="contract.pdf"');

    // Verify response rendering
    const result = inspector.getByTestId('ocr-result');
    await expect(result).toBeVisible();

    // Confidence formatted as percentage (* 100)
    await expect(result).toContainText('94.5%');

    // Document info
    await expect(result).toContainText('Pages: 2');
    await expect(result).toContainText('application/pdf');
    await expect(result).toContainText('Tables: 1');

    // Quality state badge
    const qualityBadge = result.getByTestId('ocr-quality-badge');
    await expect(qualityBadge).toContainText('● OK');

    // Raw text
    const rawText = result.getByTestId('ocr-raw-text');
    await expect(rawText).toContainText('HỢP ĐỒNG KINH TẾ');

    // Ensure mock-only detectedFields / invoice fields are NOT present
    await expect(result.getByText('Detected fields', { exact: true })).toHaveCount(0);
    await expect(result.getByText('Invoice number', { exact: true })).toHaveCount(0);
    await expect(result.getByText('Công ty TNHH Minh Long', { exact: false })).toHaveCount(0);
  });

  test('rejects unsupported file extensions before making network calls', async ({ page }) => {
    let networkCalled = false;
    await page.route('**/api/v1/workspaces/*/ocr/extractions', async (route) => {
      networkCalled = true;
      await route.abort();
    });

    await page.goto('/workflows/wf-001/builder', { waitUntil: 'domcontentloaded' });
    const ocrBtn = page.getByRole('button', { name: 'OCR Text Extract' });
    await expect(ocrBtn).toBeVisible();
    await ocrBtn.click();

    const inspector = page.getByTestId('workflow-inspector');
    await expect(inspector).toBeVisible();
    const fileInput = inspector.getByTestId('ocr-file-input');

    await fileInput.setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('plain text note'),
    });

    await inspector.getByRole('button', { name: 'Extract text' }).click();

    const errorAlert = inspector.getByTestId('ocr-error');
    await expect(errorAlert).toBeVisible();
    await expect(errorAlert).toContainText('UNSUPPORTED_MEDIA_TYPE');
    expect(networkCalled).toBe(false);
  });

  test('rejects oversized files exceeding 10 MiB limit before making network calls', async ({ page }) => {
    let networkCalled = false;
    await page.route('**/api/v1/workspaces/*/ocr/extractions', async (route) => {
      networkCalled = true;
      await route.abort();
    });

    await page.goto('/workflows/wf-001/builder', { waitUntil: 'domcontentloaded' });
    const ocrBtn = page.getByRole('button', { name: 'OCR Text Extract' });
    await expect(ocrBtn).toBeVisible();
    await ocrBtn.click();

    const inspector = page.getByTestId('workflow-inspector');
    await expect(inspector).toBeVisible();
    const fileInput = inspector.getByTestId('ocr-file-input');

    // 11 MiB payload buffer
    const largeBuffer = Buffer.alloc(11 * 1024 * 1024);

    await fileInput.setInputFiles({
      name: 'giant-scan.png',
      mimeType: 'image/png',
      buffer: largeBuffer,
    });

    await inspector.getByRole('button', { name: 'Extract text' }).click();

    const errorAlert = inspector.getByTestId('ocr-error');
    await expect(errorAlert).toBeVisible();
    await expect(errorAlert).toContainText('FILE_TOO_LARGE');
    expect(networkCalled).toBe(false);
  });

  test('renders LOW_CONFIDENCE quality state and structured warnings', async ({ page }) => {
    await page.route('**/api/v1/workspaces/*/ocr/extractions', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          schemaVersion: '1.0',
          requestId: 'warn-req-4412',
          document: {
            fileName: 'blurry-receipt.jpg',
            mimeType: 'image/jpeg',
            pages: 1,
            pageInfo: [{ page: 1, width: 800, height: 1200, dpi: null }],
          },
          text: {
            rawText: 'Mo t so chu mo khong the doc...',
          },
          confidence: 0.528,
          blocks: [],
          tables: [],
          metadata: {
            language: 'vi+en',
            processingTimeMs: 410,
            quality: 'LOW_CONFIDENCE',
            warnings: [
              {
                code: 'LOW_CONFIDENCE',
                message: 'Document-level confidence 0.53 is below the acceptable quality threshold.',
                page: 1,
              },
              {
                code: 'ROTATION_CORRECTED',
                message: 'Document image was deskewed by 12 degrees.',
                page: 1,
              },
            ],
          },
        }),
      });
    });

    await page.goto('/workflows/wf-001/builder', { waitUntil: 'domcontentloaded' });
    const ocrBtn = page.getByRole('button', { name: 'OCR Text Extract' });
    await expect(ocrBtn).toBeVisible();
    await ocrBtn.click();

    const inspector = page.getByTestId('workflow-inspector');
    await expect(inspector).toBeVisible();

    const fileInput = inspector.getByTestId('ocr-file-input');
    await fileInput.setInputFiles({
      name: 'blurry-receipt.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from('mock jpeg'),
    });

    await inspector.getByRole('button', { name: 'Extract text' }).click();

    const result = inspector.getByTestId('ocr-result');
    await expect(result).toBeVisible();

    // Quality badge
    const badge = result.getByTestId('ocr-quality-badge');
    await expect(badge).toContainText('▲ Low Confidence');
    await expect(result).toContainText('52.8%');

    // Warnings list
    const warnings = result.getByTestId('ocr-warnings');
    await expect(warnings).toBeVisible();
    await expect(warnings).toContainText('Warnings (2)');
    await expect(warnings).toContainText('[LOW_CONFIDENCE]');
    await expect(warnings).toContainText('[ROTATION_CORRECTED]');
  });

  test('renders EMPTY document state with null confidence and explicit note', async ({ page }) => {
    await page.route('**/api/v1/workspaces/*/ocr/extractions', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          schemaVersion: '1.0',
          requestId: 'empty-req-9901',
          document: {
            fileName: 'blank.png',
            mimeType: 'image/png',
            pages: 1,
            pageInfo: [{ page: 1, width: 800, height: 1100, dpi: null }],
          },
          text: {
            rawText: '',
          },
          confidence: null,
          blocks: [],
          tables: [],
          metadata: {
            language: 'vi+en',
            processingTimeMs: 250,
            quality: 'EMPTY',
            warnings: [
              {
                code: 'BLANK_PAGE',
                message: 'Page 1 contains no detectable text.',
                page: 1,
              },
            ],
          },
        }),
      });
    });

    await page.goto('/workflows/wf-001/builder', { waitUntil: 'domcontentloaded' });
    const ocrBtn = page.getByRole('button', { name: 'OCR Text Extract' });
    await expect(ocrBtn).toBeVisible();
    await ocrBtn.click();

    const inspector = page.getByTestId('workflow-inspector');
    await expect(inspector).toBeVisible();

    const fileInput = inspector.getByTestId('ocr-file-input');
    await fileInput.setInputFiles({
      name: 'blank.png',
      mimeType: 'image/png',
      buffer: Buffer.from('mock png'),
    });

    await inspector.getByRole('button', { name: 'Extract text' }).click();

    const result = inspector.getByTestId('ocr-result');
    await expect(result).toBeVisible();

    // Quality badge
    const badge = result.getByTestId('ocr-quality-badge');
    await expect(badge).toContainText('○ Empty');

    // Confidence displayed as dash
    await expect(result).toContainText('Confidence: —');

    // Empty note
    const emptyNote = result.getByTestId('ocr-empty-note');
    await expect(emptyNote).toBeVisible();
    await expect(emptyNote).toContainText('No text detected');
  });

  test('handles Gateway error responses cleanly without leaking tokens or raw paths', async ({ page }) => {
    // 403 Forbidden
    await page.route('**/api/v1/workspaces/*/ocr/extractions', async (route) => {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'FORBIDDEN',
            message: 'Caller lacks workflow execution permission in the target workspace.',
            retryable: false,
          },
          requestId: 'err-403-uuid',
        }),
      });
    });

    await page.goto('/workflows/wf-001/builder', { waitUntil: 'domcontentloaded' });
    const ocrBtn = page.getByRole('button', { name: 'OCR Text Extract' });
    await expect(ocrBtn).toBeVisible();
    await ocrBtn.click();

    const inspector = page.getByTestId('workflow-inspector');
    await expect(inspector).toBeVisible();

    const fileInput = inspector.getByTestId('ocr-file-input');
    await fileInput.setInputFiles({
      name: 'test.png',
      mimeType: 'image/png',
      buffer: Buffer.from('png data'),
    });

    await inspector.getByRole('button', { name: 'Extract text' }).click();

    const errorAlert = inspector.getByTestId('ocr-error');
    await expect(errorAlert).toBeVisible();
    await expect(errorAlert).toContainText('FORBIDDEN');
    await expect(errorAlert).toContainText('Caller lacks workflow execution permission');

    // Ensure token is not leaked into the DOM
    await expect(errorAlert).not.toContainText('test-bearer-token-12345');
  });

  test('surfaces retryable hint on 503 OCR_BUSY error', async ({ page }) => {
    await page.route('**/api/v1/workspaces/*/ocr/extractions', async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'OCR_BUSY',
            message: 'OCR engine is busy processing other tasks. Please retry.',
            retryable: true,
          },
          requestId: 'busy-req-uuid',
        }),
      });
    });

    await page.goto('/workflows/wf-001/builder', { waitUntil: 'domcontentloaded' });
    const ocrBtn = page.getByRole('button', { name: 'OCR Text Extract' });
    await expect(ocrBtn).toBeVisible();
    await ocrBtn.click();

    const inspector = page.getByTestId('workflow-inspector');
    await expect(inspector).toBeVisible();

    const fileInput = inspector.getByTestId('ocr-file-input');
    await fileInput.setInputFiles({
      name: 'invoice.png',
      mimeType: 'image/png',
      buffer: Buffer.from('png data'),
    });

    await inspector.getByRole('button', { name: 'Extract text' }).click();

    const errorAlert = inspector.getByTestId('ocr-error');
    await expect(errorAlert).toBeVisible();
    await expect(errorAlert).toContainText('OCR_BUSY');
    await expect(errorAlert).toContainText('Retryable');
  });
});
