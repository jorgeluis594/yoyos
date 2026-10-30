import { ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { ProductId } from "@core/src/features/products/domain/product";
import { searchedWords } from "@core/src/features/products/domain/message-words";

type PersistenceError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;

export type MessageCandidates = Readonly<{
  productIds: readonly ProductId[];
  /** Products that matched at least one word, before the cut to the top candidates. */
  matchCount: number;
  durationMs: number;
  /** The statement timeout is not an error: the message is read without candidates. */
  timedOut: boolean;
  /** Words that fit the pair budget of the company's catalog. */
  wordsSearched: number;
}>;

export type FindMessageCandidatesDependencies = Readonly<{
  /** Company products ranked by coverage of the words, longest words first; applies the word cap itself. */
  searchByCoverage: (words: readonly string[]) => Promise<Result<MessageCandidates, PersistenceError>>;
}>;

/** Up to the top candidates whose name matches the words of a message, with no model call. A message without words has no candidates. */
export async function findMessageCandidates(text: string, deps: FindMessageCandidatesDependencies): Promise<Result<MessageCandidates, PersistenceError>> {
  const words = searchedWords(text);
  if (!words.length) return ok({ productIds: [], matchCount: 0, durationMs: 0, timedOut: false, wordsSearched: 0 });
  return deps.searchByCoverage(words);
}
