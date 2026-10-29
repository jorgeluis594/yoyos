/** Initial values of the message candidate search (technical design §5.3); T10 may change them by measurement. */
export type TextMatchLimits = Readonly<{
  /** Products returned. */
  candidates: number;
  /** A (word, name) pair matches from this `word_similarity`. */
  minSimilarity: number;
  /** Words × company products the statement may compare. */
  pairBudget: number;
  minWords: number;
  maxWords: number;
}>;

export const defaultTextMatchLimits: TextMatchLimits = { candidates: 8, minSimilarity: 0.3, pairBudget: 40_000, minWords: 3, maxWords: 30 };

const minWordLength = 3;

/**
 * The distinct words of a message, longest first, ties by first appearance.
 * Character-level work only (no accents, no case, split on non-alphanumerics), never morphology or word lists.
 */
export function searchedWords(text: string): readonly string[] {
  const words = text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().split(/[^\p{L}\p{N}]+/u)
    .filter((word) => [...word].length >= minWordLength);
  return [...new Set(words)].sort((left, right) => [...right].length - [...left].length);
}

/** How many of the searched words fit the pair budget for a catalog of this size. */
export function searchedWordCap(companyProducts: number, limits: TextMatchLimits): number {
  const affordable = Math.floor(limits.pairBudget / Math.max(companyProducts, 1));
  return Math.min(limits.maxWords, Math.max(limits.minWords, affordable));
}
