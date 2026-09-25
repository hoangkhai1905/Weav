import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  AlertCircle,
  Building2,
  Check,
  Loader2,
  RefreshCw,
  ShieldCheck,
  UserPlus,
  Users,
  X,
  Zap,
} from 'lucide-react';
import type { WorkspaceMember } from '../types/workflow.types';
import {
  type WorkspacePage as WorkspacePageResult,
  type WorkspaceMemberPage,
  type WorkspaceSummary,
  WorkspaceApiError,
  validateWorkspaceMemberEmail,
  validateWorkspaceName,
  workspaceApi,
} from '../api/workspace.api';
import { useWorkspaceContext, workspaceKeys } from '../hooks/useWorkspace';
import { useWorkspaceStore } from '../store/useWorkspaceStore';
import { useAuthStore } from '../store/useAuthStore';
import { useI18nStore } from '../store/useI18nStore';
import { ConfirmButton } from '../components/common/ConfirmButton';
import { buttonPress, pageVariants, reducedMotionVariants, staggerContainer, staggerItem } from '../lib/motion';

function getWorkspaceErrorMessage(error: unknown, t: (key: string) => string): string {
  if (error instanceof WorkspaceApiError) {
    const errorKeys: Record<string, string> = {
      INVALID_REQUEST: 'workspace.error.invalid',
      VALIDATION_FAILED: 'workspace.error.invalid',
      UNAUTHENTICATED: 'workspace.error.unauthenticated',
      FORBIDDEN: 'workspace.error.forbidden',
      WORKSPACE_NOT_FOUND: 'workspace.error.not_found',
      MEMBER_NOT_FOUND: 'workspace.error.member_not_found',
      CONFLICT: 'workspace.error.conflict',
      RATE_LIMITED: 'workspace.error.rate_limited',
      INVALID_RESPONSE: 'workspace.error.invalid_response',
      WORKSPACE_UNAVAILABLE: 'workspace.error.unavailable',
    };
    return t(errorKeys[error.code] ?? 'workspace.error.unavailable');
  }
  return t('workspace.error.unavailable');
}

function isCurrentUser(userId: string | null): boolean {
  return Boolean(userId && useAuthStore.getState().isAuthenticated && useAuthStore.getState().user?.id === userId);
}

function mergeWorkspacePage(
  page: WorkspacePageResult | undefined,
  workspace: WorkspaceSummary,
): WorkspacePageResult {
  const current = page ?? { items: [], page: 0, size: 20, totalElements: 0, totalPages: 0 };
  const exists = current.items.some((item) => item.id === workspace.id);
  const items = exists
    ? current.items.map((item) => item.id === workspace.id ? workspace : item)
    : [...current.items, workspace];
  const totalElements = exists ? current.totalElements : current.totalElements + 1;
  return {
    ...current,
    items,
    totalElements,
    totalPages: Math.max(current.totalPages, totalElements > 0 ? 1 : 0),
  };
}

function replaceWorkspaceInPage(
  page: WorkspacePageResult | undefined,
  workspace: WorkspaceSummary,
): WorkspacePageResult | undefined {
  if (!page) return page;
  return {
    ...page,
    items: page.items.map((item) => item.id === workspace.id ? workspace : item),
  };
}

function replaceMemberInPage(
  page: WorkspaceMemberPage | undefined,
  member: WorkspaceMember,
): WorkspaceMemberPage | undefined {
  if (!page) return page;
  return {
    ...page,
    items: page.items.map((item) => item.id === member.id ? member : item),
  };
}

function removeMemberFromPage(
  page: WorkspaceMemberPage | undefined,
  memberId: string,
): WorkspaceMemberPage | undefined {
  if (!page) return page;
  const items = page.items.filter((item) => item.id !== memberId);
  return {
    ...page,
    items,
    totalElements: Math.max(0, page.totalElements - (items.length === page.items.length ? 0 : 1)),
    totalPages: items.length ? page.totalPages : 0,
  };
}

interface WorkspaceRenameFormProps {
  workspace: WorkspaceSummary;
  isPending: boolean;
  error: string;
  success: string;
  onSubmit: (name: string) => void;
}

