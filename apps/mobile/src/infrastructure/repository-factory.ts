import type { AuthRepository } from '../domain/auth/auth.types';
import type { WorkflowRepository } from '../domain/workflow/workflow.types';
import type { ExecutionRepository } from '../domain/execution/execution.types';
import type { WorkspaceRepository } from '../domain/workspace/workspace.types';
import type { ConnectionRepository } from '../domain/connection/connection.types';
import type { NotificationRepository } from '../domain/notification/notification.types';
import type { TelegramRepository } from '../domain/telegram/telegram.types';
import type { AIRepository } from '../domain/ai/ai.types';

import { MockAuthRepository } from './mock/mock-auth.repository';
import { HttpAuthRepository } from './http/http-auth.repository';

import { MockWorkflowRepository } from './mock/mock-workflow.repository';
import { HttpWorkflowRepository } from './http/http-workflow.repository';

import { MockExecutionRepository } from './mock/mock-execution.repository';
import { HttpExecutionRepository } from './http/http-execution.repository';

import { MockWorkspaceRepository } from './mock/mock-workspace.repository';
import { HttpWorkspaceRepository } from './http/http-workspace.repository';

import { MockConnectionRepository } from './mock/mock-connection.repository';
import { HttpConnectionRepository } from './http/http-connection.repository';

import { MockNotificationRepository } from './mock/mock-notification.repository';
import { HttpNotificationRepository } from './http/http-notification.repository';

import { MockTelegramRepository } from './mock/mock-telegram.repository';
import { HttpTelegramRepository } from './http/http-telegram.repository';

import { MockAiRepository } from './mock/mock-ai.repository';
import { HttpAiRepository } from './http/http-ai.repository';

const API_MODE = process.env.EXPO_PUBLIC_API_MODE || 'http';
const isMockMode = API_MODE === 'mock';

export const authRepository: AuthRepository = isMockMode
  ? new MockAuthRepository()
  : new HttpAuthRepository();

export const workflowRepository: WorkflowRepository = isMockMode
  ? new MockWorkflowRepository()
  : new HttpWorkflowRepository();

export const executionRepository: ExecutionRepository = isMockMode
  ? new MockExecutionRepository()
  : new HttpExecutionRepository();

export const workspaceRepository: WorkspaceRepository = isMockMode
  ? new MockWorkspaceRepository()
  : new HttpWorkspaceRepository();

export const connectionRepository: ConnectionRepository = isMockMode
  ? new MockConnectionRepository()
  : new HttpConnectionRepository();

export const notificationRepository: NotificationRepository = isMockMode
  ? new MockNotificationRepository()
  : new HttpNotificationRepository();

export const telegramRepository: TelegramRepository = isMockMode
  ? new MockTelegramRepository()
  : new HttpTelegramRepository();

export const aiRepository: AIRepository = isMockMode
  ? new MockAiRepository()
  : new HttpAiRepository();
