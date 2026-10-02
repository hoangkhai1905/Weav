import type {
  WorkflowDefinition,
  ExecutionDetail,
  ConnectionItem,
  WorkspaceMember,
  UserProfile,
  NotificationItem,
} from '../types/workflow.types';

const STORAGE_KEYS = {
  WORKFLOWS: 'weav_mock_workflows_v1',
  EXECUTIONS: 'weav_mock_executions_v1',
  CONNECTIONS: 'weav_mock_connections_v1',
  MEMBERS: 'weav_mock_members_v1',
  NOTIFICATIONS: 'weav_mock_notifications_v1',
  USER: 'weav_mock_user_v1',
};

// Seed User
export const MOCK_USER: UserProfile = {
  id: 'user-001',
  email: 'truong@example.com',
  name: 'Nguyễn Anh Xuân Trường',
  avatar: null,
};

// Seed Workflows
const INITIAL_WORKFLOWS: WorkflowDefinition[] = [
  {
    id: 'wf-001',
    name: 'Invoice OCR → AI Extract → Google Sheets',
    description: 'Process incoming invoice PDFs via OCR, extract vendor & totals with AI, then append to accounting sheets.',
    status: 'PUBLISHED',
    version: 3,
    triggerType: 'trigger.webhook',
    createdAt: '2026-08-20T10:00:00Z',
    updatedAt: '2026-08-27T14:30:00Z',
    lastRunAt: '2026-08-28T11:15:00Z',
    ownerName: 'Nguyễn Anh Xuân Trường',
    workspaceId: 'ws-main',
    nodes: [
      {
        id: 'node-1',
        type: 'trigger.webhook',
        name: 'Invoice Webhook',
        config: { method: 'POST', path: '/api/v1/invoices' },
        position: { x: 100, y: 200 },
      },
      {
        id: 'node-2',
        type: 'ocr.extract',
        name: 'OCR Extract PDF',
        config: { language: 'vi+en', detectTables: true },
        position: { x: 400, y: 200 },
      },
      {
        id: 'node-3',
        type: 'ai.extract',
        name: 'AI Field Structuring',
        config: { schemaDescription: 'Vendor, InvoiceNo, IssueDate, TotalAmount, TaxAmount' },
        position: { x: 700, y: 200 },
      },
      {
        id: 'node-4',
        type: 'sheets.append',
        name: 'Append to Finance Sheet',
        config: { spreadsheetId: 'sheet-invoice-2026', sheetName: 'Invoices' },
        position: { x: 1000, y: 120 },
      },
      {
        id: 'node-5',
        type: 'email.send',
        name: 'Notify Accountant Email',
        config: { to: 'ketoan@company.com', subject: 'New Invoice Processed' },
        position: { x: 1000, y: 280 },
      },
    ],
    edges: [
      { id: 'e1-2', source: 'node-1', target: 'node-2' },
      { id: 'e2-3', source: 'node-2', target: 'node-3' },
      { id: 'e3-4', source: 'node-3', target: 'node-4' },
      { id: 'e3-5', source: 'node-3', target: 'node-5' },
    ],
  },
  {
    id: 'wf-002',
    name: 'Daily Sales Report AI Summary',
    description: 'Runs every weekday at 6:00 PM, fetches daily orders, summarizes sales metrics, and sends Telegram alert.',
    status: 'PUBLISHED',
    version: 1,
    triggerType: 'trigger.schedule',
    createdAt: '2026-08-22T08:00:00Z',
    updatedAt: '2026-08-26T09:10:00Z',
    lastRunAt: '2026-08-27T18:00:00Z',
    ownerName: 'Nguyễn Anh Xuân Trường',
    workspaceId: 'ws-main',
    nodes: [
      {
        id: 'n-1',
        type: 'trigger.schedule',
        name: 'Daily 6 PM Cron',
        config: { cron: '0 18 * * 1-5' },
        position: { x: 100, y: 200 },
      },
      {
        id: 'n-2',
        type: 'http.request',
        name: 'Fetch Sales API',
        config: { method: 'GET', url: 'https://api.internal/sales/daily' },
        position: { x: 400, y: 200 },
      },
      {
        id: 'n-3',
        type: 'ai.summarize',
        name: 'AI Sales Insight',
        config: { maxLength: 300 },
        position: { x: 700, y: 200 },
      },
      {
        id: 'n-4',
        type: 'telegram.send_message',
        name: 'Send to Leadership Bot',
        config: { chatId: '@weav_exec_team', text: 'Daily Sales Summary Report' },
        position: { x: 1000, y: 200 },
      },
    ],
    edges: [
      { id: 'edge-1-2', source: 'n-1', target: 'n-2' },
      { id: 'edge-2-3', source: 'n-2', target: 'n-3' },
      { id: 'edge-3-4', source: 'n-3', target: 'n-4' },
    ],
  },
  {
    id: 'wf-003',
    name: 'Telegram Customer Inquiry Classifier',
    description: 'Listen to Telegram bot commands, classify user inquiry intent, and route to support team.',
    status: 'DRAFT',
    version: 1,
    triggerType: 'trigger.telegram',
    createdAt: '2026-08-25T11:00:00Z',
    updatedAt: '2026-08-25T11:00:00Z',
    ownerName: 'Le Van Nam',
    workspaceId: 'ws-main',
    nodes: [
      {
        id: 'tg-1',
        type: 'trigger.telegram',
        name: 'Telegram Command Trigger',
        config: { command: '/support' },
        position: { x: 100, y: 200 },
      },
      {
        id: 'tg-2',
        type: 'ai.classify',
        name: 'Classify Intent',
        config: { categories: ['Bug', 'Billing', 'Feature Request'] },
        position: { x: 450, y: 200 },
      },
    ],
    edges: [{ id: 'tg-e1-2', source: 'tg-1', target: 'tg-2' }],
  },
];

