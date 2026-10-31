import { Prisma } from "@prisma/client";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { CompanyId, UserId } from "@shared/identity";
import { log } from "@core/src/shared/infrastructure/logger";
import { prisma, systemPrisma, withinTransaction, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { isPersistenceFailure } from "@core/src/shared/infrastructure/persistence-error";
import {
  isConnectionActive,
  type AssistantConnectionId, type ConnectionWithPasswordChange, type NewAssistantConnection,
} from "@core/src/features/assistants/domain/assistant-connection";
import type { AuthorizeAssistantError, SaveConnectionOutcome } from "@core/src/features/assistants/application/authorize-assistant";
import type { EndedConnection, PersistenceError } from "@core/src/features/assistants/application/disconnect-assistant";
import type { ListConnectionsError } from "@core/src/features/assistants/application/list-assistant-connections";
import { assistantConfig } from "@core/src/features/assistants/infrastructure/assistant-config";
import { parseAssistantConnectionRow } from "@core/src/features/assistants/infrastructure/connection-rows";

const unavailable = { code: "PERSISTENCE_UNAVAILABLE", message: "Assistant connections unavailable" } as const;

function persistenceFailure(event: string, cause: unknown): typeof unavailable {
  if (!isPersistenceFailure(cause)) throw cause;
  log.error({ event, errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, event);
  return unavailable;
}

type ReturnColumns = Readonly<{ returnKind: "web" | "this_device"; returnDomain: string | null }>;
const returnColumns = (connection: NewAssistantConnection): ReturnColumns =>
  connection.returnTarget.kind === "web" ? { returnKind: "web", returnDomain: connection.returnTarget.domain } : { returnKind: "this_device", returnDomain: null };

/** The credential account's last change per account: a connection authorized before it is ended. */
async function passwordChanges(userIds: readonly string[]): Promise<ReadonlyMap<string, Date>> {
  if (userIds.length === 0) return new Map();
  const accounts = await systemPrisma.account.findMany({ where: { userId: { in: [...userIds] }, providerId: "credential" }, select: { userId: true, updatedAt: true } });
  return new Map(accounts.map((account) => [account.userId, account.updatedAt]));
}

/**
 * First tap inserts; a conflict (earlier row or a concurrent first tap) locks the row: an active one stays as it is,
 * an ended one that is still stored is reactivated with the new authorization.
 */
async function saveConnection(connection: NewAssistantConnection): Promise<Result<SaveConnectionOutcome, AuthorizeAssistantError>> {
  const { returnKind, returnDomain } = returnColumns(connection);
  try {
    const outcome = await withTenantIsolation(connection.companyId, () => withinTransaction(async () => {
      const inserted = await prisma.$queryRaw<{ id: string }[]>`
        INSERT INTO "AssistantConnection" ("id", "companyId", "authorizedByUserId", "oauthClientId", "agentName", "returnKind", "returnDomain", "scopes", "authorizedAt")
        VALUES (${connection.id}::uuid, ${connection.companyId}::uuid, ${connection.authorizedByUserId}, ${connection.oauthClientId}, ${connection.agentName},
          ${returnKind}, ${returnDomain}, ${[...connection.scopes]}::text[], ${connection.authorizedAt})
        ON CONFLICT ("companyId", "oauthClientId", "authorizedByUserId") DO NOTHING
        RETURNING "id"`;
      if (inserted.length > 0) return ok<SaveConnectionOutcome>("inserted");
      const [existing] = await prisma.$queryRaw<unknown[]>`
        SELECT * FROM "AssistantConnection"
        WHERE "companyId" = ${connection.companyId}::uuid AND "oauthClientId" = ${connection.oauthClientId} AND "authorizedByUserId" = ${connection.authorizedByUserId}
        FOR UPDATE`;
      const parsed = parseAssistantConnectionRow(existing);
      if (!parsed.success) return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: parsed.error.message });
      const passwordChangedAt = (await passwordChanges([connection.authorizedByUserId])).get(connection.authorizedByUserId) ?? null;
      if (isConnectionActive({ ...parsed.data, passwordChangedAt }, connection.authorizedAt, assistantConfig.connectionInactivityDays)) return ok<SaveConnectionOutcome>("unchanged");
      await prisma.$executeRaw`
        UPDATE "AssistantConnection"
        SET "agentName" = ${connection.agentName}, "returnKind" = ${returnKind}, "returnDomain" = ${returnDomain},
          "scopes" = ${[...connection.scopes]}::text[], "authorizedAt" = ${connection.authorizedAt}, "lastUsedAt" = NULL
        WHERE "id" = ${parsed.data.id}::uuid`;
      return ok<SaveConnectionOutcome>("reactivated");
    }));
    if (outcome.success && outcome.data !== "unchanged") {
      log.info({ event: "assistant_connection_created", companyId: connection.companyId, connectionId: connection.id, userId: connection.authorizedByUserId, oauthClientId: connection.oauthClientId, returnKind }, "assistant_connection_created");
    }
    return outcome;
  } catch (cause) {
    return err(persistenceFailure("assistant_connection_save_failed", cause));
  }
}

