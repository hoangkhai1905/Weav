import axios, { type AxiosRequestConfig } from "axios";
import { getStoredAuthToken } from "./ocr.api";
import { tr } from '../lib/i18n/tr';

export type ConnectionProvider =
  "TELEGRAM" | "HTTP" | "GMAIL" | "GOOGLE_SHEETS";
export type GoogleProvider = Extract<
  ConnectionProvider,
  "GMAIL" | "GOOGLE_SHEETS"
>;
export type ConnectionAuthType =
  "NONE" | "TOKEN" | "API_KEY" | "BASIC" | "OAUTH2";
export type ConnectionStatus = "DISABLED" | "ACTIVE" | "INVALID";

export interface ConnectionResponse {
  id: string;
  workspaceId: string;
  createdBy: string;
  name: string;
  provider: ConnectionProvider;
  authType: ConnectionAuthType;
  status: ConnectionStatus;
  config: Record<string, unknown> | null;
  hasCredential: boolean;
  credentialExpiresAt: string | null;
  lastVerifiedAt: string | null;
  canManage: boolean;
  canAttach: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateGoogleConnectionRequest {
  name: string;
  provider: GoogleProvider;
  authType: "OAUTH2";
}

export type ConnectionTestResponse = { outcome: "VERIFIED" | "AUTH_INVALID" };
export type OAuthStartResponse = { authorizationUrl: string };

interface ErrorEnvelope {
  code?: unknown;
  message?: unknown;
  requestId?: unknown;
  error?: {
    code?: unknown;
    message?: unknown;
  };
}

export class ConnectionApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;

