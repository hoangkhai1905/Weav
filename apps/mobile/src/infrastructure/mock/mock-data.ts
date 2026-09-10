import type { UserProfile } from '../../domain/auth/auth.types';
import type { Workflow } from '../../domain/workflow/workflow.types';
import type { Execution } from '../../domain/execution/execution.types';
import type { ConnectionItem } from '../../domain/connection/connection.types';
import type { Workspace, WorkspaceMember } from '../../domain/workspace/workspace.types';
import type { NotificationItem } from '../../domain/notification/notification.types';
import type { TelegramStatus } from '../../domain/telegram/telegram.types';

export const MOCK_USER: UserProfile = {
  id: 'user-001',
  name: 'Nguyễn Anh Xuân Trường',
  email: 'truong@example.com',
  avatar: null,
};

export const MOCK_WORKSPACE: Workspace = {
  id: 'ws-main',
  name: 'WEAV Production Workspace',
  description: 'Primary AI Workflow Automation Hub',
  ownerName: 'Nguyễn Anh Xuân Trường',
  createdAt: '2026-08-01T00:00:00Z',
  memberCount: 3,
};

export const MOCK_MEMBERS: WorkspaceMember[] = [
  { id: 'user-001', name: 'Nguyễn Anh Xuân Trường', email: 'truong@example.com', role: 'OWNER', canPublishWorkflow: true, joinedAt: '2026-08-01T00:00:00Z' },
  { id: 'user-002', name: 'Lê Văn Nam', email: 'nam.le@example.com', role: 'MEMBER', canPublishWorkflow: true, joinedAt: '2026-08-10T00:00:00Z' },
  { id: 'user-003', name: 'Trần Thị Bích', email: 'bich.tran@example.com', role: 'MEMBER', canPublishWorkflow: false, joinedAt: '2026-08-14T00:00:00Z' },
];

