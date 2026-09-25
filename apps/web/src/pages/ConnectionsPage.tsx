import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { LoaderCircle, Plus, RefreshCw, X } from "lucide-react";
import {
  ConnectionApiError,
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
import { useI18nStore } from "../store/useI18nStore";
import { useWorkspaceStore } from "../store/useWorkspaceStore";

const OAUTH_PENDING_CONTEXT_KEY = "weav.workspaceConnectionOAuth.pending";
const OAUTH_PENDING_CONTEXT_MAX_AGE_MS = 10 * 60 * 1000;

interface OAuthPendingContext {
  userId: string;
  workspaceId: string;
  connectionId: string;
  createdAt: number;
}

const OAUTH_FAILURE_KEYS: Record<string, string> = {
  state_invalid: "connections.oauth.state_invalid",
  authorization_denied: "connections.oauth.authorization_denied",
  authorization_changed: "connections.oauth.authorization_changed",
  token_exchange_failed: "connections.oauth.token_exchange_failed",
  verification_failed: "connections.oauth.verification_failed",
};

function parseOAuthPendingContext(
  value: string | null,
): OAuthPendingContext | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as OAuthPendingContext).userId === "string" &&
      typeof (parsed as OAuthPendingContext).workspaceId === "string" &&
      typeof (parsed as OAuthPendingContext).connectionId === "string" &&
      typeof (parsed as OAuthPendingContext).createdAt === "number" &&
      Number.isFinite((parsed as OAuthPendingContext).createdAt)
    ) {
      const { userId, workspaceId, connectionId, createdAt } =
        parsed as OAuthPendingContext;
      return { userId, workspaceId, connectionId, createdAt };
    }
  } catch {
    // Invalid session data is ignored and removed by the callback handler.
  }
  return null;
}

