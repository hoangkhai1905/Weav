import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { LoaderCircle, MoreHorizontal, Plus, RefreshCw, X } from "lucide-react";
import {
  ConnectionApiError,
  connectionApi,
  GOOGLE_PROVIDERS,
  type ConnectionResponse,
  type ConnectionStatus,
  type GoogleProvider,
} from "../api/connection.api";
import {
  connectionKeys,
  useCreateConnection,
  useConnections,
  useDisableConnection,
  useRemoveConnection,
  useRenameConnection,
  useStartGoogleOAuth,
  useTestConnection,
} from "../hooks/useConnections";
import { useWorkspaceListContext } from "../hooks/useWorkspace";
import { statusBadgeClass, type StatusTone } from "../components/common/statusBadgeClass";
import { useI18nStore } from "../store/useI18nStore";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { captureNotificationSession, isCurrentNotificationSession } from "../lib/notifications/session";
import { showSuccessToast } from "../lib/feedback/toast";
import { useNotificationMilestoneRefresh } from "../hooks/useNotificationMilestoneRefresh";
import {
  OAUTH_PENDING_CONTEXT_KEY,
  OAUTH_PENDING_CONTEXT_MAX_AGE_MS,
  parseOAuthPendingContext,
  storeOAuthPendingContext,
  type OAuthPendingContext,
} from "../lib/oauthPending";

const OAUTH_COMPLETION_ID_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

const OAUTH_FAILURE_KEYS: Record<string, string> = {
  state_invalid: "connections.oauth.state_invalid",
  authorization_denied: "connections.oauth.authorization_denied",
  authorization_changed: "connections.oauth.authorization_changed",
  token_exchange_failed: "connections.oauth.token_exchange_failed",
  verification_failed: "connections.oauth.verification_failed",
};

function getOAuthNoticeKey(state: unknown): string | null {
  if (typeof state !== "object" || state === null) return null;
  const key = (state as { oauthNoticeKey?: unknown }).oauthNoticeKey;
  const allowedKeys = new Set([
    "connections.oauth.returned",
    "connections.oauth.completing",
    "connections.oauth.context_missing",
    "connections.oauth.failed_generic",
    ...Object.values(OAUTH_FAILURE_KEYS),
  ]);
  return typeof key === "string" && allowedKeys.has(key) ? key : null;
}

const STATUS_KEYS: Record<ConnectionStatus, string> = {
  DISABLED: "connections.status.disabled",
  ACTIVE: "connections.status.active",
  INVALID: "connections.status.invalid",
};

const STATUS_TONES: Record<ConnectionStatus, StatusTone> = {
  DISABLED: "pause",
  ACTIVE: "ok",
  INVALID: "err",
};

const ctl =
  "inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-border-strong bg-card px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";
const ctlPrimary =
  "inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-primary bg-primary px-3 text-[13px] font-medium text-primary-foreground transition-colors hover:border-primary-hover hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:cursor-wait disabled:opacity-60";
const fieldCls =
  "h-8 w-full rounded-md border border-border-strong bg-card px-2.5 text-[13px] text-foreground outline-none transition-colors hover:border-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary";

function getErrorMessage(error: unknown, t: (key: string) => string): string {
  if (error instanceof ConnectionApiError) {
    const errorKeys: Record<string, string> = {
      INVALID_REQUEST: "connections.error.invalid_request",
      BAD_REQUEST: "connections.error.invalid_request",
      UNAUTHENTICATED: "connections.error.unauthenticated",
      UNAUTHORIZED: "connections.error.unauthenticated",
      FORBIDDEN: "connections.error.forbidden",
      NOT_FOUND: "connections.error.not_found",
      WORKSPACE_NOT_FOUND: "connections.error.not_found",
      CONFLICT: "connections.error.conflict",
      INVALID_STATE: "connections.error.invalid_state",
      CONNECTION_UNAVAILABLE: "connections.error.unavailable",
      WORKSPACE_UNAVAILABLE: "connections.error.unavailable",
      DEPENDENCY_UNAVAILABLE: "connections.error.unavailable",
      RATE_LIMITED: "connections.error.rate_limited",
      INVALID_RESPONSE: "connections.error.invalid_response",
    };
    const statusKeys: Record<number, string> = {
      400: "connections.error.invalid_request",
      401: "connections.error.unauthenticated",
      503: "connections.error.unavailable",
    };
    const errorKey = errorKeys[error.code] ?? statusKeys[error.status];
    return errorKey ? t(errorKey) : error.message;
  }
  return t("connections.error.generic");
}

