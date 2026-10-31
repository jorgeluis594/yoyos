import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { log } from "@core/src/shared/infrastructure/logger";
import { prisma } from "@core/src/shared/infrastructure/persistance";
import { isPersistenceFailure } from "@core/src/shared/infrastructure/persistence-error";
import type { AssistantConnection, AssistantConnectionId } from "@core/src/features/assistants/domain/assistant-connection";
import { revokeClientGrant } from "@core/src/features/assistants/infrastructure/oauth-grant-revocation";

export type ConnectionAccessError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;
const unavailable = (): ConnectionAccessError => ({ code: "PERSISTENCE_UNAVAILABLE", message: "Assistant connection unavailable" });

const minute = 60_000;

/**
 * «Último uso»: one conditional UPDATE in its own short transaction (the tenant client opens one per statement), never around a tool's reads.
 * The guard keeps the write to once per clock minute when two calls race past the in-process skip. Runs inside `withTenantIsolation`.
 */
export async function touchConnection(id: AssistantConnectionId, now: Date): Promise<Result<null, ConnectionAccessError>> {
  const startOfMinute = new Date(Math.floor(now.getTime() / minute) * minute);
  try {
    await prisma.assistantConnection.updateMany({
      where: { id, OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: startOfMinute } }] },
      data: { lastUsedAt: now },
    });
    return ok(null);
  } catch (cause) {
    if (!isPersistenceFailure(cause)) throw cause;
    log.warn({ event: "assistant_connection_touch_failed", connectionId: id, err: cause }, "assistant_connection_touch_failed");
    return err(unavailable());
  }
}

/**
 * Ends a connection that is no longer active: deletes the row (the authority) and then revokes the client's tokens and consent as cleanup.
 * A revocation failure is logged by the revoker and does not undo the deletion: the next call finds no connection and is refused.
 */
export async function endConnection(connection: AssistantConnection, reason: "inactive" | "password_reset"): Promise<Result<null, ConnectionAccessError>> {
  try {
    await prisma.assistantConnection.deleteMany({ where: { id: connection.id } });
  } catch (cause) {
    if (!isPersistenceFailure(cause)) throw cause;
    log.error({ event: "assistant_connection_end_failed", companyId: connection.companyId, connectionId: connection.id, errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "assistant_connection_end_failed");
    return err(unavailable());
  }
  log.info({ event: "assistant_connection_ended", companyId: connection.companyId, connectionId: connection.id, reason }, "assistant_connection_ended");
  await revokeClientGrant({ oauthClientId: connection.oauthClientId, userId: connection.authorizedByUserId, companyId: connection.companyId, connectionId: connection.id });
  return ok(null);
}
