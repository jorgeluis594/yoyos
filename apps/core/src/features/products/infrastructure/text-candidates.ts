import { Prisma } from "@prisma/client";
import { z } from "zod";
import { err, ok } from "@shared/functional";
import { currencies } from "@shared/money";
import { log } from "@core/src/shared/infrastructure/logger";
import { getCompanyId, prisma, withinTransaction } from "@core/src/shared/infrastructure/persistance";
import type { ProductId } from "@core/src/features/products/domain/product";
import type { TextCandidate, TextQuery } from "@core/src/features/products/domain/text-identification";
import { searchedWordCap, type TextMatchLimits } from "@core/src/features/products/domain/message-words";
import type { MessageCandidates } from "@core/src/features/products/application/find-message-candidates";

const rowSchema = z.object({
  idx: z.coerce.number().int().min(1), id: z.uuid(), name: z.string(), currency: z.enum(currencies),
  similarity: z.number().finite(), minPrice: z.number().nonnegative(), maxPrice: z.number().nonnegative(),
});

const unavailable = (cause: unknown) => {
  log.error({ event: "unable_to_find_text_candidates", companyId: getCompanyId(), errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "unable_to_find_text_candidates");
  return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to read catalog" });
};

/**
 * Active products with a sellable variant whose name resembles each mention, in one round trip.
 * Compares without case or accents; uses the company btree, not the global trigram index, because catalogs have hundreds of products.
 */
export async function findTextCandidates(queries: readonly TextQuery[], options: Readonly<{ limit: number; minSimilarity: number }>) {
  if (!queries.length) return ok<readonly (readonly TextCandidate[])[]>([]);
  const mentions = queries.map(({ mention }) => mention);
  let rows: unknown[];
  try {
    rows = await prisma.$queryRaw<unknown[]>(Prisma.sql`
      SELECT q.idx::int AS idx, c.id, c.name, c.currency, c.similarity, c."minPrice", c."maxPrice"
      FROM unnest(${mentions}::text[]) WITH ORDINALITY AS q(mention, idx)
      CROSS JOIN LATERAL (
        SELECT p.id, p.name, p.currency, word_similarity(unaccent(lower(q.mention)), unaccent(lower(p.name)))::float8 AS similarity,
          min(v."salePrice")::float8 AS "minPrice", max(v."salePrice")::float8 AS "maxPrice"
        FROM "Product" p
        JOIN "ProductVariant" v ON v."companyId" = p."companyId" AND v."productId" = p.id AND v.status = 'active'
        WHERE p."companyId" = ${getCompanyId()}::uuid AND p.status = 'active'
        GROUP BY p.id
        HAVING word_similarity(unaccent(lower(q.mention)), unaccent(lower(p.name))) >= ${options.minSimilarity}
        ORDER BY similarity DESC, p.id
        LIMIT ${options.limit}
      ) c
      ORDER BY q.idx, c.similarity DESC, c.id`);
  } catch (cause) {
    if (!(cause instanceof Prisma.PrismaClientKnownRequestError || cause instanceof Prisma.PrismaClientUnknownRequestError || cause instanceof Prisma.PrismaClientInitializationError)) throw cause;
    return unavailable(cause);
  }
  const parsed = z.array(rowSchema).safeParse(rows);
  if (!parsed.success) {
    log.error({ event: "unable_to_find_text_candidates", companyId: getCompanyId(), errorCode: "INVALID_STORED_DATA" }, "unable_to_find_text_candidates");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to read catalog" });
  }
  const grouped: TextCandidate[][] = queries.map(() => []);
  for (const row of parsed.data) grouped[row.idx - 1]?.push({ productId: row.id as ProductId, name: row.name, similarity: row.similarity,
    minPrice: { amount: row.minPrice, currency: row.currency }, maxPrice: { amount: row.maxPrice, currency: row.currency } });
  return ok<readonly (readonly TextCandidate[])[]>(grouped);
}

const statementTimeoutCode = "57014";

/** The statement timeout of PostgreSQL, whichever layer of the driver reports it. */
function isStatementTimeout(cause: unknown): boolean {
  if (!cause || typeof cause !== "object") return false;
  const { code, message, meta, cause: inner } = cause as { code?: unknown; message?: unknown; meta?: unknown; cause?: unknown };
  const metaText = meta === undefined ? "" : JSON.stringify(meta);
  return code === statementTimeoutCode || metaText.includes(statementTimeoutCode)
    || (typeof message === "string" && message.includes("statement timeout")) || metaText.includes("statement timeout") || isStatementTimeout(inner);
}

const coverageRowSchema = z.object({ id: z.uuid(), matches: z.coerce.number().int().min(1) });

/**
 * Active products with a sellable variant ranked by coverage, the sum of `word_similarity` over the words their name matches (design §5.3).
 * Scans the company's products as the app role under RLS, because the trigram index cannot serve these matches;
 * the cost is words × products, so the words are capped from the catalog size. A statement timeout is a result, not an error.
 */
export async function searchProductsByCoverage(words: readonly string[], limits: TextMatchLimits & Readonly<{ timeoutMs: number }>) {
  const companyId = getCompanyId();
  const started = performance.now();
  try {
    const found = await withinTransaction(async () => {
      await prisma.$queryRaw`SELECT set_config('jit', 'off', true)`;
      const [{ total }] = await prisma.$queryRaw<{ total: number }[]>(Prisma.sql`
        SELECT count(*)::int AS total FROM "Product" WHERE "companyId" = ${companyId}::uuid AND status = 'active'`);
      const searched = words.slice(0, searchedWordCap(total, limits));
      const rows = await prisma.$queryRaw<unknown[]>(coverageQuery(companyId, searched, limits));
      return ok({ rows, wordsSearched: searched.length });
    }, { statementTimeoutMs: limits.timeoutMs });
    const parsed = z.array(coverageRowSchema).safeParse(found.data.rows);
    if (!parsed.success) {
      log.error({ event: "unable_to_find_message_candidates", companyId, errorCode: "PERSISTENCE_UNAVAILABLE" }, "unable_to_find_message_candidates");
      return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to read catalog" });
    }
    const candidates: MessageCandidates = { productIds: parsed.data.map(({ id }) => id as ProductId), matchCount: parsed.data[0]?.matches ?? 0,
      durationMs: Math.round(performance.now() - started), timedOut: false, wordsSearched: found.data.wordsSearched };
    log.info({ event: "message_candidates_found", companyId, wordCount: candidates.wordsSearched, matchCount: candidates.matchCount,
      candidateCount: candidates.productIds.length, durationMs: candidates.durationMs }, "message_candidates_found");
    return ok(candidates);
  } catch (cause) {
    if (isStatementTimeout(cause)) {
      const durationMs = Math.round(performance.now() - started);
      log.warn({ event: "message_candidates_timeout", companyId, wordCount: words.length, durationMs }, "message_candidates_timeout");
      return ok<MessageCandidates>({ productIds: [], matchCount: 0, durationMs, timedOut: true, wordsSearched: 0 });
    }
    if (!(cause instanceof Prisma.PrismaClientKnownRequestError || cause instanceof Prisma.PrismaClientUnknownRequestError || cause instanceof Prisma.PrismaClientInitializationError)) throw cause;
    return unavailable(cause);
  }
}

/** The one ranking statement; exported so the benchmark can explain exactly what runs. */
export function coverageQuery(companyId: string, words: readonly string[], limits: Pick<TextMatchLimits, "candidates" | "minSimilarity">) {
  return Prisma.sql`
    SELECT p.id, count(*) OVER ()::int AS matches
    FROM (
      SELECT p.id, p.name, sum(m.sim) AS coverage
      FROM "Product" p
      CROSS JOIN LATERAL (SELECT word_similarity(w, p.name) AS sim FROM unnest(${[...words]}::text[]) AS w) m
      WHERE p."companyId" = ${companyId}::uuid AND p.status = 'active' AND m.sim >= ${limits.minSimilarity}
        AND EXISTS (SELECT 1 FROM "ProductVariant" v WHERE v."companyId" = p."companyId" AND v."productId" = p.id AND v.status = 'active')
      GROUP BY p.id, p.name
    ) p
    ORDER BY p.coverage DESC, length(p.name), p.id
    LIMIT ${limits.candidates}`;
}
