import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { WorkspaceHeader, WorkspaceTabs } from './components/workspace/WorkspaceTabs';
import { AppLayout } from './components/layout/AppLayout';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { GoogleOAuthCallbackPage } from './pages/GoogleOAuthCallbackPage';
import { DashboardPage } from './pages/DashboardPage';
import { WorkflowsPage } from './pages/WorkflowsPage';
import { CreateWorkflowPage } from './pages/CreateWorkflowPage';
import { WorkflowBuilderPage } from './pages/WorkflowBuilderPage';
import { AiGeneratorPage } from './pages/AiGeneratorPage';
import { AssistantPage } from './pages/AssistantPage';
import { LiveWorkflowExecutionsPage } from './pages/LiveWorkflowExecutionsPage';
import { LiveExecutionDetailPage } from './pages/LiveExecutionDetailPage';
import { ConnectionsPage } from './pages/ConnectionsPage';
import { WorkspacePage } from './pages/WorkspacePage';
import { TelegramPage } from './pages/TelegramPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { SettingsPage } from './pages/SettingsPage';
import { HelpPage } from './pages/HelpPage';
import { AdminUsersPage } from './pages/AdminUsersPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { Toaster } from 'sonner';
import { useEffect } from 'react';
import { useI18nStore } from './store/useI18nStore';
import { useUIStore } from './store/useUIStore';

/** Redirect that keeps query string, hash and router state (OAuth return links rely on them). */
function RedirectKeepQuery({ to }: { to: string }) {
  const location = useLocation();
  return <Navigate to={{ pathname: to, search: location.search, hash: location.hash }} state={location.state} replace />;
}

function WorkspaceConnectionsPage() {
  return (
    <div className="mx-auto max-w-7xl space-y-4 pb-12">
      <WorkspaceHeader />
      <WorkspaceTabs />
      <ConnectionsPage embedded />
    </div>
  );
}

export function App() {
  const t = useI18nStore((state) => state.t);
  const initTheme = useUIStore((state) => state.initTheme);
  useEffect(() => {
    initTheme();
  }, [initTheme]);
  return (
    <>
      <Toaster position="top-right" offset={{ top: 64, right: 16 }} richColors closeButton containerAriaLabel={t('toast.region')} />
      <Routes>
      {/* Auth Routes */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/auth/callback" element={<GoogleOAuthCallbackPage />} />

      {/* Main Protected Application Layout */}
      <Route element={<AppLayout />}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />

        {/* Workflows */}
        <Route path="/workflows" element={<WorkflowsPage />} />
        <Route path="/workflows/new" element={<CreateWorkflowPage />} />
        <Route path="/workflows/:workflowId" element={<WorkflowBuilderPage />} />
        <Route path="/workflows/:workflowId/builder" element={<WorkflowBuilderPage />} />
        <Route path="/workflows/:workflowId/executions" element={<LiveWorkflowExecutionsPage />} />

        {/* Executions */}
        <Route path="/executions" element={<Navigate to="/workflows" replace />} />
        <Route path="/executions/:executionId" element={<LiveExecutionDetailPage />} />

        {/* Connections */}
        <Route path="/connections" element={<RedirectKeepQuery to="/workspace/connections" />} />

        {/* Workspace */}
        <Route path="/workspace" element={<WorkspacePage />} />
        <Route path="/workspace/members" element={<WorkspacePage />} />
        <Route path="/workspace/settings" element={<WorkspacePage />} />
        <Route path="/workspace/connections" element={<WorkspaceConnectionsPage />} />

        {/* AI Generator */}
        <Route path="/ai" element={<Navigate to="/ai/workflow-generator" replace />} />
        <Route path="/ai/workflow-generator" element={<AiGeneratorPage />} />

        <Route path="/assistant" element={<AssistantPage />} />

        {/* Telegram */}
        <Route path="/telegram" element={<TelegramPage />} />

        {/* Notifications & Settings & Help */}
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/settings/profile" element={<SettingsPage />} />
        <Route path="/settings/security" element={<SettingsPage />} />
        <Route path="/help" element={<HelpPage />} />
        <Route path="/admin/users" element={<AdminUsersPage />} />
      </Route>

      {/* Catch-all Fallback */}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </>
  );
}

export default App;
