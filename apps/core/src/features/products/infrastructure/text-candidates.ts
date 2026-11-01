import { Prisma } from "@prisma/client";
import { z } from "zod";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { log } from "@core/src/shared/infrastructure/logger";
import { getCompanyId, prisma, withinTransaction } from "@core/src/shared/infrastructure/persistance";
import { isStatementTimeout } from "@core/src/features/products/infrastructure/statement-timeout";
import type { ProductId } from "@core/src/features/products/domain/product";
import { productNameFolds } from "@core/src/features/products/domain/product-name-key";
import { allocateMentionWords, searchedWordCap, type TextMatchLimits } from "@core/src/features/products/domain/message-words";
import type { MessageCandidates } from "@core/src/features/products/application/find-message-candidates";
import type { MentionCandidates, MentionMatches } from "@core/src/features/products/application/find-mention-candidates";

type PersistenceError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;

const unavailable = (cause: unknown) => {
  log.error({ event: "unable_to_find_message_candidates", companyId: getCompanyId(), errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "unable_to_find_message_candidates");
  return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to read catalog" });
};

const isPersistenceFailure = (cause: unknown) => cause instanceof Prisma.PrismaClientKnownRequestError || cause instanceof Prisma.PrismaClientUnknownRequestError
  || cause instanceof Prisma.PrismaClientInitializationError;

const coverageRowSchema = z.object({ mention: z.coerce.number().int().min(0), id: z.uuid(), sellable: z.boolean(), matches: z.coerce.number().int().min(0) });
type CoverageRow = z.infer<typeof coverageRowSchema>;

const idsOf = (rows: readonly CoverageRow[], sellable: boolean) => rows.filter((row) => row.sellable === sellable).map(({ id }) => id as ProductId);

/**
 * The company's products ranked by coverage, the sum of `word_similarity` over the words their name matches (design §5.2):
 * the sellable ones (an active variant) and, apart, the ones with no active variant, which the reader gets as not sellable.
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
    const candidates: MessageCandidates = { productIds: idsOf(parsed.data, true), unavailableProductIds: idsOf(parsed.data, false), matchCount: parsed.data[0]?.matches ?? 0,
      durationMs: Math.round(performance.now() - started), timedOut: false, wordsSearched: found.data.wordsSearched };
    log.info({ event: "message_candidates_found", companyId, wordCount: candidates.wordsSearched, matchCount: candidates.matchCount,
      candidateCount: candidates.productIds.length, unavailableCount: candidates.unavailableProductIds.length, durationMs: candidates.durationMs }, "message_candidates_found");
    return ok(candidates);
  } catch (cause) {
    if (isStatementTimeout(cause)) {
      const durationMs = Math.round(performance.now() - started);
      log.warn({ event: "message_candidates_timeout", companyId, wordCount: words.length, durationMs }, "message_candidates_timeout");
      return ok<MessageCandidates>({ productIds: [], unavailableProductIds: [], matchCount: 0, durationMs, timedOut: true, wordsSearched: 0 });
    }
    if (!isPersistenceFailure(cause)) throw cause;
    return unavailable(cause);
  }
}

/** The one ranking statement of a text; exported so the benchmark can explain exactly what runs. At most `candidates + unavailableCandidates` rows leave it. */
export function coverageQuery(companyId: string, words: readonly string[], limits: Pick<TextMatchLimits, "candidates" | "unavailableCandidates" | "minSimilarity">) {
  return mentionCoverageQuery(companyId, words.map(() => 0), words, limits);
}

/**
 * The ranking of all the mentions of a message in one statement: `mentions[i]` is the mention that searches `words[i]`. Per mention it keeps the
 * top `candidates` sellable rows and the top `unavailableCandidates` not-sellable rows by the same coverage. A not-sellable row is returned
 * only when the company has a product with an active variant, and never when a matched sellable product of the mention has the same name key
 * (lower case and the accent folds of `productNameFolds`). `matches` counts the mention's sellable matches only.
 */
export function mentionCoverageQuery(companyId: string, mentions: readonly number[], words: readonly string[], limits: Pick<TextMatchLimits, "candidates" | "unavailableCandidates" | "minSimilarity">) {
  return Prisma.sql`
    WITH w AS (SELECT t.mention, t.word FROM unnest(${[...mentions]}::int[], ${[...words]}::text[]) AS t(mention, word)),
    matched AS (
      SELECT m.mention, p.id, p.name, sum(m.sim) AS coverage,
             EXISTS (SELECT 1 FROM "ProductVariant" v WHERE v."companyId" = p."companyId" AND v."productId" = p.id AND v.status = 'active') AS sellable
      FROM "Product" p
      CROSS JOIN LATERAL (SELECT w.mention, word_similarity(w.word, p.name) AS sim FROM w) m
      WHERE p."companyId" = ${companyId}::uuid AND p.status = 'active' AND m.sim >= ${limits.minSimilarity}
      GROUP BY m.mention, p."companyId", p.id, p.name
    ),
    keyed AS (
      SELECT m.*, bool_or(m.sellable) OVER (PARTITION BY m.mention, translate(lower(m.name), ${productNameFolds.from}, ${productNameFolds.to})) AS "sellableTwin"
      FROM matched m
    ),
    ranked AS (
      SELECT mention, id, sellable, row_number() OVER (PARTITION BY mention, sellable ORDER BY coverage DESC, length(name), id) AS rank,
             (count(*) FILTER (WHERE sellable) OVER (PARTITION BY mention))::int AS matches
      FROM keyed
      WHERE sellable OR (NOT "sellableTwin"
        AND EXISTS (SELECT 1 FROM "Product" a WHERE a."companyId" = ${companyId}::uuid
          AND EXISTS (SELECT 1 FROM "ProductVariant" v WHERE v."companyId" = a."companyId" AND v."productId" = a.id AND v.status = 'active')))
    )
    SELECT mention, id, sellable, matches FROM ranked
    WHERE (sellable AND rank <= ${limits.candidates}) OR (NOT sellable AND rank <= ${limits.unavailableCandidates})
    ORDER BY mention, sellable DESC, rank`;
}

/** Limits of a message's mention search; `pairBudget` is shared by all its mentions, never per mention. */
export type MentionSearchLimits = TextMatchLimits & Readonly<{ timeoutMs: number }>;

const timedOutResult = (mentions: number, started: number): MentionCandidates =>
  ({ mentions: Array.from({ length: mentions }, () => ({ productIds: [], unavailableProductIds: [], matchCount: 0, wordsSearched: 0 })), durationMs: Math.round(performance.now() - started), timedOut: true });

/** Waiting for a connection past `maxWait` is Prisma's P2028; like a statement timeout, it is a result, not an error. */
const isTransactionStartTimeout = (cause: unknown) => cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2028" && /start a transaction/i.test(cause.message);

/**
 * Every mention of a message in one transaction, one connection and one ranking statement (design §5.1 step 6). The words come from
 * `allocateMentionWords`, so words × active products stays within the pair budget except at the floor. The whole call, the wait for a
 * connection included, has `limits.timeoutMs`: the transaction waits at most that long for a connection and each statement gets what is left.
 */
export async function searchMentionsByCoverage(mentions: readonly string[], limits: MentionSearchLimits): Promise<Result<MentionCandidates, PersistenceError>> {
  const companyId = getCompanyId();
  const started = performance.now();
  const remainingMs = () => Math.floor(limits.timeoutMs - (performance.now() - started));
  try {
    const found = await withinTransaction(async () => {
      const limitStatement = async () => {
        const left = remainingMs();
        if (left <= 0) return false;
        await prisma.$queryRaw`SELECT set_config('statement_timeout', ${`${left}ms`}, true), set_config('jit', 'off', true)`;
        return true;
      };
      if (!await limitStatement()) return ok({ kind: "timed_out" as const });
      const [{ total }] = await prisma.$queryRaw<{ total: number }[]>(Prisma.sql`
        SELECT count(*)::int AS total FROM "Product" WHERE "companyId" = ${companyId}::uuid AND status = 'active'`);
      const searched = allocateMentionWords(mentions, total, limits);
      const pairs = searched.flatMap((words, mention) => words.map((word) => ({ mention, word })));
      if (!pairs.length) return ok({ kind: "searched" as const, searched, rows: [] as unknown[] });
      if (!await limitStatement()) return ok({ kind: "timed_out" as const });
      const rows = await prisma.$queryRaw<unknown[]>(mentionCoverageQuery(companyId, pairs.map(({ mention }) => mention), pairs.map(({ word }) => word), limits));
      return ok({ kind: "searched" as const, searched, rows });
    }, { maxWait: limits.timeoutMs });
    if (found.data.kind === "timed_out") {
      log.warn({ event: "mention_candidates_timeout", companyId, mentionCount: mentions.length, durationMs: Math.round(performance.now() - started) }, "mention_candidates_timeout");
      return ok(timedOutResult(mentions.length, started));
    }
    const parsed = z.array(coverageRowSchema).safeParse(found.data.rows);
    if (!parsed.success) return unavailable(parsed.error);
    const result: MentionCandidates = { mentions: found.data.searched.map((words, mention): MentionMatches => {
      const rows = parsed.data.filter((row) => row.mention === mention);
      return { productIds: idsOf(rows, true), unavailableProductIds: idsOf(rows, false), matchCount: rows[0]?.matches ?? 0, wordsSearched: words.length };
    }), durationMs: Math.round(performance.now() - started), timedOut: false };
    log.info({ event: "mention_candidates_found", companyId, mentionCount: mentions.length, wordCount: found.data.searched.reduce((sum, words) => sum + words.length, 0),
      candidateCount: result.mentions.reduce((sum, { productIds }) => sum + productIds.length, 0), unavailableCount: result.mentions.reduce((sum, { unavailableProductIds }) => sum + unavailableProductIds.length, 0),
      durationMs: result.durationMs }, "mention_candidates_found");
    return ok(result);
  } catch (cause) {
    if (isStatementTimeout(cause) || isTransactionStartTimeout(cause)) {
      log.warn({ event: "mention_candidates_timeout", companyId, mentionCount: mentions.length, durationMs: Math.round(performance.now() - started) }, "mention_candidates_timeout");
      return ok(timedOutResult(mentions.length, started));
    }
    if (!isPersistenceFailure(cause)) throw cause;
    return unavailable(cause);
  }
}
