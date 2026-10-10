import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Loader2, Mail } from 'lucide-react';
import { WorkspaceApiError, workspaceApi, type MyInvitation } from '../api/workspace.api';
import { useMyInvitations, workspaceKeys } from '../hooks/useWorkspace';
import { useAuthStore } from '../store/useAuthStore';
import { useI18nStore } from '../store/useI18nStore';
import { useWorkspaceStore } from '../store/useWorkspaceStore';
import { appLocale } from '../lib/i18n/tr';

function invitationErrorKey(error: unknown): string {
  if (error instanceof WorkspaceApiError) {
    if (error.status === 410 || error.code === 'INVITATION_GONE') return 'invitations.error.gone';
    if (error.code === 'EMAIL_NOT_VERIFIED') return 'invitations.error.email_not_verified';
    if (error.code === 'INVITATION_NOT_FOUND' || error.code === 'INVITATION_NOT_PENDING') return 'invitations.error.gone';
  }
  return 'invitations.error.generic';
}

export function InvitationsPage() {
  const { t } = useI18nStore();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const query = useMyInvitations();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const items = query.data?.items ?? [];
  const emailVerified = query.data?.emailVerified !== false;

  const refetch = () => (userId ? queryClient.invalidateQueries({ queryKey: workspaceKeys.myInvitations(userId) }) : Promise.resolve());

  const run = async (invitation: MyInvitation, action: () => Promise<void>) => {
    if (busyId || !userId) return;
    setBusyId(invitation.id);
    setError('');
    try {
      await action();
    } catch (err) {
      setError(t(invitationErrorKey(err)));
      await refetch();
    } finally {
      setBusyId(null);
    }
  };

  const handleAccept = (invitation: MyInvitation) => run(invitation, async () => {
    const { workspaceId } = await workspaceApi.acceptInvitation(invitation.id);
    // The accept succeeded: later failures must not be reported as a failed accept.
    try {
      const page = await queryClient.fetchQuery({
        queryKey: workspaceKeys.list(userId!),
        queryFn: ({ signal }) => workspaceApi.listWorkspaces({}, signal),
        staleTime: 0,
      });
      useWorkspaceStore.getState().setWorkspaces(page.items);
      useWorkspaceStore.getState().selectWorkspace(workspaceId);
    } catch {
      await queryClient.invalidateQueries({ queryKey: workspaceKeys.list(userId!) });
    }
    await refetch().catch(() => undefined);
    navigate('/workspace');
  });

  const handleDecline = (invitation: MyInvitation) => run(invitation, async () => {
    await workspaceApi.declineInvitation(invitation.id);
    await refetch();
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-12">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">{t('invitations.title')}</h1>
        <p className="mt-1 text-xs text-muted-foreground sm:text-sm">{t('invitations.subtitle')}</p>
      </div>

      {!emailVerified && (
        <div data-testid="invitations-unverified" className="flex items-start gap-2 rounded-2xl border border-warn/30 bg-warn-bg p-4 text-xs text-warn" role="status">
          <AlertCircle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
          <p>
            {t('invitations.unverified')}{' '}
            <Link to="/settings/profile" className="font-bold underline">{t('invitations.unverified_link')}</Link>
          </p>
        </div>
      )}

      {error && <p data-testid="invitations-error" className="text-xs text-err" role="alert">{error}</p>}

      {query.isLoading && (
        <div className="flex items-center gap-2 text-xs text-text-2">
          <Loader2 size={15} className="animate-spin" aria-hidden="true" />
          {t('workspace.loading')}
        </div>
      )}
      {query.isError && (
        <p data-testid="invitations-load-error" className="text-xs text-err" role="alert">{t('invitations.error.generic')}</p>
      )}
      {query.isSuccess && items.length === 0 && emailVerified && (
        <p data-testid="invitations-empty" className="text-xs text-text-2">{t('invitations.empty')}</p>
      )}

      <ul className="space-y-3">
        {items.map((invitation) => (
          <li key={invitation.id} data-testid="invitation-card" className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <Mail size={18} className="mt-0.5 shrink-0 text-run" aria-hidden="true" />
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-foreground">{invitation.workspaceName}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t('invitations.invited_by').replace('{name}', invitation.invitedByName)}
                  {' · '}
                  {t('workspace.invitations.expires')} {new Date(invitation.expiresAt).toLocaleDateString(appLocale())}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                data-testid="invitation-decline"
                aria-label={`${t('invitations.decline')} ${invitation.workspaceName}`}
                onClick={() => void handleDecline(invitation)}
                disabled={busyId !== null}
                className="rounded-xl border border-border-strong px-3.5 py-2 text-xs font-bold text-text-2 transition-colors hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-60"
              >
                {t('invitations.decline')}
              </button>
              <button
                type="button"
                data-testid="invitation-accept"
                aria-label={`${t('invitations.accept')} ${invitation.workspaceName}`}
                onClick={() => void handleAccept(invitation)}
                disabled={busyId !== null}
                className="rounded-xl bg-primary px-3.5 py-2 text-xs font-bold text-white transition-colors hover:bg-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busyId === invitation.id ? t('invitations.working') : t('invitations.accept')}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
