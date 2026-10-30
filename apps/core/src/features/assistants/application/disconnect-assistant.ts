import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { CompanyId, UserId } from "@shared/identity";
import type { AssistantConnectionId, OAuthClientId } from "@core/src/features/assistants/domain/assistant-connection";
import type { AssistantOwnerAccess } from "@core/src/features/assistants/application/authorize-assistant";

export type EndedConnection = Readonly<{ id: AssistantConnectionId; oauthClientId: OAuthClientId; authorizedByUserId: UserId }>;
export type PersistenceError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;
export type RevokeClientGrant = (grant: EndedConnection) => Promise<Result<unknown, Readonly<{ code: "REVOCATION_FAILED"; message: string }>>>;

export type DisconnectAssistantInput = Readonly<{ connectionId: AssistantConnectionId }>;
export type DisconnectAssistantDependencies = Readonly<{
  deleteConnection: (id: AssistantConnectionId, companyId: CompanyId) => Promise<Result<EndedConnection | null, PersistenceError>>;
  revokeClientGrant: RevokeClientGrant;
}>;

/**
 * Deletes the row under RLS and revokes the client's grant. No row (another tab ended it, or another store's id) is success too.
 * The row is the authority: a revocation failure is logged by the adapter and does not undo the disconnection.
 */
export async function disconnectAssistant(input: DisconnectAssistantInput, access: AssistantOwnerAccess, deps: DisconnectAssistantDependencies): Promise<Result<null, PersistenceError>> {
  const deleted = await deps.deleteConnection(input.connectionId, access.companyId);
  if (!deleted.success) return deleted;
  if (deleted.data !== null) await deps.revokeClientGrant(deleted.data);
  return ok(null);
}

export type AccountAccess =
  | Readonly<{ status: "ready"; company: Readonly<{ id: string }> }>
  | Readonly<{ status: "verification_required" | "company_required"; company: null }>;
export type EndAccountAssistantConnectionsDependencies = Readonly<{
  loadAccess: (userId: UserId) => Promise<Result<AccountAccess | null, PersistenceError>>;
  deleteAccountConnections: (companyId: CompanyId, userId: UserId) => Promise<Result<readonly EndedConnection[], PersistenceError>>;
  revokeClientGrant: RevokeClientGrant;
}>;

/** After a password reset: ends this account's connections in its store. Other accounts of the store keep theirs. Returns how many ended. */
export async function endAccountAssistantConnections(input: Readonly<{ userId: UserId }>, deps: EndAccountAssistantConnectionsDependencies): Promise<Result<number, PersistenceError>> {
  const access = await deps.loadAccess(input.userId);
  if (!access.success) return access;
  if (access.data === null || access.data.status !== "ready") return ok(0);
  const deleted = await deps.deleteAccountConnections(access.data.company.id as CompanyId, input.userId);
  if (!deleted.success) return err(deleted.error);
  for (const connection of deleted.data) await deps.revokeClientGrant(connection);
  return ok(deleted.data.length);
}
