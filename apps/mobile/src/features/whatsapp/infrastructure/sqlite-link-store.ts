import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { LinkStore, StoreError } from "@mobile/features/whatsapp/application/ports";
import { parseAccountId, parseCompanyId, parseLinkId, parseUserId } from "@mobile/features/whatsapp/domain/ids";
import type { WhatsAppLink } from "@mobile/features/whatsapp/domain/link";
import type { LocalSql } from "@mobile/features/whatsapp/infrastructure/local-sql";

type LinkRow = Readonly<{
  id: string; company_id: string; linked_by_user_id: string; account_id: string | null; started_at: number; ended_at: number | null;
}>;

const storageFailure: StoreError = { code: "LOCAL_STORAGE_FAILED", message: "Local storage failed" };
const columns = "id, company_id, linked_by_user_id, account_id, started_at, ended_at";

function unwrap<T>(result: Result<T, { message: string }>): T {
  if (!result.success) throw new Error(`Stored link is invalid: ${result.error.message}`);
  return result.data;
}

function toLink(row: LinkRow): WhatsAppLink {
  return {
    id: unwrap(parseLinkId(row.id)),
    companyId: unwrap(parseCompanyId(row.company_id)),
    linkedByUserId: unwrap(parseUserId(row.linked_by_user_id)),
    accountId: row.account_id === null ? null : unwrap(parseAccountId(row.account_id)),
    startedAt: new Date(row.started_at),
    endedAt: row.ended_at === null ? null : new Date(row.ended_at),
  };
}

async function guarded<T>(operation: () => Promise<T>): Promise<Result<T, StoreError>> {
  try {
    return ok(await operation());
  } catch {
    return err(storageFailure);
  }
}

export function createSqliteLinkStore(sql: LocalSql, newId: () => string): LinkStore {
  return {
    all: () => guarded(async () => (await sql.all<LinkRow>(`SELECT ${columns} FROM whatsapp_links ORDER BY started_at, id`)).map(toLink)),
    active: () => guarded(async () => {
      const row = await sql.first<LinkRow>(`SELECT ${columns} FROM whatsapp_links WHERE ended_at IS NULL`);
      return row ? toLink(row) : null;
    }),
    start: (companyId, userId, now) => guarded(async () => {
      const id = newId();
      await sql.run(
        "INSERT INTO whatsapp_links (id, company_id, linked_by_user_id, account_id, started_at, ended_at) VALUES (?, ?, ?, NULL, ?, NULL)",
        id, companyId, userId, now.getTime(),
      );
      const row = await sql.first<LinkRow>(`SELECT ${columns} FROM whatsapp_links WHERE id = ?`, id);
      if (!row) throw new Error("Inserted link not found");
      return toLink(row);
    }),
    end: (id, now) => guarded(async () => {
      await sql.run("UPDATE whatsapp_links SET ended_at = ? WHERE id = ? AND ended_at IS NULL", now.getTime(), id);
    }),
  };
}