// Seed Executions
const INITIAL_EXECUTIONS: ExecutionDetail[] = [
  {
    id: 'exec-101',
    workflowId: 'wf-001',
    workflowName: 'Invoice OCR → AI Extract → Google Sheets',
    triggerType: 'trigger.webhook',
    status: 'SUCCESS',
    startedAt: '2026-08-28T11:15:00Z',
    completedAt: '2026-08-28T11:15:04Z',
    durationMs: 4200,
    nodeResults: {
      'node-1': {
        nodeId: 'node-1',
        nodeName: 'Invoice Webhook',
        status: 'SUCCESS',
        startedAt: '2026-08-28T11:15:00.100Z',
        completedAt: '2026-08-28T11:15:00.300Z',
        durationMs: 200,
        retryCount: 0,
        output: { fileUrl: 's3://invoices/inv_20260828.pdf', source: 'webhook' },
      },
      'node-2': {
        nodeId: 'node-2',
        nodeName: 'OCR Extract PDF',
        status: 'SUCCESS',
        startedAt: '2026-08-28T11:15:00.310Z',
        completedAt: '2026-08-28T11:15:02.100Z',
        durationMs: 1790,
        retryCount: 0,
        output: { rawText: 'CÔNG TY TNHH WEAV\nHÓA ĐƠN GTGT...\nTổng tiền: 15,000,000 VND', pages: 2, confidence: 0.98 },
      },
      'node-3': {
        nodeId: 'node-3',
        nodeName: 'AI Field Structuring',
        status: 'SUCCESS',
        startedAt: '2026-08-28T11:15:02.110Z',
        completedAt: '2026-08-28T11:15:03.500Z',
        durationMs: 1390,
        retryCount: 0,
        output: { vendor: 'WEAV Tech Ltd', totalAmount: 15000000, currency: 'VND', invoiceNo: 'INV-2026-0892' },
      },
      'node-4': {
        nodeId: 'node-4',
        nodeName: 'Append to Finance Sheet',
        status: 'SUCCESS',
        startedAt: '2026-08-28T11:15:03.510Z',
        completedAt: '2026-08-28T11:15:03.900Z',
        durationMs: 390,
        retryCount: 0,
        output: { updatedRange: 'Sheet1!A45:E45' },
      },
      'node-5': {
        nodeId: 'node-5',
        nodeName: 'Notify Accountant Email',
        status: 'SUCCESS',
        startedAt: '2026-08-28T11:15:03.510Z',
        completedAt: '2026-08-28T11:15:04.200Z',
        durationMs: 690,
        retryCount: 0,
        output: { messageId: 'msg-99212-gmail' },
      },
    },
    logs: [
      { id: 'log-1', nodeId: 'node-1', nodeName: 'Invoice Webhook', timestamp: '11:15:00.100', level: 'INFO', message: 'Received Webhook request payload.' },
      { id: 'log-2', nodeId: 'node-2', nodeName: 'OCR Extract PDF', timestamp: '11:15:00.310', level: 'INFO', message: 'Processing PaddleOCR text recognition on 2 pages.' },
      { id: 'log-3', nodeId: 'node-3', nodeName: 'AI Field Structuring', timestamp: '11:15:02.110', level: 'INFO', message: 'Calling AI model for structured schema extraction.' },
      { id: 'log-4', nodeId: 'node-4', nodeName: 'Append to Finance Sheet', timestamp: '11:15:03.510', level: 'SUCCESS', message: 'Row appended successfully to Google Sheet.' },
      { id: 'log-5', nodeId: 'node-5', nodeName: 'Notify Accountant Email', timestamp: '11:15:03.510', level: 'SUCCESS', message: 'Email notification sent to ketoan@company.com.' },
      { id: 'log-6', timestamp: '11:15:04.200', level: 'SUCCESS', message: 'Execution exec-101 completed successfully.' },
    ],
  },
  {
    id: 'exec-102',
    workflowId: 'wf-002',
    workflowName: 'Daily Sales Report AI Summary',
    triggerType: 'trigger.schedule',
    status: 'SUCCESS',
    startedAt: '2026-08-27T18:00:00Z',
    completedAt: '2026-08-27T18:00:03Z',
    durationMs: 3100,
    nodeResults: {
      'n-1': { nodeId: 'n-1', nodeName: 'Daily 6 PM Cron', status: 'SUCCESS', startedAt: '2026-08-27T18:00:00Z', completedAt: '2026-08-27T18:00:00.100Z', durationMs: 100, retryCount: 0 },
      'n-2': { nodeId: 'n-2', nodeName: 'Fetch Sales API', status: 'SUCCESS', startedAt: '2026-08-27T18:00:00.110Z', completedAt: '2026-08-27T18:00:01.200Z', durationMs: 1090, retryCount: 0 },
      'n-3': { nodeId: 'n-3', nodeName: 'AI Sales Insight', status: 'SUCCESS', startedAt: '2026-08-27T18:00:01.210Z', completedAt: '2026-08-27T18:00:02.700Z', durationMs: 1490, retryCount: 0 },
      'n-4': { nodeId: 'n-4', nodeName: 'Send to Leadership Bot', status: 'SUCCESS', startedAt: '2026-08-27T18:00:02.710Z', completedAt: '2026-08-27T18:00:03.100Z', durationMs: 390, retryCount: 0 },
    },
    logs: [
      { id: 'l-1', timestamp: '18:00:00', level: 'INFO', message: 'Cron trigger fired on schedule.' },
      { id: 'l-2', timestamp: '18:00:01', level: 'INFO', message: 'Sales API returned 142 daily orders.' },
      { id: 'l-3', timestamp: '18:00:03', level: 'SUCCESS', message: 'Summary delivered to Telegram chat.' },
    ],
  },
  {
    id: 'exec-103',
    workflowId: 'wf-001',
    workflowName: 'Invoice OCR → AI Extract → Google Sheets',
    triggerType: 'trigger.webhook',
    status: 'FAILED',
    startedAt: '2026-08-27T16:20:00Z',
    completedAt: '2026-08-27T16:20:02Z',
    durationMs: 2100,
    nodeResults: {
      'node-1': { nodeId: 'node-1', nodeName: 'Invoice Webhook', status: 'SUCCESS', startedAt: '2026-08-27T16:20:00Z', completedAt: '2026-08-27T16:20:00.200Z', durationMs: 200, retryCount: 0 },
      'node-2': { nodeId: 'node-2', nodeName: 'OCR Extract PDF', status: 'FAILED', startedAt: '2026-08-27T16:20:00.210Z', completedAt: '2026-08-27T16:20:02.100Z', durationMs: 1890, retryCount: 2, error: 'Corrupt PDF document format. OCR parser engine failed.' },
    },
    logs: [
      { id: 'fl-1', timestamp: '16:20:00', level: 'INFO', message: 'Webhook received document.' },
      { id: 'fl-2', timestamp: '16:20:02', level: 'ERROR', message: 'OCR process failed: Corrupt PDF header.' },
    ],
  },
];