export const MOCK_WORKFLOWS: Workflow[] = [
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
      { id: 'node-1', type: 'trigger.webhook', name: 'Invoice Webhook', config: { path: '/api/v1/invoices' }, position: { x: 100, y: 100 } },
      { id: 'node-2', type: 'ocr.extract', name: 'OCR Extract PDF', config: { language: 'vi+en' }, position: { x: 400, y: 100 } },
      { id: 'node-3', type: 'ai.extract', name: 'AI Field Structuring', config: { schema: 'InvoiceNo, Total' }, position: { x: 700, y: 100 } },
      { id: 'node-4', type: 'sheets.append', name: 'Append to Finance Sheet', config: { sheet: 'Invoices' }, position: { x: 1000, y: 100 } },
    ],
    edges: [
      { id: 'e1-2', source: 'node-1', target: 'node-2' },
      { id: 'e2-3', source: 'node-2', target: 'node-3' },
      { id: 'e3-4', source: 'node-3', target: 'node-4' },
    ],
  },
  {
    id: 'wf-002',
    name: 'Daily Sales Report AI Summary',
    description: 'Runs weekdays at 6:00 PM, fetches orders, summarizes sales metrics, and sends Telegram alert.',
    status: 'PUBLISHED',
    version: 1,
    triggerType: 'trigger.schedule',
    createdAt: '2026-08-22T08:00:00Z',
    updatedAt: '2026-08-26T09:10:00Z',
    lastRunAt: '2026-08-27T18:00:00Z',
    ownerName: 'Nguyễn Anh Xuân Trường',
    workspaceId: 'ws-main',
    nodes: [
      { id: 'n-1', type: 'trigger.schedule', name: 'Daily 6 PM Cron', config: { cron: '0 18 * * 1-5' }, position: { x: 100, y: 100 } },
      { id: 'n-2', type: 'http.request', name: 'Fetch Sales API', config: { url: 'https://api.internal/sales' }, position: { x: 400, y: 100 } },
      { id: 'n-3', type: 'ai.summarize', name: 'AI Sales Insight', config: { maxLength: 300 }, position: { x: 700, y: 100 } },
      { id: 'n-4', type: 'telegram.send', name: 'Send Telegram Alert', config: { chatId: '@weav_exec' }, position: { x: 1000, y: 100 } },
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
    description: 'Listen to Telegram bot commands, classify user inquiry intent with AI, and route to support.',
    status: 'DRAFT',
    version: 1,
    triggerType: 'trigger.telegram',
    createdAt: '2026-08-25T11:00:00Z',
    updatedAt: '2026-08-25T11:00:00Z',
    ownerName: 'Lê Văn Nam',
    workspaceId: 'ws-main',
    nodes: [
      { id: 'tg-1', type: 'trigger.telegram', name: 'Telegram Command Trigger', config: { command: '/support' }, position: { x: 100, y: 100 } },
      { id: 'tg-2', type: 'ai.classify', name: 'Classify Intent', config: { categories: ['Bug', 'Billing'] }, position: { x: 450, y: 100 } },
    ],
    edges: [{ id: 'tg-e1-2', source: 'tg-1', target: 'tg-2' }],
  },
  {
    id: 'wf-004',
    name: 'Email → Google Sheets Sync',
    description: 'Parse customer email feedback and append structured rows to Google Sheets.',
    status: 'PUBLISHED',
    version: 2,
    triggerType: 'trigger.webhook',
    createdAt: '2026-08-15T09:00:00Z',
    updatedAt: '2026-08-24T12:00:00Z',
    lastRunAt: '2026-08-28T09:30:00Z',
    ownerName: 'Nguyễn Anh Xuân Trường',
    workspaceId: 'ws-main',
  },
  {
    id: 'wf-005',
    name: 'HTTP Data Pipeline & Sentiment Analysis',
    description: 'Fetch third-party news API, analyze sentiment score with AI LLM, and trigger webhook.',
    status: 'PAUSED',
    version: 1,
    triggerType: 'trigger.schedule',
    createdAt: '2026-08-18T14:00:00Z',
    updatedAt: '2026-08-27T10:00:00Z',
    ownerName: 'Lê Văn Nam',
    workspaceId: 'ws-main',
  },
  {
    id: 'wf-006',
    name: 'Webhook → AI Extract → Telegram Alert',
    description: 'Instant notification pipeline for high-value leads captured from landing page webhooks.',
    status: 'PUBLISHED',
    version: 4,
    triggerType: 'trigger.webhook',
    createdAt: '2026-08-10T08:00:00Z',
    updatedAt: '2026-08-28T08:00:00Z',
    lastRunAt: '2026-08-28T10:00:00Z',
    ownerName: 'Nguyễn Anh Xuân Trường',
    workspaceId: 'ws-main',
  },
  {
    id: 'wf-007',
    name: 'Automated Database Backup Notification',
    description: 'Monitors nightly database backup completion and alerts DevOps channel.',
    status: 'PUBLISHED',
    version: 1,
    triggerType: 'trigger.schedule',
    createdAt: '2026-08-05T00:00:00Z',
    updatedAt: '2026-08-20T00:00:00Z',
    ownerName: 'Trần Thị Bích',
    workspaceId: 'ws-main',
  },
  {
    id: 'wf-008',
    name: 'Customer Refund Request Reviewer',
    description: 'AI verification of user refund eligibility and automated Zendesk ticket creation.',
    status: 'DRAFT',
    version: 1,
    triggerType: 'trigger.webhook',
    createdAt: '2026-08-26T15:00:00Z',
    updatedAt: '2026-08-26T15:00:00Z',
    ownerName: 'Nguyễn Anh Xuân Trường',
    workspaceId: 'ws-main',
  },
];