interface RowMenuItem {
  key: string;
  testId: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
}

/** "…" overflow menu: aria-haspopup button, arrow-key navigation, Esc closes and returns focus. */
function RowMenu({ label, items }: { label: string; items: RowMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  };
  const focusItem = (index: number) => {
    const nodes = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)');
    if (!nodes || nodes.length === 0) return;
    nodes[(index + nodes.length) % nodes.length].focus();
  };

  useEffect(() => {
    if (!open) return;
    focusItem(0);
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const onMenuKeyDown = (event: React.KeyboardEvent) => {
    const nodes = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
    const current = nodes.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "ArrowDown") { event.preventDefault(); focusItem(current + 1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); focusItem(current - 1); }
    else if (event.key === "Home") { event.preventDefault(); focusItem(0); }
    else if (event.key === "End") { event.preventDefault(); focusItem(nodes.length - 1); }
    else if (event.key === "Escape") { event.preventDefault(); close(true); }
    else if (event.key === "Tab") setOpen(false);
  };

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        data-testid="connection-row-menu"
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) { event.preventDefault(); setOpen(true); }
        }}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border-strong bg-card text-text-2 transition-colors hover:bg-subtle hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 top-9 z-30 flex w-48 flex-col rounded-lg border border-border bg-popover p-1 text-[13px] shadow-pop"
        >
          {items.map((item, index) => (
            <div key={item.key} className="contents">
              {item.danger && index > 0 && <div role="separator" className="my-1 h-px bg-border" />}
              <button
                type="button"
                role="menuitem"
                data-testid={item.testId}
                disabled={item.disabled}
                onClick={() => {
                  close(false);
                  item.onSelect();
                }}
                className={`flex h-8 items-center rounded-md px-2 text-left font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${
                  item.danger ? "text-err hover:bg-err-bg" : "text-popover-foreground hover:bg-subtle"
                }`}
              >
                {item.label}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ConnectionRow({
  connection,
  t,
  isRenaming,
  renameValue,
  setRenameValue,
  onStartRename,
  onCancelRename,
  onRename,
  onTest,
  onDisable,
  onRemove,
  onStartOAuth,
  actionMessage,
  isWorking,
}: {
  connection: ConnectionResponse;
  t: (key: string) => string;
  isRenaming: boolean;
  renameValue: string;
  setRenameValue: (value: string) => void;
  onStartRename: () => void;
  onCancelRename: () => void;
  onRename: (event: FormEvent<HTMLFormElement>) => void;
  onTest: () => void;
  onDisable: () => void;
  onRemove: () => void;
  onStartOAuth: () => void;
  actionMessage: string;
  isWorking: boolean;
}) {
  const isGoogleOAuth =
    (GOOGLE_PROVIDERS as readonly string[]).includes(connection.provider) && connection.authType === "OAUTH2";
  // Primary contextual action: (re)authorize a Google connection that needs it, otherwise verify it.
  const primaryIsOAuth = isGoogleOAuth && (connection.status !== "ACTIVE" || !connection.hasCredential);
  return (
    <li
      data-testid={`connection-row-${connection.id}`}
      className="flex flex-col gap-2 border-b border-border px-5 py-3 transition-colors hover:bg-subtle sm:flex-row sm:flex-wrap sm:items-center sm:justify-between"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-text-2">
            {connection.provider}
          </span>
          <h2 className="truncate text-[13px] font-medium text-foreground">
            {connection.name}
          </h2>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span
            data-testid={`connection-status-${connection.id}`}
            data-status={connection.status}
            className={statusBadgeClass(STATUS_TONES[connection.status])}
          >
            {t(STATUS_KEYS[connection.status])}
          </span>
          <span>
            {connection.lastVerifiedAt
              ? `${t("connections.last_verified")}: ${connection.lastVerifiedAt}`
              : t("connections.never_verified")}
          </span>
          <span>
            {connection.hasCredential
              ? t("connections.credential_present")
              : t("connections.credential_missing")}
          </span>
        </div>
      </div>
      <div className="shrink-0 text-xs text-muted-foreground">
        {connection.canManage
          ? t("connections.manage_access")
          : t("connections.metadata_only")}
      </div>
      {connection.canManage && (
        <div className="flex flex-wrap items-center gap-2">
          {isRenaming ? (
            <form onSubmit={onRename} className="flex flex-wrap gap-2">
              <label
                className="sr-only"
                htmlFor={`connection-rename-input-${connection.id}`}
              >
                {t("connections.rename.name")}
              </label>
              <input
                id={`connection-rename-input-${connection.id}`}
                data-testid={`connection-rename-input-${connection.id}`}
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
                maxLength={120}
                required
                autoFocus
                className="h-8 rounded-md border border-border-strong bg-card px-2.5 text-[13px] text-foreground outline-none hover:border-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
              />
              <button
                type="submit"
                data-testid={`connection-rename-submit-${connection.id}`}
                disabled={isWorking}
                className={ctlPrimary}
              >
                {isWorking
                  ? t("connections.rename.pending")
                  : t("connections.save")}
              </button>
              <button
                type="button"
                onClick={onCancelRename}
                disabled={isWorking}
                className={ctl}
              >
                {t("connections.cancel")}
              </button>
            </form>
          ) : (
            <>
              {primaryIsOAuth ? (
                <button
                  type="button"
                  data-testid={`connection-oauth-${connection.id}`}
                  onClick={onStartOAuth}
                  disabled={isWorking}
                  className="inline-flex h-8 items-center justify-center whitespace-nowrap rounded-md border border-primary px-3 text-[13px] font-medium text-accent-ink transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isWorking ? t("connections.oauth.starting") : t("connections.oauth.start")}
                </button>
              ) : (
                <button
                  type="button"
                  data-testid={`connection-test-${connection.id}`}
                  onClick={onTest}
                  disabled={isWorking}
                  className={ctl}
                >
                  {isWorking ? t("connections.test.pending") : t("connections.test.action")}
                </button>
              )}
              <RowMenu
                label={t("connections.more_actions")}
                items={[
                  { key: "rename", testId: `connection-rename-${connection.id}`, label: t("connections.rename.action"), onSelect: onStartRename },
                  ...(primaryIsOAuth
                    ? [{ key: "test", testId: `connection-test-${connection.id}`, label: isWorking ? t("connections.test.pending") : t("connections.test.action"), onSelect: onTest, disabled: isWorking }]
                    : []),
                  ...(connection.status !== "DISABLED"
                    ? [{ key: "disable", testId: `connection-disable-${connection.id}`, label: t("connections.disable.action"), onSelect: onDisable, disabled: isWorking }]
                    : []),
                  ...(isGoogleOAuth && !primaryIsOAuth
                    ? [{ key: "oauth", testId: `connection-oauth-${connection.id}`, label: isWorking ? t("connections.oauth.starting") : t("connections.oauth.start"), onSelect: onStartOAuth, disabled: isWorking }]
                    : []),
                  { key: "delete", testId: `connection-delete-${connection.id}`, label: t("connections.delete"), onSelect: onRemove, disabled: isWorking, danger: true },
                ]}
              />
            </>
          )}
        </div>
      )}
      {actionMessage && (
        <p
          data-testid={`connection-action-message-${connection.id}`}
          role="status"
          className="basis-full text-sm text-muted-foreground"
        >
          {actionMessage}
        </p>
      )}
    </li>
  );
}

/** "New connection" dialog, shared by the Connections page and the builder inspector. */
export function CreateConnectionDialog({
  workspaceId,
  initialProvider = "GMAIL",
  submitLabel,
  pendingLabel,
  onClose,
  onCreated,
}: {
  workspaceId: string;
  initialProvider?: GoogleProvider | "TELEGRAM";
  submitLabel?: string;
  pendingLabel?: string;
  onClose: () => void;
  /** Runs after the connection exists; a rejection is shown in the dialog. */
  onCreated: (connection: ConnectionResponse) => void | Promise<void>;
}) {
  const { t } = useI18nStore();
  const createConnection = useCreateConnection();
  const [name, setName] = useState("");
  const [provider, setProvider] = useState<GoogleProvider | "TELEGRAM">(initialProvider);
  const [token, setToken] = useState("");
  const isTelegram = provider === "TELEGRAM";
  const [createError, setCreateError] = useState("");
  const [isFinishing, setIsFinishing] = useState(false);
  const busy = createConnection.isPending || isFinishing;

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedName = name.trim();
    if (!normalizedName || normalizedName.length > 120) {
      setCreateError(t("connections.create.validation"));
      return;
    }
    if (isTelegram && (!token.trim() || token.length > 4096)) {
      setCreateError(t("connections.create.token_validation"));
      return;
    }
    if (busy) return;

    const mutationSession = captureNotificationSession();
    setCreateError("");
    try {
      const connection = await createConnection.mutateAsync({
        workspaceId,
        input: provider === "TELEGRAM"
          ? { name: normalizedName, provider, authType: "TOKEN", token: token.trim() }
          : { name: normalizedName, provider, authType: "OAUTH2" },
      });
      if (!isCurrentNotificationSession(mutationSession)) return;
      showSuccessToast("toast.connection.created", mutationSession);
      setIsFinishing(true);
      await onCreated(connection);
    } catch (error) {
      if (isCurrentNotificationSession(mutationSession)) setCreateError(getErrorMessage(error, t));
    } finally {
      setToken("");
      setIsFinishing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-foreground/30 p-4 pt-[14vh]">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="connection-create-title"
        data-testid="connection-create-dialog"
        className="w-full max-w-[520px] rounded-lg border border-border bg-card p-4 shadow-pop"
      >
        <div className="flex items-center justify-between gap-3">
          <h2
            id="connection-create-title"
            className="text-base font-semibold text-foreground"
          >
            {t("connections.create.title")}
          </h2>
          <button
            type="button"
            aria-label={t("connections.close")}
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <form
          data-testid="connection-create-form"
          onSubmit={handleCreate}
          className="mt-4 flex flex-col gap-4"
        >
          <div>
            <label
              htmlFor="connection-create-name"
              className="mb-1.5 block text-xs font-medium text-text-2"
            >
              {t("connections.create.name")}
            </label>
            <input
              id="connection-create-name"
              data-testid="connection-create-name"
              autoFocus
              required
              maxLength={120}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setCreateError("");
              }}
              className={fieldCls}
            />
          </div>
          <div>
            <label
              htmlFor="connection-create-provider"
              className="mb-1.5 block text-xs font-medium text-text-2"
            >
              {t("connections.create.provider")}
            </label>
            <select
              id="connection-create-provider"
              data-testid="connection-create-provider"
              value={provider}
              onChange={(event) =>
                setProvider(event.target.value as GoogleProvider | "TELEGRAM")
              }
              className={fieldCls}
            >
              <option value="GMAIL">Gmail</option>
              <option value="GOOGLE_SHEETS">Google Sheets</option>
              <option value="GOOGLE_CALENDAR">Google Calendar</option>
              <option value="GOOGLE_DRIVE">Google Drive</option>
              <option value="TELEGRAM">{t("connections.create.telegram_option")}</option>
            </select>
          </div>
          {isTelegram && (
            <div>
              <label
                htmlFor="connection-create-token"
                className="mb-1.5 block text-xs font-medium text-text-2"
              >
                {t("connections.create.token")}
              </label>
              <input
                id="connection-create-token"
                data-testid="connection-create-token"
                type="password"
                autoComplete="off"
                spellCheck={false}
                required
                maxLength={4096}
                value={token}
                onChange={(event) => {
                  setToken(event.target.value);
                  setCreateError("");
                }}
                aria-describedby="connection-create-token-hint"
                className={fieldCls}
              />
              <p id="connection-create-token-hint" className="mt-1 text-[11px] text-muted-foreground">
                {t("connections.create.token_hint")}
              </p>
            </div>
          )}
          {createError && (
            <p
              data-testid="connection-create-error"
              role="alert"
              className="text-[13px] text-err"
            >
              {createError}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className={ctl}
            >
              {t("connections.cancel")}
            </button>
            <button
              type="submit"
              data-testid="connection-create-submit"
              disabled={busy}
              className={ctlPrimary}
            >
              {busy && (
                <LoaderCircle
                  size={15}
                  className="animate-spin"
                  aria-hidden="true"
                />
              )}
              {busy
                ? (pendingLabel ?? t("connections.create.pending"))
                : (submitLabel ?? t("connections.create.submit"))}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export function ConnectionsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const refreshNotifications = useNotificationMilestoneRefresh();
  const { t } = useI18nStore();
  const {
    userId,
    workspaces,
    activeWorkspace,
    activeWorkspaceId,
    workspacesQuery,
  } = useWorkspaceListContext();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const selectWorkspace = useWorkspaceStore((state) => state.selectWorkspace);
  const oauthNoticeKey = getOAuthNoticeKey(location.state);
  const oauthNotice = oauthNoticeKey ? t(oauthNoticeKey) : "";
  const connectionsQuery = useConnections();
  const renameConnection = useRenameConnection();
  const testConnection = useTestConnection();
  const disableConnection = useDisableConnection();
  const removeConnection = useRemoveConnection();
  const startGoogleOAuth = useStartGoogleOAuth();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [renamingConnectionId, setRenamingConnectionId] = useState<
    string | null
  >(null);
  const [renameValue, setRenameValue] = useState("");
  const [actionMessages, setActionMessages] = useState<Record<string, string>>(
    {},
  );
  const oauthCallbackHandled = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const outcome = params.get("oauth");
    if (!outcome) {
      oauthCallbackHandled.current = false;
      return;
    }
    if (oauthCallbackHandled.current || !userId) return;

    const serverWorkspaces = workspacesQuery.data?.items ?? [];
    const workspaceListSynchronized =
      workspacesQuery.isSuccess &&
      serverWorkspaces.length === workspaces.length &&
      serverWorkspaces.every(
        (item, index) => item.id === workspaces[index]?.id,
      );
    if (!workspaceListSynchronized && !workspacesQuery.isError) return;

    oauthCallbackHandled.current = true;
    let pending: OAuthPendingContext | null = null;
    try {
      pending = parseOAuthPendingContext(
        sessionStorage.getItem(OAUTH_PENDING_CONTEXT_KEY),
      );
      sessionStorage.removeItem(OAUTH_PENDING_CONTEXT_KEY);
    } catch {
      // Callback handling must remain safe if browser storage is unavailable.
    }

    const callbackConnectionId = params.get("connectionId");
    const reason = params.get("reason") ?? "";
    const callbackAllowsRestore =
      outcome === "success" ||
      outcome === "pending" ||
      (outcome === "failed" &&
        reason !== "state_invalid" &&
        Object.hasOwn(OAUTH_FAILURE_KEYS, reason));
    const ageMs = pending
      ? Date.now() - pending.createdAt
      : Number.POSITIVE_INFINITY;
    const pendingIsValid = Boolean(
      callbackAllowsRestore &&
      pending &&
      pending.userId === userId &&
      pending.connectionId === callbackConnectionId &&
      ageMs >= 0 &&
      ageMs <= OAUTH_PENDING_CONTEXT_MAX_AGE_MS &&
      serverWorkspaces.some((item) => item.id === pending?.workspaceId),
    );

    if (pendingIsValid && pending) {
      selectWorkspace(pending.workspaceId);
      void queryClient.invalidateQueries({
        queryKey: connectionKeys.list(userId, pending.workspaceId),
        exact: true,
      });
      void queryClient.invalidateQueries({
        queryKey: connectionKeys.detail(
          userId,
          pending.workspaceId,
          pending.connectionId,
        ),
        exact: true,
      });
    }

    if (outcome === "pending") {
      // The URL carries a single-use secret: clear it now and keep it in memory only.
      const completion = params.get("completion") ?? "";
      if (!pendingIsValid || !pending || !OAUTH_COMPLETION_ID_PATTERN.test(completion)) {
        navigate("/workspace/connections", {
          replace: true,
          state: { oauthNoticeKey: "connections.oauth.context_missing" },
        });
        return;
      }
      const { workspaceId, connectionId, returnTo } = pending;
      navigate("/workspace/connections", {
        replace: true,
        state: { oauthNoticeKey: "connections.oauth.completing" },
      });
      void connectionApi
        .completeGoogleOAuth(workspaceId, connectionId, completion)
        .then((result) =>
          result.outcome === "VERIFIED"
            ? "connections.oauth.returned"
            : "connections.oauth.verification_failed",
        )
        .catch((error: unknown) =>
          error instanceof ConnectionApiError && error.status === 409
            ? "connections.oauth.state_invalid"
            : "connections.oauth.failed_generic",
        )
        .then((finalKey) => {
          void queryClient.invalidateQueries({
            queryKey: connectionKeys.list(userId, workspaceId),
            exact: true,
          });
          void queryClient.invalidateQueries({
            queryKey: connectionKeys.detail(userId, workspaceId, connectionId),
            exact: true,
          });
          if (finalKey === "connections.oauth.returned" && returnTo) {
            navigate(returnTo, { replace: true });
            return;
          }
          navigate("/workspace/connections", {
            replace: true,
            state: { oauthNoticeKey: finalKey },
          });
        });
      return;
    }

    if (outcome === "success" && pendingIsValid && pending?.returnTo) {
      navigate(pending.returnTo, { replace: true });
      return;
    }
    const noticeKey =
      outcome === "success"
        ? pendingIsValid
          ? "connections.oauth.returned"
          : "connections.oauth.context_missing"
        : (OAUTH_FAILURE_KEYS[reason] ?? "connections.oauth.failed_generic");
    navigate("/workspace/connections", {
      replace: true,
      state: { oauthNoticeKey: noticeKey },
    });
  }, [
    location.search,
    navigate,
    queryClient,
    selectWorkspace,
    userId,
    workspaces,
    workspacesQuery.data,
    workspacesQuery.isError,
    workspacesQuery.isSuccess,
  ]);

  const setActionMessage = (connectionId: string, message: string) => {
    setActionMessages((current) => ({ ...current, [connectionId]: message }));
  };

  const handleRename = async (
    event: FormEvent<HTMLFormElement>,
    connection: ConnectionResponse,
  ) => {
    event.preventDefault();
    if (renameConnection.isPending) return;
    const mutationSession = captureNotificationSession();
    try {
      await renameConnection.mutateAsync({
        workspaceId: connection.workspaceId,
        connectionId: connection.id,
        name: renameValue,
      });
      if (!isCurrentNotificationSession(mutationSession)) return;
      setRenamingConnectionId(null);
      setRenameValue("");
      setActionMessage(connection.id, "");
      showSuccessToast("toast.connection.updated", mutationSession);
    } catch (error) {
      if (isCurrentNotificationSession(mutationSession)) setActionMessage(connection.id, getErrorMessage(error, t));
    }
  };

  const handleTest = async (connection: ConnectionResponse) => {
    const mutationSession = captureNotificationSession();
    try {
      const result = await testConnection.mutateAsync({
        workspaceId: connection.workspaceId,
        connectionId: connection.id,
      });
      if (!isCurrentNotificationSession(mutationSession)) return;
      if (result.outcome === "VERIFIED") {
        setActionMessage(connection.id, "");
        showSuccessToast("toast.connection.verified", mutationSession);
        refreshNotifications(mutationSession);
      } else {
        setActionMessage(connection.id, t("connections.test.auth_invalid"));
      }
    } catch (error) {
      if (isCurrentNotificationSession(mutationSession)) setActionMessage(connection.id, getErrorMessage(error, t));
    }
  };

  const handleDisable = async (connection: ConnectionResponse) => {
    const mutationSession = captureNotificationSession();
    try {
      await disableConnection.mutateAsync({
        workspaceId: connection.workspaceId,
        connectionId: connection.id,
      });
      if (!isCurrentNotificationSession(mutationSession)) return;
      setActionMessage(connection.id, "");
      showSuccessToast("toast.connection.disabled", mutationSession);
    } catch (error) {
      if (isCurrentNotificationSession(mutationSession)) setActionMessage(connection.id, getErrorMessage(error, t));
    }
  };

  const handleRemove = async (connection: ConnectionResponse) => {
    if (!window.confirm(t("connections.delete.confirm"))) return;
    const mutationSession = captureNotificationSession();
    try {
      await removeConnection.mutateAsync({
        workspaceId: connection.workspaceId,
        connectionId: connection.id,
      });
      if (!isCurrentNotificationSession(mutationSession)) return;
      setActionMessages((current) => {
        const next = { ...current };
        delete next[connection.id];
        return next;
      });
    } catch (error) {
      if (isCurrentNotificationSession(mutationSession)) setActionMessage(connection.id, getErrorMessage(error, t));
    }
  };

  const handleStartGoogleOAuth = async (
    connection: ConnectionResponse,
    createdAt: number,
  ) => {
    if (!userId) {
      setActionMessage(connection.id, t("connections.error.unauthenticated"));
      return;
    }
    const mutationSession = captureNotificationSession();
    try {
      const result = await startGoogleOAuth.mutateAsync({
        workspaceId: connection.workspaceId,
        connectionId: connection.id,
      });
      if (!isCurrentNotificationSession(mutationSession)) return;
      storeOAuthPendingContext({
        userId,
        workspaceId: connection.workspaceId,
        connectionId: connection.id,
        createdAt,
      });
      window.location.assign(result.authorizationUrl);
    } catch (error) {
      if (isCurrentNotificationSession(mutationSession)) setActionMessage(connection.id, getErrorMessage(error, t));
    }
  };

  const connections = connectionsQuery.data ?? [];

  return (
    <main
      data-testid="connections-page"
      className={embedded ? "flex min-h-0 flex-col rounded-lg border border-border bg-card" : "-m-4 flex h-[calc(100%+2rem)] min-h-0 flex-col overflow-y-auto bg-card sm:-m-5 sm:h-[calc(100%+2.5rem)]"}
    >
      <header className="flex min-h-14 shrink-0 flex-col gap-2 border-b border-border px-5 py-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <h1 className="text-base font-semibold text-foreground">
            {t("connections.title")}
          </h1>
          <p className="text-xs text-muted-foreground">
            {t("connections.workspace_scope")}
          </p>
          {activeWorkspace && (
            <p className="text-[13px] font-medium text-foreground">
              {t("connections.workspace_label")}{" "}
              <span data-testid="connections-workspace-name">
                {activeWorkspace.name}
              </span>
            </p>
          )}
        </div>
        {activeWorkspaceId && (
          <button
            type="button"
            data-testid="connections-create-open"
            onClick={() => setIsCreateOpen(true)}
            className={ctlPrimary}
          >
            <Plus size={16} aria-hidden="true" />
            {t("connections.new_conn")}
          </button>
        )}
      </header>

      {oauthNotice && (
        <p
          data-testid="connections-oauth-notice"
          role="status"
          className="mx-5 mt-4 rounded-md border border-border bg-subtle px-3 py-2 text-[13px] text-foreground"
        >
          {oauthNotice}
        </p>
      )}

      {!activeWorkspaceId ? (
        workspacesQuery.isPending ? (
          <p
            data-testid="connections-workspace-loading"
            role="status"
            className="mx-5 mt-4 rounded-lg border border-border p-4 text-[13px] text-muted-foreground"
          >
            {t("connections.workspaces_loading")}
          </p>
        ) : workspacesQuery.isError ? (
          <div
            className="mx-5 mt-4 rounded-lg border border-err-border bg-err-bg p-4 text-[13px] text-err"
            role="alert"
          >
            <p>{t("connections.workspaces_error")}</p>
            <button
              type="button"
              onClick={() => void workspacesQuery.refetch()}
              className="mt-3 rounded-md px-1 py-1 text-[13px] font-medium underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("connections.retry")}
            </button>
          </div>
        ) : (
          <section
            data-testid="connections-no-workspace"
            className="mx-5 mt-4 rounded-lg border border-border bg-card p-5"
          >
            <h2 className="font-semibold text-foreground">
              {t("connections.no_workspace_title")}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("connections.no_workspace_body")}
            </p>
            <Link
              to="/workspace"
              className={`${ctl} mt-4`}
            >
              {t("connections.choose_workspace")}
            </Link>
          </section>
        )
      ) : connectionsQuery.isPending ||
        (connectionsQuery.isFetching && !connectionsQuery.data) ? (
        <p
          data-testid="connections-loading"
          role="status"
          className="mx-5 mt-4 rounded-lg border border-border bg-card p-4 text-[13px] text-muted-foreground"
        >
          <LoaderCircle
            size={16}
            className="mr-2 inline animate-spin"
            aria-hidden="true"
          />
          {t("connections.loading")}
        </p>
      ) : connectionsQuery.isError ? (
        <section
          data-testid="connections-error-state"
          className="mx-5 mt-4 rounded-lg border border-err-border bg-err-bg p-4 text-[13px] text-err"
          role="alert"
        >
          <p data-testid="connections-error">
            {getErrorMessage(connectionsQuery.error, t)}
          </p>
          <button
            type="button"
            data-testid="connections-retry"
            onClick={() => void connectionsQuery.refetch()}
            className={`${ctl} mt-3`}
          >
            <RefreshCw size={14} aria-hidden="true" />
            {t("connections.retry")}
          </button>
        </section>
      ) : connections.length === 0 ? (
        <section
          data-testid="connections-empty-state"
          className="px-5 py-12 text-center"
        >
          <h2 className="font-semibold text-foreground">
            {t("connections.empty_title")}
          </h2>
          <p className="mx-auto mt-2 max-w-md text-[13px] text-text-2">
            {t("connections.empty_body")}
          </p>
        </section>
      ) : (
        <ul data-testid="connection-list" className="m-0 flex list-none flex-col p-0">
          {connections.map((connection) => {
            const isWorking =
              renameConnection.isPending ||
              testConnection.isPending ||
              disableConnection.isPending ||
              removeConnection.isPending ||
              startGoogleOAuth.isPending;
            return (
              <ConnectionRow
                key={connection.id}
                connection={connection}
                t={t}
                isRenaming={renamingConnectionId === connection.id}
                renameValue={renameValue}
                setRenameValue={setRenameValue}
                onStartRename={() => {
                  setRenamingConnectionId(connection.id);
                  setRenameValue(connection.name);
                }}
                onCancelRename={() => {
                  setRenamingConnectionId(null);
                  setRenameValue("");
                }}
                onRename={(event) => void handleRename(event, connection)}
                onTest={() => void handleTest(connection)}
                onDisable={() => void handleDisable(connection)}
                onRemove={() => void handleRemove(connection)}
                onStartOAuth={() =>
                  void handleStartGoogleOAuth(connection, Date.now())
                }
                actionMessage={actionMessages[connection.id] ?? ""}
                isWorking={isWorking}
              />
            );
          })}
        </ul>
      )}

      {isCreateOpen && activeWorkspaceId && (
        <CreateConnectionDialog
          workspaceId={activeWorkspaceId}
          onClose={() => setIsCreateOpen(false)}
          onCreated={() => setIsCreateOpen(false)}
        />
      )}
    </main>
  );
}