// Seed Connections
const INITIAL_CONNECTIONS: ConnectionItem[] = [
  { id: 'conn-1', provider: 'gmail', name: 'Company Gmail OAuth', status: 'CONNECTED', createdBy: 'Nguyễn Anh Xuân Trường', createdAt: '2026-08-15T00:00:00Z', lastRunAt: '2026-08-28T11:15:04Z' },
  { id: 'conn-2', provider: 'sheets', name: 'Finance Google Workspace', status: 'CONNECTED', createdBy: 'Nguyễn Anh Xuân Trường', createdAt: '2026-08-15T00:00:00Z', lastRunAt: '2026-08-28T11:15:03Z' },
  { id: 'conn-3', provider: 'telegram', name: 'WEAV Operational Bot', status: 'CONNECTED', createdBy: 'Nguyễn Anh Xuân Trường', createdAt: '2026-08-18T00:00:00Z', lastRunAt: '2026-08-27T18:00:03Z' },
  { id: 'conn-4', provider: 'http', name: 'Internal REST API Key', status: 'CONNECTED', createdBy: 'Le Van Nam', createdAt: '2026-08-22T00:00:00Z', lastRunAt: '2026-08-27T18:00:01Z' },
];

// Seed Members
const INITIAL_MEMBERS: WorkspaceMember[] = [
  { id: 'user-001', name: 'Nguyễn Anh Xuân Trường', email: 'truong@example.com', role: 'OWNER', canPublishWorkflow: true, joinedAt: '2026-08-01T00:00:00Z' },
  { id: 'user-002', name: 'Lê Văn Nam', email: 'nam.le@example.com', role: 'MEMBER', canPublishWorkflow: true, joinedAt: '2026-08-10T00:00:00Z' },
  { id: 'user-003', name: 'Trần Thị Bích', email: 'bich.tran@example.com', role: 'MEMBER', canPublishWorkflow: false, joinedAt: '2026-08-14T00:00:00Z' },
];

