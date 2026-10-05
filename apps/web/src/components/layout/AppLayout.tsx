import React, { useEffect } from 'react';
import { Outlet, Navigate, useMatch } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { useAuthStore } from '../../store/useAuthStore';
import { useUIStore } from '../../store/useUIStore';
import { useWorkspaceSessionCleanup } from '../../hooks/useWorkspace';
import { useNotificationSessionCleanup } from '../../hooks/useNotifications';
import { isWorkflowMockMode } from '../../api/workflow.api';

export const AppLayout: React.FC = () => {
  const { isAuthenticated } = useAuthStore();
  const { initTheme } = useUIStore();
  const matchEditor = useMatch('/workflows/:workflowId');
  const matchBuilder = useMatch('/workflows/:workflowId/builder');
  const matchWorkflowRuns = useMatch('/workflows/:workflowId/executions');
  const matchRunDetail = useMatch('/executions/:executionId');
  const isNewRoute = matchEditor?.params.workflowId === 'new';
  const isEditorRoute = Boolean(matchEditor || matchBuilder) && !isNewRoute;
  const isRunsRoute = !isWorkflowMockMode && Boolean(matchWorkflowRuns || matchRunDetail);
  const fullBleed = isEditorRoute || isRunsRoute;
  useWorkspaceSessionCleanup();
  useNotificationSessionCleanup();

  useEffect(() => {
    initTheme();
  }, [initTheme]);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground font-sans">
      <Sidebar collapsed={fullBleed} />
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        {!fullBleed && <Topbar />}
        <main className={`relative min-w-0 flex-1 bg-background ${fullBleed ? 'overflow-hidden' : 'overflow-x-hidden overflow-y-auto p-4 sm:p-5'}`}>
          <Outlet />
        </main>
      </div>
    </div>
  );
};
