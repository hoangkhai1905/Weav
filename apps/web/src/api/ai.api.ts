import { delay } from './client';
import type { WorkflowDefinition, WorkflowNode } from '../types/workflow.types';

export interface AiGenerationResult {
  reasoning: string;
  workflowPreview: WorkflowDefinition;
  validation: {
    valid: boolean;
    warnings: string[];
    errors: string[];
  };
}

export const aiApi = {
  async generateWorkflow(prompt: string): Promise<AiGenerationResult> {
    await delay(1200); // simulate model thinking time

    const promptLower = prompt.toLowerCase();
    let triggerType = 'trigger.webhook';
    const nodes: WorkflowNode[] = [
      {
        id: 'ai-gen-1',
        type: 'trigger.webhook',
        name: 'Incoming Webhook Payload',
        config: { path: '/api/v1/generated-hook' },
        position: { x: 100, y: 200 },
      },
      {
        id: 'ai-gen-2',
        type: 'ai.extract',
        name: 'AI Extract Entities',
        config: { schemaDescription: 'Extract target fields from prompt requirement' },
        position: { x: 450, y: 200 },
      },
      {
        id: 'ai-gen-3',
        type: 'email.send',
        name: 'Send Notification Email',
        config: { to: 'user@example.com', subject: 'AI Workflow Result' },
        position: { x: 800, y: 200 },
      },
    ];
    const edges = [
      { id: 'gen-e1-2', source: 'ai-gen-1', target: 'ai-gen-2' },
      { id: 'gen-e2-3', source: 'ai-gen-2', target: 'ai-gen-3' },
    ];

    if (promptLower.includes('telegram')) {
      triggerType = 'trigger.telegram';
      nodes[0] = {
        id: 'ai-gen-1',
        type: 'trigger.telegram',
        name: 'Telegram Bot Command',
        config: { command: '/start' },
        position: { x: 100, y: 200 },
      };
      nodes.push({
        id: 'ai-gen-4',
        type: 'telegram.send_message',
        name: 'Reply to Telegram',
        config: { chatId: 'chat_id', text: 'Processing complete.' },
        position: { x: 800, y: 350 },
      });
      edges.push({ id: 'gen-e2-4', source: 'ai-gen-2', target: 'ai-gen-4' });
    } else if (promptLower.includes('sheet') || promptLower.includes('excel')) {
      nodes.push({
        id: 'ai-gen-sheet',
        type: 'sheets.append',
        name: 'Save to Google Sheets',
        config: { spreadsheetId: 'sheet-generated-1', sheetName: 'Data' },
        position: { x: 800, y: 100 },
      });
      edges.push({ id: 'gen-e2-sheet', source: 'ai-gen-2', target: 'ai-gen-sheet' });
    }

    const workflowPreview: WorkflowDefinition = {
      id: 'wf-preview-' + Date.now().toString(36),
      name: prompt.length > 40 ? prompt.slice(0, 40) + '...' : prompt,
      description: `Generated from AI Prompt: "${prompt}"`,
      status: 'DRAFT',
      version: 1,
      triggerType,
      nodes,
      edges,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ownerName: 'Nguyễn Anh Xuân Trường',
      workspaceId: 'ws-main',
    };

    return {
      reasoning: `Selected trigger "${triggerType}" based on user intent. Appended AI parsing node followed by output notification channels. Schema validated against WEAV canonical model V1.`,
      workflowPreview,
      validation: {
        valid: true,
        warnings: [
          'Node "Send Notification Email" requires recipient credentials in Connection settings.',
        ],
        errors: [],
      },
    };
  },
};