// Seed Notifications
const INITIAL_NOTIFICATIONS: NotificationItem[] = [
  { id: 'notif-1', type: 'WORKFLOW_COMPLETED', title: 'Execution Succeeded', message: 'Workflow "Invoice OCR → AI Extract → Google Sheets" finished successfully.', timestamp: '2026-08-28T11:15:04Z', read: false, link: '/executions/exec-101' },
  { id: 'notif-2', type: 'WORKFLOW_FAILED', title: 'Execution Failed', message: 'Workflow "Invoice OCR → AI Extract → Google Sheets" failed at OCR Extract PDF step.', timestamp: '2026-08-27T16:20:02Z', read: true, link: '/executions/exec-103' },
  { id: 'notif-3', type: 'TELEGRAM_LINKED', title: 'Telegram Connected', message: 'Telegram Bot @weav_automation_bot linked to workspace.', timestamp: '2026-08-18T10:00:00Z', read: true, link: '/telegram' },
];

// Local Storage Helpers
function getStorage<T>(key: string, defaultVal: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : defaultVal;
  } catch {
    return defaultVal;
  }
}

function setStorage<T>(key: string, val: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch (e) {
    console.error('Failed to save to localStorage:', e);
  }
}

// Initialize seed data if not present
export function initMockStorage(): void {
  if (!localStorage.getItem(STORAGE_KEYS.WORKFLOWS)) {
    setStorage(STORAGE_KEYS.WORKFLOWS, INITIAL_WORKFLOWS);
  }
  if (!localStorage.getItem(STORAGE_KEYS.EXECUTIONS)) {
    setStorage(STORAGE_KEYS.EXECUTIONS, INITIAL_EXECUTIONS);
  }
  if (!localStorage.getItem(STORAGE_KEYS.CONNECTIONS)) {
    setStorage(STORAGE_KEYS.CONNECTIONS, INITIAL_CONNECTIONS);
  }
  if (!localStorage.getItem(STORAGE_KEYS.MEMBERS)) {
    setStorage(STORAGE_KEYS.MEMBERS, INITIAL_MEMBERS);
  }
  if (!localStorage.getItem(STORAGE_KEYS.NOTIFICATIONS)) {
    setStorage(STORAGE_KEYS.NOTIFICATIONS, INITIAL_NOTIFICATIONS);
  }
  if (!localStorage.getItem(STORAGE_KEYS.USER)) {
    setStorage(STORAGE_KEYS.USER, MOCK_USER);
  }
}

export function delay(ms = 200): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { STORAGE_KEYS, getStorage, setStorage };
