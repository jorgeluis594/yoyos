import { z } from "zod";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { CompanyId, UserId } from "@shared/identity";
import { log } from "@core/src/shared/infrastructure/logger";
import { assistantScopes } from "@core/src/features/assistants/domain/scopes";
import type { EndedConnection } from "@core/src/features/assistants/application/disconnect-assistant";
import { agentNameLengthIsValid, type AgentName, AssistantConnection, AssistantConnectionId, OAuthClientId, ReturnTarget } from "@core/src/features/assistants/domain/assistant-connection";

export type InvalidConnectionRow = Readonly<{ code: "INVALID_STORED_DATA"; message: string }>;

const connectionRowSchema = z.strictObject({
  id: z.uuid(),
  companyId: z.uuid(),
  authorizedByUserId: z.string().min(1),
  oauthClientId: z.string().min(1),
  agentName: z.string().refine(agentNameLengthIsValid).nullable(),
  returnKind: z.enum(["web", "this_device"]),
  returnDomain: z.string().min(1).max(253).nullable(),
  scopes: z.array(z.enum(assistantScopes)).min(1),
  authorizedAt: z.date(),
  lastUsedAt: z.date().nullable(),
}).refine((row) => (row.returnKind === "web") === (row.returnDomain !== null));

function returnTargetOfRow(kind: "web" | "this_device", domain: string | null): ReturnTarget {
  return kind === "web" && domain !== null ? { kind: "web", domain } : { kind: "this_device" };
}

/** The only reader of AssistantConnection rows: every repository of the feature goes through it. */
export function parseAssistantConnectionRow(value: unknown): Result<AssistantConnection, InvalidConnectionRow> {
  const parsed = connectionRowSchema.safeParse(value);
  if (!parsed.success) {
    log.error({ event: "assistant_connection_row_invalid", errorCode: "INVALID_STORED_DATA" }, "assistant_connection_row_invalid");
    return err({ code: "INVALID_STORED_DATA", message: "Invalid stored assistant connection" });
  }
  const row = parsed.data;
  const [firstScope, ...otherScopes] = row.scopes;
  return ok({
    id: row.id as AssistantConnectionId,
    companyId: row.companyId as CompanyId,
    authorizedByUserId: row.authorizedByUserId as UserId,
    oauthClientId: row.oauthClientId as OAuthClientId,
    agentName: row.agentName as AgentName | null,
    returnTarget: returnTargetOfRow(row.returnKind, row.returnDomain),
    scopes: [firstScope, ...otherScopes],
    authorizedAt: row.authorizedAt,
    lastUsedAt: row.lastUsedAt,
  });
}

const endedConnectionRowSchema = z.strictObject({
  id: z.uuid(),
  companyId: z.uuid(),
  oauthClientId: z.string().min(1),
  authorizedByUserId: z.string().min(1),
});

/** The columns `DELETE … RETURNING` hands back: what the grant revocation needs to know about the ended connection. */
export function parseEndedConnectionRow(value: unknown): Result<EndedConnection, InvalidConnectionRow> {
  const parsed = endedConnectionRowSchema.safeParse(value);
  if (!parsed.success) {
    log.error({ event: "assistant_connection_row_invalid", errorCode: "INVALID_STORED_DATA" }, "assistant_connection_row_invalid");
    return err({ code: "INVALID_STORED_DATA", message: "Invalid stored assistant connection" });
  }
  const row = parsed.data;
  return ok({
    id: row.id as AssistantConnectionId,
    companyId: row.companyId as CompanyId,
    oauthClientId: row.oauthClientId as OAuthClientId,
    authorizedByUserId: row.authorizedByUserId as UserId,
  });
}
