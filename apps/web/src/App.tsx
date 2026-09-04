import { Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { DashboardPage } from './pages/DashboardPage';
import { WorkflowsPage } from './pages/WorkflowsPage';
import { CreateWorkflowPage } from './pages/CreateWorkflowPage';
import { WorkflowBuilderPage } from './pages/WorkflowBuilderPage';
import { AiGeneratorPage } from './pages/AiGeneratorPage';
import { ExecutionsPage } from './pages/ExecutionsPage';
import { ExecutionDetailPage } from './pages/ExecutionDetailPage';
import { ConnectionsPage } from './pages/ConnectionsPage';
import { WorkspacePage } from './pages/WorkspacePage';
import { TelegramPage } from './pages/TelegramPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { SettingsPage } from './pages/SettingsPage';
import { HelpPage } from './pages/HelpPage';

export function App() {
  return (
    <Routes>
      {/* Auth Routes */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      {/* Main Protected Application Layout */}
      <Route element={<AppLayout />}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />

        {/* Workflows */}
        <Route path="/workflows" element={<WorkflowsPage />} />
        <Route path="/workflows/new" element={<CreateWorkflowPage />} />
        <Route path="/workflows/:workflowId" element={<WorkflowBuilderPage />} />
        <Route path="/workflows/:workflowId/builder" element={<WorkflowBuilderPage />} />
        <Route path="/workflows/:workflowId/executions" element={<ExecutionsPage />} />

        {/* Executions */}
        <Route path="/executions" element={<ExecutionsPage />} />
        <Route path="/executions/:executionId" element={<ExecutionDetailPage />} />

        {/* Connections */}
        <Route path="/connections" element={<ConnectionsPage />} />

        {/* Workspace */}
        <Route path="/workspace" element={<WorkspacePage />} />
        <Route path="/workspace/members" element={<WorkspacePage />} />
        <Route path="/workspace/settings" element={<WorkspacePage />} />

        {/* AI Generator */}
        <Route path="/ai" element={<Navigate to="/ai/workflow-generator" replace />} />
        <Route path="/ai/workflow-generator" element={<AiGeneratorPage />} />

        {/* Telegram */}
        <Route path="/telegram" element={<TelegramPage />} />

        {/* Notifications & Settings & Help */}
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/settings/profile" element={<SettingsPage />} />
        <Route path="/settings/security" element={<SettingsPage />} />
        <Route path="/help" element={<HelpPage />} />
      </Route>

      {/* Catch-all Fallback */}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

export default App;
