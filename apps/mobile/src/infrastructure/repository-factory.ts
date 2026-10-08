import type { AuthRepository } from '../domain/auth/auth.types';
import type { AccountRepository } from '../domain/auth/account.types';
import type { WorkflowRepository } from '../domain/workflow/workflow.types';
import type { ExecutionRepository } from '../domain/execution/execution.types';
import type { WorkspaceRepository } from '../domain/workspace/workspace.types';
import type { ConnectionRepository } from '../domain/connection/connection.types';
import type { NotificationRepository } from '../domain/notification/notification.types';
import type { AIRepository } from '../domain/ai/ai.types';
import type { AssistantRepository } from '../domain/assistant/assistant.types';

import { MockAuthRepository } from './mock/mock-auth.repository';
import { HttpAuthRepository } from './http/http-auth.repository';

import { HttpWorkflowRepository } from './http/http-workflow.repository';
import { HttpExecutionRepository } from './http/http-execution.repository';
import { HttpConnectionRepository } from './http/http-connection.repository';
import { HttpAiRepository } from './http/http-ai.repository';
import { HttpAssistantRepository } from './http/http-assistant.repository';
import { HttpAccountRepository } from './http/http-account.repository';

import { MockWorkspaceRepository } from './mock/mock-workspace.repository';
import { HttpWorkspaceRepository } from './http/http-workspace.repository';

import { MockNotificationRepository } from './mock/mock-notification.repository';
import { HttpNotificationRepository } from './http/http-notification.repository';

const API_MODE = process.env.EXPO_PUBLIC_API_MODE || 'http';
const isMockMode = API_MODE === 'mock';

export const authRepository: AuthRepository = isMockMode
  ? new MockAuthRepository()
  : new HttpAuthRepository();

export const workspaceRepository: WorkspaceRepository = isMockMode
  ? new MockWorkspaceRepository()
  : new HttpWorkspaceRepository();

export const notificationRepository: NotificationRepository = isMockMode
  ? new MockNotificationRepository()
  : new HttpNotificationRepository();

// Workflow, execution, connection, AI and assistant always use the real gateway (no mock
// layer): EXPO_PUBLIC_API_MODE=mock only fakes auth, workspace and notifications.
export const workflowRepository: WorkflowRepository = new HttpWorkflowRepository();
export const executionRepository: ExecutionRepository = new HttpExecutionRepository();
export const connectionRepository: ConnectionRepository = new HttpConnectionRepository();
export const aiRepository: AIRepository = new HttpAiRepository();
export const assistantRepository: AssistantRepository = new HttpAssistantRepository();

// Avatar and linked Google accounts exist only on the real gateway (mock mode shows neither).
export const accountRepository: AccountRepository = isMockMode
  ? { getAvatarUrl: async () => null, deleteAvatar: async () => undefined, listOAuthAccounts: async () => [] }
  : new HttpAccountRepository();
