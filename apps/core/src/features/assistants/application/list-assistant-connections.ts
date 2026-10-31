import { ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { CompanyId } from "@shared/identity";
import { isConnectionActive, type ConnectionWithPasswordChange } from "@core/src/features/assistants/domain/assistant-connection";
import type { AssistantOwnerAccess } from "@core/src/features/assistants/application/authorize-assistant";

export type ListConnectionsError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE" | "INVALID_STORED_DATA"; message: string }>;
export type ListAssistantConnectionsDependencies = Readonly<{
  findConnections: (companyId: CompanyId) => Promise<Result<readonly ConnectionWithPasswordChange[], ListConnectionsError>>;
  clock: () => Date;
  inactivityDays: number;
}>;

/** The store's active connections, newest authorization first. Ended ones are filtered here, not deleted. */
export async function listAssistantConnections(_input: Record<string, never>, access: AssistantOwnerAccess, deps: ListAssistantConnectionsDependencies): Promise<Result<readonly ConnectionWithPasswordChange[], ListConnectionsError>> {
  const found = await deps.findConnections(access.companyId);
  if (!found.success) return found;
  const now = deps.clock();
  return ok(found.data
    .filter((connection) => isConnectionActive(connection, now, deps.inactivityDays))
    .toSorted((a, b) => b.authorizedAt.getTime() - a.authorizedAt.getTime()));
}