export const MOCK_EXECUTIONS: Execution[] = [
  {
    id: 'exec-101',
    workflowId: 'wf-001',
    workflowName: 'Invoice OCR → AI Extract → Google Sheets',
    status: 'SUCCESS',
    triggerType: 'trigger.webhook',
    startedAt: '2026-08-28T11:15:00Z',
    completedAt: '2026-08-28T11:15:04Z',
    durationMs: 4200,
    nodeResults: {
      'node-1': { nodeId: 'node-1', nodeName: 'Invoice Webhook', status: 'SUCCESS', startedAt: '11:15:00.100', completedAt: '11:15:00.300', durationMs: 200, output: { file: 'invoice_88.pdf' } },
      'node-2': { nodeId: 'node-2', nodeName: 'OCR Extract PDF', status: 'SUCCESS', startedAt: '11:15:00.310', completedAt: '11:15:02.100', durationMs: 1790, output: { text: 'Total: 15,000,000 VND' } },
      'node-3': { nodeId: 'node-3', nodeName: 'AI Field Structuring', status: 'SUCCESS', startedAt: '11:15:02.110', completedAt: '11:15:03.500', durationMs: 1390, output: { amount: 15000000, vendor: 'WEAV Tech' } },
      'node-4': { nodeId: 'node-4', nodeName: 'Append to Finance Sheet', status: 'SUCCESS', startedAt: '11:15:03.510', completedAt: '11:15:03.900', durationMs: 390, output: { row: 45 } },
    },
    logs: [
      { id: 'l1', nodeId: 'node-1', nodeName: 'Invoice Webhook', timestamp: '11:15:00', level: 'INFO', message: 'Received Webhook payload.' },
      { id: 'l2', nodeId: 'node-2', nodeName: 'OCR Extract PDF', timestamp: '11:15:01', level: 'INFO', message: 'OCR Engine processing 2 pages.' },
      { id: 'l3', nodeId: 'node-3', nodeName: 'AI Field Structuring', timestamp: '11:15:03', level: 'SUCCESS', message: 'AI extracted vendor & total amounts.' },
      { id: 'l4', nodeId: 'node-4', nodeName: 'Append to Finance Sheet', timestamp: '11:15:04', level: 'SUCCESS', message: 'Row appended to Google Sheets.' },
    ],
  },
  {
    id: 'exec-102',
    workflowId: 'wf-002',
    workflowName: 'Daily Sales Report AI Summary',
    status: 'SUCCESS',
    triggerType: 'trigger.schedule',
    startedAt: '2026-08-27T18:00:00Z',
    completedAt: '2026-08-27T18:00:03Z',
    durationMs: 3100,
    nodeResults: {
      'n-1': { nodeId: 'n-1', nodeName: 'Daily 6 PM Cron', status: 'SUCCESS', durationMs: 100 },
      'n-2': { nodeId: 'n-2', nodeName: 'Fetch Sales API', status: 'SUCCESS', durationMs: 1090 },
      'n-3': { nodeId: 'n-3', nodeName: 'AI Sales Insight', status: 'SUCCESS', durationMs: 1490 },
      'n-4': { nodeId: 'n-4', nodeName: 'Send Telegram Alert', status: 'SUCCESS', durationMs: 390 },
    },
    logs: [
      { id: 'el1', timestamp: '18:00:00', level: 'INFO', message: 'Cron trigger executed.' },
      { id: 'el2', timestamp: '18:00:03', level: 'SUCCESS', message: 'Summary delivered to Telegram.' },
    ],
  },
  {
    id: 'exec-103',
    workflowId: 'wf-001',
    workflowName: 'Invoice OCR → AI Extract → Google Sheets',
    status: 'FAILED',
    triggerType: 'trigger.webhook',
    startedAt: '2026-08-27T16:20:00Z',
    completedAt: '2026-08-27T16:20:02Z',
    durationMs: 2100,
    error: 'Corrupt PDF document format. OCR parser engine failed.',
    nodeResults: {
      'node-1': { nodeId: 'node-1', nodeName: 'Invoice Webhook', status: 'SUCCESS', durationMs: 200 },
      'node-2': { nodeId: 'node-2', nodeName: 'OCR Extract PDF', status: 'FAILED', durationMs: 1890, error: 'Corrupt PDF document header.', retryCount: 2 },
    },
    logs: [
      { id: 'fl1', timestamp: '16:20:00', level: 'INFO', message: 'Webhook received payload.' },
      { id: 'fl2', timestamp: '16:20:02', level: 'ERROR', message: 'OCR Engine failed: Corrupt PDF header.' },
    ],
  },
  {
    id: 'exec-104',
    workflowId: 'wf-006',
    workflowName: 'Webhook → AI Extract → Telegram Alert',
    status: 'RUNNING',
    triggerType: 'trigger.webhook',
    startedAt: '2026-08-28T15:40:00Z',
    durationMs: 1500,
    nodeResults: {
      'step-1': { nodeId: 'step-1', nodeName: 'Webhook Receiver', status: 'SUCCESS', durationMs: 150 },
      'step-2': { nodeId: 'step-2', nodeName: 'AI Entity Extraction', status: 'RUNNING', startedAt: '15:40:01' },
      'step-3': { nodeId: 'step-3', nodeName: 'Send Telegram Message', status: 'PENDING' },
    },
    logs: [
      { id: 'rl1', timestamp: '15:40:00', level: 'INFO', message: 'Webhook received request.' },
      { id: 'rl2', timestamp: '15:40:01', level: 'INFO', message: 'Running AI LLM entity extraction...' },
    ],
  },
];