function getOAuthNoticeKey(state: unknown): string | null {
  if (typeof state !== "object" || state === null) return null;
  const key = (state as { oauthNoticeKey?: unknown }).oauthNoticeKey;
  const allowedKeys = new Set([
    "connections.oauth.returned",
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
  return (
    <li
      data-testid={`connection-row-${connection.id}`}
      className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-muted px-2 py-1 text-[11px] font-semibold text-foreground">
            {connection.provider}
          </span>
          <h2 className="truncate text-sm font-semibold text-foreground">
            {connection.name}
          </h2>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span
            data-testid={`connection-status-${connection.id}`}
            data-status={connection.status}
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
                className="min-h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <button
                type="submit"
                data-testid={`connection-rename-submit-${connection.id}`}
                disabled={isWorking}
                className="min-h-9 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              >
                {isWorking
                  ? t("connections.rename.pending")
                  : t("connections.save")}
              </button>
              <button
                type="button"
                onClick={onCancelRename}
                disabled={isWorking}
                className="min-h-9 rounded-lg border border-border px-3 text-sm font-medium text-foreground disabled:opacity-50"
              >
                {t("connections.cancel")}
              </button>
            </form>
          ) : (
            <button
              type="button"
              data-testid={`connection-rename-${connection.id}`}
              onClick={onStartRename}
              className="min-h-9 rounded-lg border border-border px-3 text-sm font-medium text-foreground hover:bg-muted"
            >
              {t("connections.rename.action")}
            </button>
          )}
          <button
            type="button"
            data-testid={`connection-test-${connection.id}`}
            onClick={onTest}
            disabled={isWorking}
            className="min-h-9 rounded-lg border border-border px-3 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
          >
            {isWorking
              ? t("connections.test.pending")
              : t("connections.test.action")}
          </button>
          {connection.status !== "DISABLED" && (
            <button
              type="button"
              data-testid={`connection-disable-${connection.id}`}
              onClick={onDisable}
              disabled={isWorking}
              className="min-h-9 rounded-lg border border-border px-3 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
            >
              {t("connections.disable.action")}
            </button>
          )}
          {(connection.provider === "GMAIL" ||
            connection.provider === "GOOGLE_SHEETS") &&
            connection.authType === "OAUTH2" && (
              <button
                type="button"
                data-testid={`connection-oauth-${connection.id}`}
                onClick={onStartOAuth}
                disabled={isWorking}
                className="min-h-9 rounded-lg border border-primary px-3 text-sm font-semibold text-primary hover:bg-primary/5 disabled:opacity-50"
              >
                {isWorking
                  ? t("connections.oauth.starting")
                  : t("connections.oauth.start")}
              </button>
            )}
          <button
            type="button"
            data-testid={`connection-delete-${connection.id}`}
            onClick={onRemove}
            disabled={isWorking}
            className="min-h-9 rounded-lg border border-destructive/50 px-3 text-sm font-medium text-destructive hover:bg-destructive/5 disabled:opacity-50"
          >
            {t("connections.delete")}
          </button>
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

export function ConnectionsPage() {
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
  const createConnection = useCreateConnection();
  const renameConnection = useRenameConnection();
  const testConnection = useTestConnection();
  const disableConnection = useDisableConnection();
  const removeConnection = useRemoveConnection();
  const startGoogleOAuth = useStartGoogleOAuth();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [provider, setProvider] = useState<GoogleProvider>("GMAIL");
  const [createError, setCreateError] = useState("");
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

    const noticeKey =
      outcome === "success"
        ? pendingIsValid
          ? "connections.oauth.returned"
          : "connections.oauth.context_missing"
        : (OAUTH_FAILURE_KEYS[reason] ?? "connections.oauth.failed_generic");
    navigate("/connections", {
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
    try {
      await renameConnection.mutateAsync({
        workspaceId: connection.workspaceId,
        connectionId: connection.id,
        name: renameValue,
      });
      setRenamingConnectionId(null);
      setRenameValue("");
      setActionMessage(connection.id, t("connections.rename.success"));
    } catch (error) {
      setActionMessage(connection.id, getErrorMessage(error, t));
    }
  };

  const handleTest = async (connection: ConnectionResponse) => {
    try {
      const result = await testConnection.mutateAsync({
        workspaceId: connection.workspaceId,
        connectionId: connection.id,
      });
      setActionMessage(
        connection.id,
        t(
          result.outcome === "VERIFIED"
            ? "connections.test.verified"
            : "connections.test.auth_invalid",
        ),
      );
    } catch (error) {
      setActionMessage(connection.id, getErrorMessage(error, t));
    }
  };

  const handleDisable = async (connection: ConnectionResponse) => {
    try {
      await disableConnection.mutateAsync({
        workspaceId: connection.workspaceId,
        connectionId: connection.id,
      });
      setActionMessage(connection.id, t("connections.disable.success"));
    } catch (error) {
      setActionMessage(connection.id, getErrorMessage(error, t));
    }
  };

  const handleRemove = async (connection: ConnectionResponse) => {
    if (!window.confirm(t("connections.delete.confirm"))) return;
    try {
      await removeConnection.mutateAsync({
        workspaceId: connection.workspaceId,
        connectionId: connection.id,
      });
      setActionMessages((current) => {
        const next = { ...current };
        delete next[connection.id];
        return next;
      });
    } catch (error) {
      setActionMessage(connection.id, getErrorMessage(error, t));
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
    try {
      const result = await startGoogleOAuth.mutateAsync({
        workspaceId: connection.workspaceId,
        connectionId: connection.id,
      });
      const pendingContext: OAuthPendingContext = {
        userId,
        workspaceId: connection.workspaceId,
        connectionId: connection.id,
        createdAt,
      };
      sessionStorage.setItem(
        OAUTH_PENDING_CONTEXT_KEY,
        JSON.stringify(pendingContext),
      );
      window.location.assign(result.authorizationUrl);
    } catch (error) {
      setActionMessage(connection.id, getErrorMessage(error, t));
    }
  };

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedName = name.trim();
    if (!normalizedName || normalizedName.length > 120) {
      setCreateError(t("connections.create.validation"));
      return;
    }
    if (!activeWorkspaceId || createConnection.isPending) return;

    setCreateError("");
    try {
      await createConnection.mutateAsync({
        workspaceId: activeWorkspaceId,
        input: { name: normalizedName, provider, authType: "OAUTH2" },
      });
      setName("");
      setProvider("GMAIL");
      setIsCreateOpen(false);
    } catch (error) {
      setCreateError(getErrorMessage(error, t));
    }
  };

  const connections = connectionsQuery.data ?? [];

  return (
    <main
      data-testid="connections-page"
      className="mx-auto flex w-full max-w-5xl flex-col gap-5"
    >
      <header className="flex flex-col gap-4 border-b border-border pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-foreground">
            {t("connections.title")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("connections.workspace_scope")}
          </p>
          {activeWorkspace && (
            <p className="mt-2 text-sm font-semibold text-foreground">
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
            className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
          className="rounded-lg border border-border bg-card p-3 text-sm text-foreground"
        >
          {oauthNotice}
        </p>
      )}

      {!activeWorkspaceId ? (
        workspacesQuery.isPending ? (
          <p
            data-testid="connections-workspace-loading"
            role="status"
            className="rounded-xl border border-border p-5 text-sm text-muted-foreground"
          >
            {t("connections.workspaces_loading")}
          </p>
        ) : workspacesQuery.isError ? (
          <div
            className="rounded-xl border border-destructive/40 bg-destructive/5 p-5"
            role="alert"
          >
            <p>{t("connections.workspaces_error")}</p>
            <button
              type="button"
              onClick={() => void workspacesQuery.refetch()}
              className="mt-3 rounded-md px-3 py-2 text-sm font-semibold underline"
            >
              {t("connections.retry")}
            </button>
          </div>
        ) : (
          <section
            data-testid="connections-no-workspace"
            className="rounded-xl border border-border bg-card p-6"
          >
            <h2 className="font-semibold text-foreground">
              {t("connections.no_workspace_title")}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("connections.no_workspace_body")}
            </p>
            <Link
              to="/workspace"
              className="mt-4 inline-flex min-h-10 items-center rounded-lg border border-border px-4 text-sm font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
          className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground"
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
          className="rounded-xl border border-destructive/40 bg-destructive/5 p-5"
          role="alert"
        >
          <p data-testid="connections-error">
            {getErrorMessage(connectionsQuery.error, t)}
          </p>
          <button
            type="button"
            data-testid="connections-retry"
            onClick={() => void connectionsQuery.refetch()}
            className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <RefreshCw size={14} aria-hidden="true" />
            {t("connections.retry")}
          </button>
        </section>
      ) : connections.length === 0 ? (
        <section
          data-testid="connections-empty-state"
          className="rounded-xl border border-dashed border-border bg-card px-5 py-10 text-center"
        >
          <h2 className="font-semibold text-foreground">
            {t("connections.empty_title")}
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            {t("connections.empty_body")}
          </p>
        </section>
      ) : (
        <ul data-testid="connection-list" className="flex flex-col gap-3">
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

      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="connection-create-title"
            data-testid="connection-create-dialog"
            className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-xl"
          >
            <div className="flex items-center justify-between gap-3">
              <h2
                id="connection-create-title"
                className="text-base font-bold text-foreground"
              >
                {t("connections.create.title")}
              </h2>
              <button
                type="button"
                aria-label={t("connections.close")}
                onClick={() => setIsCreateOpen(false)}
                className="rounded-md p-2 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <form
              data-testid="connection-create-form"
              onSubmit={handleCreate}
              className="mt-5 flex flex-col gap-4"
            >
              <div>
                <label
                  htmlFor="connection-create-name"
                  className="mb-1.5 block text-sm font-medium text-foreground"
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
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <div>
                <label
                  htmlFor="connection-create-provider"
                  className="mb-1.5 block text-sm font-medium text-foreground"
                >
                  {t("connections.create.provider")}
                </label>
                <select
                  id="connection-create-provider"
                  data-testid="connection-create-provider"
                  value={provider}
                  onChange={(event) =>
                    setProvider(event.target.value as GoogleProvider)
                  }
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="GMAIL">Gmail</option>
                  <option value="GOOGLE_SHEETS">Google Sheets</option>
                </select>
              </div>
              {createError && (
                <p
                  data-testid="connection-create-error"
                  role="alert"
                  className="text-sm text-destructive"
                >
                  {createError}
                </p>
              )}
              <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  disabled={createConnection.isPending}
                  className="min-h-10 rounded-lg border border-border px-4 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
                >
                  {t("connections.cancel")}
                </button>
                <button
                  type="submit"
                  data-testid="connection-create-submit"
                  disabled={createConnection.isPending}
                  className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:cursor-wait disabled:opacity-60"
                >
                  {createConnection.isPending && (
                    <LoaderCircle
                      size={15}
                      className="animate-spin"
                      aria-hidden="true"
                    />
                  )}
                  {createConnection.isPending
                    ? t("connections.create.pending")
                    : t("connections.create.submit")}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
