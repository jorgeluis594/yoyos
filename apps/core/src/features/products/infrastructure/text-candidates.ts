import { Prisma } from "@prisma/client";
import { z } from "zod";
import { err, ok } from "@shared/functional";
import { log } from "@core/src/shared/infrastructure/logger";
import { getCompanyId, prisma, withinTransaction } from "@core/src/shared/infrastructure/persistance";
import { isStatementTimeout } from "@core/src/features/products/infrastructure/statement-timeout";
import type { ProductId } from "@core/src/features/products/domain/product";
import { searchedWordCap, type TextMatchLimits } from "@core/src/features/products/domain/message-words";
import type { MessageCandidates } from "@core/src/features/products/application/find-message-candidates";

const unavailable = (cause: unknown) => {
  log.error({ event: "unable_to_find_message_candidates", companyId: getCompanyId(), errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "unable_to_find_message_candidates");
  return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to read catalog" });
};

const coverageRowSchema = z.object({ id: z.uuid(), matches: z.coerce.number().int().min(1) });

/**
 * Offered products (active, not hidden) with a sellable variant ranked by coverage, the sum of `word_similarity` over the words their name matches (design §5.3).
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
        SELECT count(*)::int AS total FROM "Product" WHERE "companyId" = ${companyId}::uuid AND status = 'active' AND NOT hidden`);
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
      WHERE p."companyId" = ${companyId}::uuid AND p.status = 'active' AND NOT p.hidden AND m.sim >= ${limits.minSimilarity}
        AND EXISTS (SELECT 1 FROM "ProductVariant" v WHERE v."companyId" = p."companyId" AND v."productId" = p.id AND v.status = 'active')
      GROUP BY p.id, p.name
    ) p
    ORDER BY p.coverage DESC, length(p.name), p.id
    LIMIT ${limits.candidates}`;
}