export const MOCK_CONNECTIONS: ConnectionItem[] = [
  { id: 'conn-1', provider: 'gmail', name: 'Company Gmail OAuth', status: 'CONNECTED', createdBy: 'Nguyễn Anh Xuân Trường', createdAt: '2026-08-15T00:00:00Z', lastRunAt: '2026-08-28T11:15:04Z' },
  { id: 'conn-2', provider: 'sheets', name: 'Finance Google Workspace', status: 'CONNECTED', createdBy: 'Nguyễn Anh Xuân Trường', createdAt: '2026-08-15T00:00:00Z', lastRunAt: '2026-08-28T11:15:03Z' },
  { id: 'conn-3', provider: 'telegram', name: 'WEAV Operational Bot', status: 'CONNECTED', createdBy: 'Nguyễn Anh Xuân Trường', createdAt: '2026-08-18T00:00:00Z', lastRunAt: '2026-08-27T18:00:03Z' },
  { id: 'conn-4', provider: 'http', name: 'Internal REST API Key', status: 'CONNECTED', createdBy: 'Lê Văn Nam', createdAt: '2026-08-22T00:00:00Z', lastRunAt: '2026-08-27T18:00:01Z' },
  { id: 'conn-5', provider: 'gmail', name: 'Support Mailbox Backup', status: 'EXPIRED', createdBy: 'Trần Thị Bích', createdAt: '2026-08-01T00:00:00Z' },
];

export const MOCK_NOTIFICATIONS: NotificationItem[] = [
  { id: 'notif-1', type: 'WORKFLOW_COMPLETED', title: 'Execution Succeeded ⚡', message: 'Workflow "Invoice OCR → AI Extract → Google Sheets" completed in 4.2s.', timestamp: '10 phút trước', read: false, link: '/(app)/executions/exec-101' },
  { id: 'notif-2', type: 'WORKFLOW_FAILED', title: 'Execution Failed ⚠️', message: 'Workflow "Invoice OCR → AI Extract → Google Sheets" failed at OCR step.', timestamp: '1 giờ trước', read: false, link: '/(app)/executions/exec-103' },
  { id: 'notif-3', type: 'TELEGRAM_LINKED', title: 'Telegram Linked 🤖', message: 'Telegram Bot @weav_automation_bot linked to workspace.', timestamp: 'Hôm qua', read: true, link: '/(app)/telegram' },
  { id: 'notif-4', type: 'CONNECTION_EXPIRED', title: 'Connection Expired 🔑', message: 'Support Mailbox OAuth token has expired. Please re-authenticate.', timestamp: '2 ngày trước', read: true, link: '/(app)/connections' },
  { id: 'notif-5', type: 'WORKFLOW_PAUSED', title: 'Workflow Paused ⏸️', message: 'Workflow "HTTP Data Pipeline & Sentiment Analysis" was paused by Lê Văn Nam.', timestamp: '3 ngày trước', read: true, link: '/(app)/workflows/wf-005' },
];

export const MOCK_TELEGRAM_STATUS: TelegramStatus = {
  connected: true,
  botUsername: '@weav_automation_bot',
  linkedAccount: 'Nguyễn Anh Xuân Trường (ID: 991204)',
  activityLogs: [
    { id: 't1', timestamp: '11:15:04', direction: 'OUTGOING', message: 'Execution exec-101 completed successfully.' },
    { id: 't2', timestamp: '10:00:00', direction: 'INCOMING', message: 'User sent command: /status exec-101' },
    { id: 't3', timestamp: '08:30:00', direction: 'INCOMING', message: 'User sent command: /list' },
  ],
};
