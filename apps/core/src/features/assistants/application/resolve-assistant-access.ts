import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { CompanyId, UserId } from "@shared/identity";
import type { UserAccess } from "@core/src/features/users";
import {
  isConnectionActive,
  type AssistantConnection, type AssistantConnectionId, type ConnectionWithPasswordChange, type OAuthClientId,
} from "@core/src/features/assistants/domain/assistant-connection";
import type { AssistantScope } from "@core/src/features/assistants/domain/scopes";

export type VerifiedAssistantToken = Readonly<{ userId: UserId; oauthClientId: OAuthClientId; scopes: readonly AssistantScope[] }>;
export type VerifiedToken = VerifiedAssistantToken & Readonly<{ expiresAt: number }>;
export type AssistantTokenError = Readonly<{ code: "INVALID_TOKEN" | "AUTH_SERVICE_UNAVAILABLE"; message: string }>;
export type AssistantAccess = Readonly<{
  companyId: CompanyId; userId: UserId; connectionId: AssistantConnectionId; scopes: readonly AssistantScope[]; lastUsedAt: Date | null;
}>;
export type RefusalReason = "not_ready" | "no_connection" | "inactive" | "password_changed" | "scope";
export type ResolveAssistantAccessError =
  | Readonly<{ code: "NOT_AUTHORIZED"; reason: RefusalReason; message: string; companyId?: CompanyId }>
  | Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;
export type ResolveAssistantAccessDependencies = Readonly<{
  loadUserAccess: (userId: UserId) => Promise<Result<UserAccess | null, ResolveAssistantAccessError>>;
  inTenant: <T>(companyId: CompanyId, work: () => Promise<T>) => Promise<T>;
  findConnection: (oauthClientId: OAuthClientId, userId: UserId) => Promise<Result<ConnectionWithPasswordChange | null, ResolveAssistantAccessError>>;
  endConnection: (connection: AssistantConnection, reason: "inactive" | "password_reset") => Promise<Result<null, ResolveAssistantAccessError>>;
  clock: () => Date;
  inactivityDays: number;
}>;

const notAuthorized = (reason: RefusalReason, companyId?: CompanyId) =>
  err({ code: "NOT_AUTHORIZED" as const, reason, message: "Assistant access is not authorized", ...(companyId ? { companyId } : {}) });

/**
 * Turns a verified token into the access of one store: the same `loadUserAccess` as cookies and mobile tokens, then the active
 * connection of (client, account) in that store. The connection row decides, never the token lifetime.
 */
export async function resolveAssistantAccess(
  token: VerifiedAssistantToken, dependencies: ResolveAssistantAccessDependencies,
): Promise<Result<AssistantAccess, ResolveAssistantAccessError>> {
  const loaded = await dependencies.loadUserAccess(token.userId);
  if (!loaded.success) return loaded;
  if (loaded.data === null || loaded.data.status !== "ready") return notAuthorized("not_ready");
  const companyId = loaded.data.company.id as CompanyId;
  return dependencies.inTenant(companyId, async () => {
    const found = await dependencies.findConnection(token.oauthClientId, token.userId);
    if (!found.success) return found;
    if (found.data === null) return notAuthorized("no_connection", companyId);
    const connection = found.data;
    if (!isConnectionActive(connection, dependencies.clock(), dependencies.inactivityDays)) {
      const passwordChanged = connection.passwordChangedAt !== null && connection.authorizedAt.getTime() <= connection.passwordChangedAt.getTime();
      const ended = await dependencies.endConnection(connection, passwordChanged ? "password_reset" : "inactive");
      if (!ended.success) return ended;
      return notAuthorized(passwordChanged ? "password_changed" : "inactive", companyId);
    }
    const scopes = token.scopes.filter((scope) => connection.scopes.includes(scope));
    if (!scopes.includes("orders:read")) return notAuthorized("scope", companyId);
    return ok({ companyId, userId: token.userId, connectionId: connection.id, scopes, lastUsedAt: connection.lastUsedAt });
  });
}
