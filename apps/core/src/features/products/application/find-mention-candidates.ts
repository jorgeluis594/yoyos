import { ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { ProductId } from "@core/src/features/products/domain/product";

type PersistenceError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;

/** What one mention found; a mention with no `wordsSearched` was not searched (the pair budget gave it no word). */
export type MentionMatches = Readonly<{
  /** Sellable products (an active variant), best coverage first. */
  productIds: readonly ProductId[];
  /** Products with no active variant, apart from the sellable ones. */
  unavailableProductIds: readonly ProductId[];
  /** Sellable products that matched at least one word, before the cut. */
  matchCount: number;
  wordsSearched: number;
}>;

export type MentionCandidates = Readonly<{
  /** One entry per mention, in the order given. */
  mentions: readonly MentionMatches[];
  durationMs: number;
  /** Running out of the budget (waiting for a connection or the statement) is a result, not an error: every mention is then empty. */
  timedOut: boolean;
}>;

export type FindMentionCandidatesDependencies = Readonly<{
  /** One transaction and one ranking statement for all the mentions; allocates the words from the catalog size itself. */
  searchMentions: (mentions: readonly string[]) => Promise<Result<MentionCandidates, PersistenceError>>;
}>;

export const noMentionMatches: MentionMatches = { productIds: [], unavailableProductIds: [], matchCount: 0, wordsSearched: 0 };

/** The candidates of every mention of a message, searched together with no model call. No mentions means no query. */
export async function findMentionCandidates(mentions: readonly string[], deps: FindMentionCandidatesDependencies): Promise<Result<MentionCandidates, PersistenceError>> {
  if (!mentions.length) return ok({ mentions: [], durationMs: 0, timedOut: false });
  return deps.searchMentions(mentions);
}
