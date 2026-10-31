import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { UserId } from "@shared/identity";
import { log } from "@core/src/shared/infrastructure/logger";
import { prisma, systemPrisma } from "@core/src/shared/infrastructure/persistance";
import { isPersistenceFailure } from "@core/src/shared/infrastructure/persistence-error";
import type { ConnectionWithPasswordChange, OAuthClientId } from "@core/src/features/assistants/domain/assistant-connection";
import { parseAssistantConnectionRow, type InvalidConnectionRow } from "@core/src/features/assistants/infrastructure/connection-rows";

export type ConnectionLookupError = InvalidConnectionRow | Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;

/**
 * The connection of (client, account) in the current company, with the time the account's password last changed.
 * Runs inside `withTenantIsolation`: the row is read under RLS; the credential account is a global auth table.
 */
export async function findConnectionForClient(oauthClientId: OAuthClientId, userId: UserId): Promise<Result<ConnectionWithPasswordChange | null, ConnectionLookupError>> {
  try {
    const row = await prisma.assistantConnection.findFirst({ where: { oauthClientId, authorizedByUserId: userId } });
    if (row === null) return ok(null);
    const parsed = parseAssistantConnectionRow(row);
    if (!parsed.success) return err(parsed.error);
    // One probe on the (userId) index even if social sign-in adds account rows.
    const credential = await systemPrisma.account.findFirst({ where: { userId, providerId: "credential" }, select: { updatedAt: true } });
    return ok({ ...parsed.data, passwordChangedAt: credential?.updatedAt ?? null });
  } catch (cause) {
    if (!isPersistenceFailure(cause)) throw cause;
    log.error({ event: "assistant_connection_lookup_failed", errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "assistant_connection_lookup_failed");
    return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Assistant connection unavailable" });
  }
}
