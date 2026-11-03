/** Limits of the message candidate search (technical design §5.3). */
export type TextMatchLimits = Readonly<{
  /** Sellable products returned. */
  candidates: number;
  /** Products with no active variant returned, beside a sellable product of the company. */
  unavailableCandidates: number;
  /** A (word, name) pair matches from this `word_similarity`. */
  minSimilarity: number;
  /** Words × company products the statement may compare. */
  pairBudget: number;
  minWords: number;
  maxWords: number;
}>;

/** The pair budget is 25,000, not the design's 40,000: measured as core_app with forced RLS, a pair costs about 4.5 µs on the dev host, not 3 µs. T10 may change these by measurement. */
export const defaultTextMatchLimits: TextMatchLimits = { candidates: 8, unavailableCandidates: 2, minSimilarity: 0.3, pairBudget: 25_000, minWords: 3, maxWords: 30 };

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

/** The pair budget of one message's mention search: one statement for all its mentions (technical design §5.1 step 6). */
export const defaultMentionPairBudget = 100_000;

/**
 * The words each mention is searched with, in mention order. The statement's cost is words × active products, so the total of words is
 * `clamp(floor(pairBudget / activeProducts), minWords, maxWords × mentions)` and is handed out round-robin: on each turn a mention gets its
 * longest word not yet searched, no mention gets more than `maxWords`, and every mention gets one word before any gets a second.
 * A mention left with no words is not searched (the floor of `minWords` wins over the budget).
 */
export function allocateMentionWords(mentions: readonly string[], activeProducts: number, limits: Pick<TextMatchLimits, "pairBudget" | "minWords" | "maxWords">): readonly (readonly string[])[] {
  const available = mentions.map(searchedWords);
  let remaining = Math.min(Math.max(limits.minWords, Math.floor(limits.pairBudget / Math.max(activeProducts, 1))), limits.maxWords * mentions.length);
  const taken = available.map(() => 0);
  let progressed = true;
  while (remaining > 0 && progressed) {
    progressed = false;
    for (let index = 0; index < available.length && remaining > 0; index += 1) {
      if (taken[index]! >= Math.min(available[index]!.length, limits.maxWords)) continue;
      taken[index]! += 1;
      remaining -= 1;
      progressed = true;
    }
  }
  return available.map((words, index) => words.slice(0, taken[index]));
}