function WorkspaceRenameForm({ workspace, isPending, error, success, onSubmit }: WorkspaceRenameFormProps) {
  const { t } = useI18nStore();
  const [name, setName] = useState(workspace.name);

  return (
    <form
      data-testid="workspace-rename-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(name);
      }}
      className="mt-3 flex w-full flex-col gap-2 sm:flex-row sm:items-start"
      aria-label={t('workspace.rename_form')}
    >
      <div className="min-w-0 flex-1">
        <label className="sr-only" htmlFor="workspace-rename-name">{t('workspace.new_name')}</label>
        <input
          id="workspace-rename-name"
          data-testid="workspace-rename-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={isPending}
          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:cursor-wait disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        />
        {error && <p data-testid="workspace-rename-error" className="mt-1 text-xs text-rose-700 dark:text-rose-300" role="alert">{error}</p>}
        {success && <p data-testid="workspace-rename-success" className="mt-1 text-xs text-emerald-700 dark:text-emerald-300" role="status">{success}</p>}
      </div>
      <button
        type="submit"
        data-testid="workspace-rename-submit"
        disabled={isPending}
        className="inline-flex items-center justify-center rounded-xl border border-slate-300 px-3.5 py-2 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
      >
        {isPending ? t('workspace.saving') : t('workspace.rename')}
      </button>
    </form>
  );
}