async function findConnections(companyId: CompanyId): Promise<Result<readonly ConnectionWithPasswordChange[], ListConnectionsError>> {
  try {
    const rows = await withTenantIsolation(companyId, async () => await prisma.assistantConnection.findMany({ orderBy: [{ authorizedAt: "desc" }, { id: "asc" }] }));
    const connections = [];
    for (const row of rows) {
      const parsed = parseAssistantConnectionRow(row);
      if (!parsed.success) return err(parsed.error);
      connections.push(parsed.data);
    }
    const changes = await passwordChanges([...new Set(connections.map((connection) => connection.authorizedByUserId))]);
    return ok(connections.map((connection) => ({ ...connection, passwordChangedAt: changes.get(connection.authorizedByUserId) ?? null })));
  } catch (cause) {
    return err(persistenceFailure("assistant_connection_list_failed", cause));
  }
}

type DeletedRow = Readonly<{ id: string; companyId: string; oauthClientId: string; authorizedByUserId: string }>;
const endedOf = (row: DeletedRow): EndedConnection => ({
  id: row.id as AssistantConnectionId, companyId: row.companyId as CompanyId, oauthClientId: row.oauthClientId as EndedConnection["oauthClientId"], authorizedByUserId: row.authorizedByUserId as UserId,
});

async function deleteConnection(id: AssistantConnectionId, companyId: CompanyId): Promise<Result<EndedConnection | null, PersistenceError>> {
  try {
    const rows = await withTenantIsolation(companyId, async () => await prisma.$queryRaw<DeletedRow[]>(Prisma.sql`
      DELETE FROM "AssistantConnection" WHERE "id" = ${id}::uuid AND "companyId" = ${companyId}::uuid
      RETURNING "id", "companyId", "oauthClientId", "authorizedByUserId"`));
    if (rows.length === 0) return ok(null);
    log.info({ event: "assistant_connection_ended", companyId, connectionId: id, reason: "disconnected" }, "assistant_connection_ended");
    return ok(endedOf(rows[0]));
  } catch (cause) {
    return err(persistenceFailure("assistant_connection_delete_failed", cause));
  }
}

async function deleteAccountConnections(companyId: CompanyId, userId: UserId): Promise<Result<readonly EndedConnection[], PersistenceError>> {
  try {
    const rows = await withTenantIsolation(companyId, async () => await prisma.$queryRaw<DeletedRow[]>(Prisma.sql`
      DELETE FROM "AssistantConnection" WHERE "companyId" = ${companyId}::uuid AND "authorizedByUserId" = ${userId}
      RETURNING "id", "companyId", "oauthClientId", "authorizedByUserId"`));
    for (const row of rows) log.info({ event: "assistant_connection_ended", companyId, connectionId: row.id, reason: "password_reset" }, "assistant_connection_ended");
    return ok(rows.map(endedOf));
  } catch (cause) {
    return err(persistenceFailure("assistant_connection_delete_failed", cause));
  }
}

export const connectionRepository = { saveConnection, findConnections, deleteConnection, deleteAccountConnections };