  constructor(
    status: number,
    code: string,
    message: string,
    requestId?: string,
  ) {
    super(message);
    this.name = "ConnectionApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

const connectionHttpClient = axios.create({
  baseURL: (
    import.meta.env.VITE_API_GATEWAY_URL ||
    import.meta.env.VITE_API_BASE_URL ||
    "http://localhost:3000"
  ).replace(/\/+$/, ""),
  timeout: 10000,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOneOf<const T extends readonly string[]>(
  value: unknown,
  values: T,
): value is T[number] {
  return typeof value === "string" && values.includes(value);
}

function responseErrorMessage(status: number): {
  code: string;
  message: string;
} {
  if (status === 400)
    return {
      code: "INVALID_REQUEST",
      message: tr('msg.please_check_the_connection_details_and_try'),
    };
  if (status === 401)
    return { code: "UNAUTHENTICATED", message: tr('msg.please_sign_in_again') };
  if (status === 403)
    return {
      code: "FORBIDDEN",
      message: tr('msg.you_do_not_have_access_to_this'),
    };
  if (status === 404)
    return {
      code: "NOT_FOUND",
      message: tr('msg.this_connection_was_not_found_in_the'),
    };
  if (status === 409)
    return {
      code: "CONFLICT",
      message: tr('msg.this_connection_cannot_be_changed_while_it'),
    };
  if (status === 422)
    return {
      code: "INVALID_STATE",
      message: tr('msg.this_connection_cannot_be_used_in_its'),
    };
  if (status === 429)
    return {
      code: "RATE_LIMITED",
      message: tr('msg.the_connection_service_is_busy_please_try'),
    };
  return {
    code: "CONNECTION_UNAVAILABLE",
    message: tr('msg.the_connection_service_is_temporarily_unavailable'),
  };
}

function errorField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function toConnectionApiError(error: unknown): ConnectionApiError {
  const response = axios.isAxiosError(error) ? error.response : undefined;
  const status = response?.status ?? 0;
  const body = isRecord(response?.data)
    ? (response.data as ErrorEnvelope)
    : undefined;
  const fallback = responseErrorMessage(status);
  const headers = response?.headers;
  const requestIdHeader =
    headers && typeof headers.get === "function"
      ? headers.get("x-request-id")
      : headers?.["x-request-id"];

  return new ConnectionApiError(
    status,
    errorField(body?.error?.code) ?? errorField(body?.code) ?? fallback.code,
    errorField(body?.error?.message) ??
      errorField(body?.message) ??
      fallback.message,
    errorField(body?.requestId) ?? errorField(requestIdHeader),
  );
}

function invalidResponse(message: string): never {
  throw new ConnectionApiError(502, "INVALID_RESPONSE", message);
}

function parseConnection(value: unknown): ConnectionResponse {
  if (!isRecord(value))
    return invalidResponse(
      tr('msg.workspace_returned_an_invalid_connection_response'),
    );

  const providers = ["TELEGRAM", "HTTP", "GMAIL", "GOOGLE_SHEETS"] as const;
  const authTypes = ["NONE", "TOKEN", "API_KEY", "BASIC", "OAUTH2"] as const;
  const statuses = ["DISABLED", "ACTIVE", "INVALID"] as const;
  const nullableString = (field: unknown) =>
    field === null || typeof field === "string";

  if (
    typeof value.id !== "string" ||
    typeof value.workspaceId !== "string" ||
    typeof value.createdBy !== "string" ||
    typeof value.name !== "string" ||
    !isOneOf(value.provider, providers) ||
    !isOneOf(value.authType, authTypes) ||
    !isOneOf(value.status, statuses) ||
    !(value.config === null || isRecord(value.config)) ||
    typeof value.hasCredential !== "boolean" ||
    !nullableString(value.credentialExpiresAt) ||
    !nullableString(value.lastVerifiedAt) ||
    typeof value.canManage !== "boolean" ||
    typeof value.canAttach !== "boolean" ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string"
  ) {
    return invalidResponse(
      tr('msg.workspace_returned_an_invalid_connection_response'),
    );
  }

  return value as unknown as ConnectionResponse;
}

function parseConnectionTest(value: unknown): ConnectionTestResponse {
  if (
    !isRecord(value) ||
    !isOneOf(value.outcome, ["VERIFIED", "AUTH_INVALID"] as const)
  ) {
    return invalidResponse(
      tr('msg.workspace_returned_an_invalid_connection_test_response'),
    );
  }
  return { outcome: value.outcome };
}

function parseOAuthStart(value: unknown): OAuthStartResponse {
  if (isRecord(value) && typeof value.authorizationUrl === "string") {
    try {
      const url = new URL(value.authorizationUrl);
      if (url.protocol === "https:")
        return { authorizationUrl: url.toString() };
    } catch {
      // Convert malformed authorization URLs to the same safe response error below.
    }
  }
  return invalidResponse(
    tr('msg.workspace_returned_an_invalid_authorization_response'),
  );
}

function pathSegment(value: string): string {
  if (!value.trim())
    throw new ConnectionApiError(
      400,
      "INVALID_REQUEST",
      tr('msg.a_workspace_and_connection_id_are_required'),
    );
  return encodeURIComponent(value);
}

async function request<T>(config: AxiosRequestConfig): Promise<T> {
  const token = getStoredAuthToken();
  if (!token) {
    throw new ConnectionApiError(
      401,
      "UNAUTHENTICATED",
      tr('msg.please_sign_in_again'),
    );
  }

  try {
    const response = await connectionHttpClient.request<unknown>({
      ...config,
      headers: { ...(config.headers ?? {}), Authorization: `Bearer ${token}` },
    });
    return response.data as T;
  } catch (error) {
    if (axios.isCancel(error)) throw error;
    throw toConnectionApiError(error);
  }
}

function basePath(workspaceId: string): string {
  return `/api/v1/workspaces/${pathSegment(workspaceId)}/connections`;
}

function itemPath(workspaceId: string, connectionId: string): string {
  return `${basePath(workspaceId)}/${pathSegment(connectionId)}`;
}

function normalizedName(name: string): string {
  const normalized = name.trim();
  if (!normalized || normalized.length > 120) {
    throw new ConnectionApiError(
      400,
      "INVALID_REQUEST",
      tr('msg.connection_name_must_be_between_1_and'),
    );
  }
  return normalized;
}

export const connectionApi = {
  async list(
    workspaceId: string,
    signal?: AbortSignal,
  ): Promise<ConnectionResponse[]> {
    const value = await request<unknown>({
      method: "GET",
      url: basePath(workspaceId),
      signal,
    });
    if (!Array.isArray(value))
      return invalidResponse(tr('msg.workspace_returned_an_invalid_connection_list'));
    return value.map(parseConnection);
  },

  async create(
    workspaceId: string,
    input: CreateGoogleConnectionRequest,
  ): Promise<ConnectionResponse> {
    const value = await request<unknown>({
      method: "POST",
      url: basePath(workspaceId),
      data: {
        name: normalizedName(input.name),
        provider: input.provider,
        authType: "OAUTH2",
      },
    });
    return parseConnection(value);
  },

  async get(
    workspaceId: string,
    connectionId: string,
  ): Promise<ConnectionResponse> {
    return parseConnection(
      await request<unknown>({
        method: "GET",
        url: itemPath(workspaceId, connectionId),
      }),
    );
  },

  async rename(
    workspaceId: string,
    connectionId: string,
    name: string,
  ): Promise<ConnectionResponse> {
    return parseConnection(
      await request<unknown>({
        method: "PATCH",
        url: itemPath(workspaceId, connectionId),
        data: { name: normalizedName(name) },
      }),
    );
  },

  async test(
    workspaceId: string,
    connectionId: string,
  ): Promise<ConnectionTestResponse> {
    return parseConnectionTest(
      await request<unknown>({
        method: "POST",
        url: `${itemPath(workspaceId, connectionId)}/test`,
      }),
    );
  },

  async disable(
    workspaceId: string,
    connectionId: string,
  ): Promise<ConnectionResponse> {
    return parseConnection(
      await request<unknown>({
        method: "POST",
        url: `${itemPath(workspaceId, connectionId)}/disable`,
      }),
    );
  },

  async remove(workspaceId: string, connectionId: string): Promise<void> {
    await request<void>({
      method: "DELETE",
      url: itemPath(workspaceId, connectionId),
    });
  },

  /** Binds the Google return to the signed-in user; the completion id is single use. */
  async completeGoogleOAuth(
    workspaceId: string,
    connectionId: string,
    completion: string,
  ): Promise<ConnectionTestResponse> {
    return parseConnectionTest(
      await request<unknown>({
        method: "POST",
        url: `${itemPath(workspaceId, connectionId)}/oauth/complete`,
        data: { completion },
      }),
    );
  },

  async startGoogleOAuth(
    workspaceId: string,
    connectionId: string,
  ): Promise<OAuthStartResponse> {
    return parseOAuthStart(
      await request<unknown>({
        method: "POST",
        url: `${itemPath(workspaceId, connectionId)}/oauth/authorize`,
      }),
    );
  },
};