export function WorkspacePage() {
  const { t } = useI18nStore();
  const {
    userId,
    activeWorkspace,
    activeWorkspaceId,
    workspaces,
    workspacesQuery,
    membersQuery,
  } = useWorkspaceContext();
  const queryClient = useQueryClient();
  const selectWorkspace = useWorkspaceStore((state) => state.selectWorkspace);
  const removeWorkspace = useWorkspaceStore((state) => state.removeWorkspace);
  const workspaceAccessError = useWorkspaceStore((state) => state.workspaceAccessError);
  const [inviteEmail, setInviteEmail] = useState('');
  const [memberActionError, setMemberActionError] = useState('');
  const [memberActionSuccess, setMemberActionSuccess] = useState('');
  const [memberMutationKey, setMemberMutationKey] = useState<string | null>(null);
  const [createName, setCreateName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [createSuccess, setCreateSuccess] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameError, setRenameError] = useState('');
  const [renameSuccess, setRenameSuccess] = useState('');
  const prefersReducedMotion = useReducedMotion();
  const pageMotion = prefersReducedMotion ? reducedMotionVariants : pageVariants;
  const listMotion = prefersReducedMotion ? reducedMotionVariants : staggerContainer;
  const itemMotion = prefersReducedMotion ? reducedMotionVariants : staggerItem;
  const membersLoading = Boolean(activeWorkspaceId && (membersQuery.isPending || membersQuery.isFetching));
  const members = !membersLoading && !membersQuery.isError ? membersQuery.data?.items ?? [] : [];
  const currentMember = userId ? members.find((member) => member.id === userId) ?? null : null;
  const canManageMembers = currentMember?.role === 'OWNER';
  const memberActionsDisabled = Boolean(memberMutationKey) || !canManageMembers;

  useEffect(() => {
    const error = membersQuery.error;
    if (
      activeWorkspaceId &&
      error instanceof WorkspaceApiError &&
      (error.status === 403 || error.status === 404)
    ) {
      removeWorkspace(activeWorkspaceId, getWorkspaceErrorMessage(error, t));
    }
  }, [activeWorkspaceId, membersQuery.error, removeWorkspace, t]);

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    const validationError = validateWorkspaceName(createName, false);
    if (validationError) {
      setCreateError(t(createName.trim().length > 255 ? 'workspace.error.name_too_long' : 'workspace.error.name_required'));
      setCreateSuccess('');
      return;
    }
    if (!userId || isCreating) return;

    const mutationUserId = userId;
    setIsCreating(true);
    setCreateError('');
    setCreateSuccess('');
    try {
      const created = await workspaceApi.createWorkspace(createName.trim() || undefined);
      if (!isCurrentUser(mutationUserId)) return;

      const listKey = workspaceKeys.list(mutationUserId);
      const detailKey = workspaceKeys.detail(mutationUserId, created.id);
      queryClient.setQueryData<WorkspacePageResult>(listKey, (page) => mergeWorkspacePage(page, created));
      queryClient.setQueryData(detailKey, created);
      const currentWorkspaces = useWorkspaceStore.getState().workspaces;
      useWorkspaceStore.getState().setWorkspaces(mergeWorkspacePage({
        items: currentWorkspaces,
        page: 0,
        size: Math.max(currentWorkspaces.length, 20),
        totalElements: currentWorkspaces.length,
        totalPages: currentWorkspaces.length ? 1 : 0,
      }, created).items);
      useWorkspaceStore.getState().selectWorkspace(created.id);
      await queryClient.invalidateQueries({ queryKey: listKey });
      if (isCurrentUser(mutationUserId)) {
        queryClient.setQueryData<WorkspacePageResult>(listKey, (page) => mergeWorkspacePage(page, created));
        useWorkspaceStore.getState().setWorkspaces(
          mergeWorkspacePage({
            items: useWorkspaceStore.getState().workspaces,
            page: 0,
            size: 20,
            totalElements: useWorkspaceStore.getState().workspaces.length,
            totalPages: useWorkspaceStore.getState().workspaces.length ? 1 : 0,
          }, created).items,
        );
        useWorkspaceStore.getState().selectWorkspace(created.id);
        setCreateName('');
        setCreateSuccess(t('workspace.created').replace('{name}', created.name));
      }
    } catch (error) {
      if (isCurrentUser(mutationUserId)) {
        setCreateError(getWorkspaceErrorMessage(error, t));
        setCreateSuccess('');
      }
    } finally {
      setIsCreating(false);
    }
  };

  const handleRename = async (name: string) => {
    const validationError = validateWorkspaceName(name, true);
    if (validationError) {
      setRenameError(t(name.trim() ? 'workspace.error.name_too_long' : 'workspace.error.name_required'));
      setRenameSuccess('');
      return;
    }
    if (!userId || !activeWorkspaceId || isRenaming) return;

    const mutationUserId = userId;
    const workspaceId = activeWorkspaceId;
    setIsRenaming(true);
    setRenameError('');
    setRenameSuccess('');
    try {
      const renamed = await workspaceApi.renameWorkspace(workspaceId, { name: name.trim() });
      if (!isCurrentUser(mutationUserId)) return;

      const listKey = workspaceKeys.list(mutationUserId);
      const detailKey = workspaceKeys.detail(mutationUserId, workspaceId);
      queryClient.setQueryData<WorkspacePageResult>(listKey, (page) => replaceWorkspaceInPage(page, renamed));
      queryClient.setQueryData(detailKey, renamed);
      useWorkspaceStore.getState().setWorkspaces(
        useWorkspaceStore.getState().workspaces.map((workspace) => workspace.id === renamed.id ? renamed : workspace),
      );
      await queryClient.invalidateQueries({ queryKey: listKey });
      if (isCurrentUser(mutationUserId)) setRenameSuccess(t('workspace.renamed').replace('{name}', renamed.name));
    } catch (error) {
      if (isCurrentUser(mutationUserId)) {
        if (error instanceof WorkspaceApiError && error.status === 404) {
          useWorkspaceStore.getState().removeWorkspace(workspaceId, getWorkspaceErrorMessage(error, t));
          await queryClient.invalidateQueries({ queryKey: workspaceKeys.list(mutationUserId) });
        }
        setRenameError(getWorkspaceErrorMessage(error, t));
        setRenameSuccess('');
      }
    } finally {
      setIsRenaming(false);
    }
  };

  const invalidateMemberScope = async (mutationUserId: string, workspaceId: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: workspaceKeys.list(mutationUserId) }),
      queryClient.invalidateQueries({ queryKey: workspaceKeys.detail(mutationUserId, workspaceId) }),
      queryClient.invalidateQueries({ queryKey: workspaceKeys.members(mutationUserId, workspaceId) }),
    ]);
  };

  const isCurrentMemberContext = (mutationUserId: string, workspaceId: string) => (
    isCurrentUser(mutationUserId)
    && useWorkspaceStore.getState().activeWorkspaceId === workspaceId
  );

  const handleTogglePermission = async (
    member: WorkspaceMember,
    permission: 'canPublishWorkflow' | 'canManageWorkflowState',
  ) => {
    if (!activeWorkspaceId || !canManageMembers || memberMutationKey) return;
    const mutationUserId = userId;
    const workspaceId = activeWorkspaceId;
    if (!mutationUserId) return;
    setMemberMutationKey(`permissions:${member.id}:${permission}`);
    setMemberActionError('');
    setMemberActionSuccess('');
    try {
      const updated = await workspaceApi.updateMemberPermissions(workspaceId, member.id, {
        canPublishWorkflow: permission === 'canPublishWorkflow'
          ? !member.canPublishWorkflow
          : Boolean(member.canPublishWorkflow),
        canManageWorkflowState: permission === 'canManageWorkflowState'
          ? !member.canManageWorkflowState
          : Boolean(member.canManageWorkflowState),
      });
      if (isCurrentMemberContext(mutationUserId, workspaceId)) {
        await invalidateMemberScope(mutationUserId, workspaceId);
        queryClient.setQueryData<WorkspaceMemberPage>(
          workspaceKeys.members(mutationUserId, workspaceId),
          (page) => replaceMemberInPage(page, updated),
        );
      }
    } catch (error) {
      if (isCurrentMemberContext(mutationUserId, workspaceId)) {
        setMemberActionError(getWorkspaceErrorMessage(error, t));
      }
    } finally {
      setMemberMutationKey(null);
    }
  };

  const handleAddMember = async (event: React.FormEvent) => {
    event.preventDefault();
    const validationError = validateWorkspaceMemberEmail(inviteEmail);
    if (validationError) {
      setMemberActionError(t(inviteEmail.trim() ? 'workspace.error.email_too_long' : 'workspace.error.member_email_required'));
      setMemberActionSuccess('');
      return;
    }
    if (!activeWorkspaceId || !canManageMembers || memberMutationKey) return;
    const mutationUserId = userId;
    const workspaceId = activeWorkspaceId;
    if (!mutationUserId) return;
    setMemberMutationKey(`add:${workspaceId}`);
    setMemberActionError('');
    setMemberActionSuccess('');
    try {
      const added = await workspaceApi.addMember(workspaceId, { email: inviteEmail.trim() });
      if (isCurrentMemberContext(mutationUserId, workspaceId)) {
        setInviteEmail('');
        setMemberActionSuccess(t('workspace.member_added').replace('{name}', added.name));
        await invalidateMemberScope(mutationUserId, workspaceId);
      }
    } catch (error) {
      if (isCurrentMemberContext(mutationUserId, workspaceId)) {
        setMemberActionError(getWorkspaceErrorMessage(error, t));
      }
    } finally {
      setMemberMutationKey(null);
    }
  };

  const handleRemove = async (memberId: string) => {
    if (!activeWorkspaceId || !canManageMembers || memberMutationKey) return;
    const mutationUserId = userId;
    const workspaceId = activeWorkspaceId;
    if (!mutationUserId) return;
    setMemberMutationKey(`remove:${memberId}`);
    setMemberActionError('');
    setMemberActionSuccess('');
    try {
      await workspaceApi.removeMember(workspaceId, memberId);
      if (isCurrentMemberContext(mutationUserId, workspaceId)) {
        await invalidateMemberScope(mutationUserId, workspaceId);
        queryClient.setQueryData<WorkspaceMemberPage>(
          workspaceKeys.members(mutationUserId, workspaceId),
          (page) => removeMemberFromPage(page, memberId),
        );
      }
    } catch (error) {
      if (isCurrentMemberContext(mutationUserId, workspaceId)) {
        setMemberActionError(getWorkspaceErrorMessage(error, t));
      }
    } finally {
      setMemberMutationKey(null);
    }
  };

  const handleLeave = async () => {
    if (!activeWorkspaceId || currentMember?.role !== 'MEMBER' || memberMutationKey) return;
    const mutationUserId = userId;
    const workspaceId = activeWorkspaceId;
    if (!mutationUserId) return;
    setMemberMutationKey(`leave:${workspaceId}`);
    setMemberActionError('');
    setMemberActionSuccess('');
    try {
      await workspaceApi.leaveWorkspace(workspaceId);
      if (!isCurrentMemberContext(mutationUserId, workspaceId)) return;
      queryClient.removeQueries({ queryKey: workspaceKeys.members(mutationUserId, workspaceId) });
      queryClient.removeQueries({ queryKey: workspaceKeys.detail(mutationUserId, workspaceId) });
      removeWorkspace(workspaceId);
      await queryClient.invalidateQueries({ queryKey: workspaceKeys.list(mutationUserId) });
    } catch (error) {
      if (isCurrentMemberContext(mutationUserId, workspaceId)) {
        setMemberActionError(getWorkspaceErrorMessage(error, t));
      }
    } finally {
      setMemberMutationKey(null);
    }
  };

  return (
    <motion.div
      data-testid="workspace-page"
      className="space-y-6 max-w-7xl mx-auto pb-10"
      initial="initial"
      animate="animate"
      variants={pageMotion}
    >
      <motion.div variants={itemMotion} className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 text-blue-600 dark:border-blue-400/20 dark:bg-blue-400/10 dark:text-blue-300">
            <Building2 size={17} aria-hidden="true" />
          </span>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">{t('workspace.title')}</h1>
        </div>
        <p className="max-w-2xl text-xs text-slate-600 dark:text-slate-400">{t('workspace.subtitle')}</p>
      </motion.div>

      <motion.section variants={itemMotion} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:shadow-xl" aria-label={t('workspace.title')}>
        {workspacesQuery.isPending && (
          <div data-testid="workspace-loading" className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <Loader2 size={16} className="animate-spin" aria-hidden="true" />
            <span>{t('workspace.loading')}</span>
          </div>
        )}

        {workspacesQuery.isError && (
          <div data-testid="workspace-error" className="flex flex-col gap-3 text-sm text-rose-700 dark:text-rose-300" role="alert">
            <div className="flex items-start gap-2">
              <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>{getWorkspaceErrorMessage(workspacesQuery.error, t)}</span>
            </div>
            <button
              type="button"
              onClick={() => void workspacesQuery.refetch()}
              className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold hover:bg-rose-50 dark:border-rose-900/70 dark:hover:bg-rose-950/30"
            >
              <RefreshCw size={13} aria-hidden="true" />
              {t('workspace.retry')}
            </button>
          </div>
        )}

        {workspacesQuery.isSuccess && workspaces.length === 0 && (
          <div data-testid="workspace-empty" className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-amber-500" aria-hidden="true" />
            <span>{t('workspace.none_accessible')}</span>
          </div>
        )}

        {workspaces.length > 0 && (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <label htmlFor="workspace-selector" className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
                {t('nav.workspace')}
              </label>
              <select
                id="workspace-selector"
                data-testid="workspace-selector"
                value={activeWorkspaceId ?? ''}
                onChange={(event) => {
                  selectWorkspace(event.target.value || null);
                }}
                className="min-w-64 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              >
                {workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
                ))}
              </select>
            </div>
            {activeWorkspace && (
              <p data-testid="workspace-selected-name" className="text-xs text-slate-500 dark:text-slate-400">
                {t('workspace.selected')} <span className="font-semibold text-slate-800 dark:text-slate-200">{activeWorkspace.name}</span>
              </p>
            )}
          </div>
        )}

        <form
          data-testid="workspace-create-form"
          onSubmit={handleCreate}
          className="mt-5 flex flex-col gap-2 border-t border-slate-200 pt-4 dark:border-slate-800 sm:flex-row sm:items-start"
          aria-label={t('workspace.create')}
        >
          <div className="min-w-0 flex-1">
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400" htmlFor="workspace-create-name">
              {t('workspace.new_name')} <span className="font-normal normal-case tracking-normal">{t('workspace.optional')}</span>
            </label>
            <input
              id="workspace-create-name"
              data-testid="workspace-create-name"
              value={createName}
              onChange={(event) => {
                setCreateName(event.target.value);
                setCreateError('');
                setCreateSuccess('');
              }}
              placeholder={t('workspace.name_placeholder')}
              disabled={isCreating}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:cursor-wait disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
            />
            {createError && <p data-testid="workspace-create-error" className="mt-1 text-xs text-rose-700 dark:text-rose-300" role="alert">{createError}</p>}
            {createSuccess && <p data-testid="workspace-create-success" className="mt-1 text-xs text-emerald-700 dark:text-emerald-300" role="status">{createSuccess}</p>}
          </div>
          <button
            type="submit"
            data-testid="workspace-create-submit"
            disabled={isCreating || !userId}
            className="mt-6 inline-flex items-center justify-center rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-bold text-white shadow-sm shadow-blue-600/20 transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 sm:mt-6"
          >
            {isCreating ? t('workspace.creating') : t('workspace.create')}
          </button>
        </form>

        {workspaceAccessError && (
          <div data-testid="workspace-members-error" className="mt-3 flex items-start gap-2 text-xs text-rose-700 dark:text-rose-300" role="alert">
            <AlertCircle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>{workspaceAccessError} {t('workspace.select_another')}</span>
          </div>
        )}
      </motion.section>

      {activeWorkspace && (
        <>
          <motion.section variants={itemMotion} className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label={t('workspace.summary')}>
            {[
              { label: t('workspace.members'), value: members.length, icon: Users, tone: 'text-blue-600 dark:text-blue-300 bg-blue-50 dark:bg-blue-400/10' },
              { label: t('workspace.publishing_access'), value: members.filter((member) => member.canPublishWorkflow).length, icon: ShieldCheck, tone: 'text-emerald-600 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-400/10' },
              { label: t('workspace.environment'), value: t('workspace.environment.production'), icon: Zap, tone: 'text-amber-600 dark:text-amber-300 bg-amber-50 dark:bg-amber-400/10' },
            ].map(({ label, value, icon: Icon, tone }) => (
              <motion.div key={label} variants={itemMotion} whileHover={prefersReducedMotion ? undefined : { y: -2, transition: { duration: 0.15 } }} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:shadow-lg">
                <span className={`flex size-9 items-center justify-center rounded-lg ${tone}`}><Icon size={17} aria-hidden="true" /></span>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">{label}</p>
                  <p className="mt-0.5 text-lg font-bold tabular-nums text-slate-900 dark:text-slate-100">{value}</p>
                </div>
              </motion.div>
            ))}
          </motion.section>

          <motion.section variants={itemMotion} className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:shadow-xl md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h2 data-testid="workspace-selected-heading" className="text-base font-bold text-slate-900 dark:text-slate-100">{activeWorkspace.name}</h2>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-300"><span className="size-1.5 rounded-full bg-emerald-500" />{t('workspace.active')}</span>
              </div>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('workspace.workspace_id')} {activeWorkspace.id}</p>
              <Link
                data-testid="workspace-connections-link"
                to="/connections"
                className="mt-2 inline-flex min-h-9 items-center rounded-lg border border-blue-200 px-3 text-xs font-semibold text-blue-700 transition-colors hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-blue-400/30 dark:text-blue-300 dark:hover:bg-blue-400/10"
              >
                {t('workspace.connections_link')}
              </Link>
              <WorkspaceRenameForm
                key={`${activeWorkspace.id}:${activeWorkspace.name}`}
                workspace={activeWorkspace}
                isPending={isRenaming}
                error={renameError}
                success={renameSuccess}
                onSubmit={(name) => void handleRename(name)}
              />
            </div>

            <form onSubmit={handleAddMember} className="flex w-full flex-col gap-2 sm:flex-row md:w-auto" aria-label={t('workspace.add_member_form')}>
              <label className="sr-only" htmlFor="workspace-member-email">{t('workspace.identity_email')}</label>
              <input
                id="workspace-member-email"
                data-testid="workspace-member-email"
                type="text"
                inputMode="email"
                placeholder="existing-user@company.com"
                value={inviteEmail}
                onChange={(event) => {
                  setInviteEmail(event.target.value);
                  setMemberActionError('');
                  setMemberActionSuccess('');
                }}
                disabled={memberActionsDisabled}
                title={memberActionsDisabled ? t('workspace.owner_manage_locked') : undefined}
                className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
              />
              <motion.button
                type="submit"
                data-testid="workspace-member-add-submit"
                disabled={memberActionsDisabled}
                variants={buttonPress}
                whileHover="hover"
                whileTap="tap"
                className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-bold text-white shadow-sm shadow-blue-600/20 transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <UserPlus size={14} aria-hidden="true" />
                <span>{memberMutationKey?.startsWith('add:') ? t('workspace.adding') : t('workspace.add_member')}</span>
              </motion.button>
            </form>
          </motion.section>

          {!membersLoading && !canManageMembers && (
            <p data-testid="workspace-unsupported-members" className="text-xs text-amber-700 dark:text-amber-300" role="status">
              {currentMember?.role === 'MEMBER'
                ? t('workspace.owner_manage_notice')
                : t('workspace.members_loading_notice')}
            </p>
          )}
          {memberActionError && <p data-testid="workspace-member-error" className="text-xs text-rose-700 dark:text-rose-300" role="alert">{memberActionError}</p>}
          {memberActionSuccess && <p data-testid="workspace-member-success" className="text-xs text-emerald-700 dark:text-emerald-300" role="status">{memberActionSuccess}</p>}

          <motion.section variants={itemMotion} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
              <div><h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">{t('workspace.members')}</h2><p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{t('workspace.member_help')}</p></div>
              <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{members.length} {t('workspace.total')}</span>
            </div>

            {currentMember?.role === 'MEMBER' && (
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
                <div>
                  <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">{t('workspace.leave')}</p>
                  <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{t('workspace.leave_warning')}</p>
                </div>
                <ConfirmButton
                  onConfirm={handleLeave}
                  title={t('workspace.leave_confirm')}
                  description={t('workspace.leave_description').replace('{name}', activeWorkspace.name)}
                  confirmText={t('workspace.leave_confirm')}
                  cancelText={t('workspace.cancel')}
                  variant="danger"
                  disabled={Boolean(memberMutationKey)}
                  className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-2.5 py-1 text-[11px] font-semibold text-rose-600 transition-colors hover:bg-rose-500/20 dark:text-rose-400 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span data-testid="workspace-leave">{t('workspace.leave')}</span>
                </ConfirmButton>
              </div>
            )}
            {currentMember?.role === 'OWNER' && (
              <p data-testid="workspace-owner-leave-restriction" className="border-b border-slate-200 px-5 py-4 text-[11px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
                {t('workspace.owner_cannot_leave')}
              </p>
            )}

            {membersLoading && (
              <div data-testid="workspace-members-loading" className="flex items-center gap-2 p-5 text-xs text-slate-600 dark:text-slate-300">
                <Loader2 size={15} className="animate-spin" aria-hidden="true" />
                {t('workspace.loading')}
              </div>
            )}

            {membersQuery.isError && !membersLoading && (
              <div data-testid="workspace-members-error" className="flex items-start gap-2 p-5 text-xs text-rose-700 dark:text-rose-300" role="alert">
                <AlertCircle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span>{getWorkspaceErrorMessage(membersQuery.error, t)}</span>
              </div>
            )}

            {!membersLoading && !membersQuery.isError && members.length === 0 && (
              <div className="p-5 text-xs text-slate-600 dark:text-slate-300">{t('workspace.no_members')}</div>
            )}

            {!membersLoading && !membersQuery.isError && members.length > 0 && (
              <div className="overflow-x-auto">
                <motion.table variants={listMotion} initial="initial" animate="animate" className="w-full text-left text-xs text-slate-700 dark:text-slate-300">
                  <thead className="bg-slate-50 text-slate-500 dark:bg-slate-800/60 dark:text-slate-400 uppercase font-semibold text-[10px] tracking-wider">
                    <tr>
                      <th className="px-5 py-3.5">{t('workspace.member')}</th>
                      <th className="px-5 py-3.5">{t('workspace.email')}</th>
                      <th className="px-5 py-3.5">{t('workspace.role')}</th>
                      <th className="px-5 py-3.5">{t('workspace.can_publish')}</th>
                      <th className="px-5 py-3.5">{t('workspace.joined')}</th>
                      <th className="px-5 py-3.5 text-right">{t('workflows.col_actions')}</th>
                    </tr>
                  </thead>
                  <AnimatePresence initial={false}>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800/60">
                      {members.map((member) => (
                        <motion.tr key={member.id} data-testid="workspace-member-row" layout variants={itemMotion} initial="initial" animate="animate" exit="exit" className="transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className="flex items-center gap-3 px-5 py-4 font-bold text-slate-900 dark:text-slate-100">
                            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-rose-500 text-xs font-bold text-white">{member.name.slice(0, 2).toUpperCase()}</div>
                            <span>{member.name}</span>
                          </td>
                          <td className="px-5 py-4 text-slate-500 dark:text-slate-400">{member.email}</td>
                          <td className="px-5 py-4"><span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${member.role === 'OWNER' ? 'border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-400' : 'border-slate-500/20 bg-slate-500/10 text-slate-600 dark:text-slate-400'}`}>{member.role === 'OWNER' ? t('workspace.owner') : t('workspace.role_member')}</span></td>
                          <td className="px-5 py-4">
                            <button
                              type="button"
                              data-testid={`workspace-member-publish-${member.id}`}
                              onClick={() => void handleTogglePermission(member, 'canPublishWorkflow')}
                              disabled={member.role === 'OWNER' || memberActionsDisabled}
                              title={member.role === 'OWNER' ? t('workspace.owner_permissions_locked') : undefined}
                              className={`flex cursor-pointer items-center gap-1.5 rounded-xl border px-3 py-1 text-[11px] font-bold transition-all disabled:cursor-not-allowed disabled:opacity-60 ${member.canPublishWorkflow ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-400' : 'border-amber-500/20 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 dark:text-amber-300'}`}
                            >
                              {member.canPublishWorkflow ? <Check size={12} /> : <X size={12} />}
                              <span>{member.canPublishWorkflow ? t('workspace.allowed') : t('workspace.restricted')}</span>
                            </button>
                            <button
                              type="button"
                              data-testid={`workspace-member-manage-${member.id}`}
                              onClick={() => void handleTogglePermission(member, 'canManageWorkflowState')}
                              disabled={member.role === 'OWNER' || memberActionsDisabled}
                              title={member.role === 'OWNER' ? t('workspace.owner_permissions_locked') : undefined}
                              className={`mt-1 flex cursor-pointer items-center gap-1.5 rounded-xl border px-3 py-1 text-[11px] font-bold transition-all disabled:cursor-not-allowed disabled:opacity-60 ${member.canManageWorkflowState ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-400' : 'border-amber-500/20 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 dark:text-amber-300'}`}
                            >
                              <ShieldCheck size={12} aria-hidden="true" />
                              <span>{member.canManageWorkflowState ? t('workspace.allowed') : t('workspace.restricted')}</span>
                            </button>
                          </td>
                          <td className="px-5 py-4 text-[11px] text-slate-500 dark:text-slate-400">{new Date(member.joinedAt).toLocaleDateString()}</td>
                          <td className="px-5 py-4 text-right">
                            {member.role !== 'OWNER' && (
                              <ConfirmButton
                                onConfirm={() => handleRemove(member.id)}
                                title={t('workspace.remove_member')}
                                description={t('workspace.remove_member_description').replace('{name}', member.name).replace('{email}', member.email)}
                                confirmText={t('workspace.remove_member_confirm')}
                                cancelText={t('workspace.cancel')}
                                variant="danger"
                                dataTestId={`workspace-member-remove-${member.id}`}
                                disabled={memberActionsDisabled}
                                titleTooltip={memberActionsDisabled ? t('workspace.owner_manage_locked') : undefined}
                                className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-2.5 py-1 text-[11px] font-semibold text-rose-600 transition-colors hover:bg-rose-500/20 dark:text-rose-400 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {t('workspace.remove')}
                              </ConfirmButton>
                            )}
                          </td>
                        </motion.tr>
                      ))}
                    </tbody>
                  </AnimatePresence>
                </motion.table>
              </div>
            )}
          </motion.section>
        </>
      )}
    </motion.div>
  );
}
