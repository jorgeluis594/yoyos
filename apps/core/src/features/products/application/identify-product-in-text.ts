import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { ProductMatcherError, ProductRef, TextCandidate, TextChoice, TextIdentification, TextQuery } from "@core/src/features/products/domain/text-identification";

type PersistenceError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;

export type IdentifyProductInTextDependencies = Readonly<{
  findTextCandidates: (queries: readonly TextQuery[]) => Promise<Result<readonly (readonly TextCandidate[])[], PersistenceError>>;
  chooseTextProduct: (input: Readonly<{ mention: string; priceHint: number | null; candidates: readonly TextCandidate[] }>, signal: AbortSignal)
    => Promise<Result<TextChoice, ProductMatcherError>>;
  minConfidence: number;
  unclearMinProbability: number;
}>;

/** `priceHint` is the amount the buyer stated, with no currency: each candidate is compared in its own currency. */
export type TextMention = Readonly<{ mention: string; priceHint: number | null }>;
export type IdentifyProductInTextError = PersistenceError | ProductMatcherError;

const ref = ({ productId, name }: TextCandidate): ProductRef => ({ productId, name });

function decide(choice: TextChoice, candidates: readonly TextCandidate[], deps: IdentifyProductInTextDependencies): TextIdentification {
  const chosen = candidates.find(({ productId }) => productId === choice.productId);
  if (chosen && choice.confidence >= deps.minConfidence) return { kind: "found", productId: chosen.productId, confidence: choice.confidence };
  const likely = candidates.filter(({ productId }) =>
    choice.probabilities.some((entry) => entry.productId === productId && entry.probability >= deps.unclearMinProbability));
  const [first, second, ...rest] = likely;
  return first && second ? { kind: "not_clear", candidates: [ref(first), ref(second), ...rest.map(ref)] } : { kind: "not_found" };
}

/** One candidates query for all the mentions of a message; the model is asked only for mentions that have candidates. */
export async function identifyProductsInText(mentions: readonly TextMention[], deps: IdentifyProductInTextDependencies, signal: AbortSignal):
  Promise<Result<readonly TextIdentification[], IdentifyProductInTextError>> {
  if (!mentions.length) return ok([]);
  const found = await deps.findTextCandidates(mentions.map(({ mention }) => ({ mention })));
  if (!found.success) return found;
  if (found.data.length !== mentions.length) return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unexpected candidates" });
  const identified = await Promise.all(mentions.map(async (line, index): Promise<Result<TextIdentification, IdentifyProductInTextError>> => {
    const candidates = found.data[index] ?? [];
    if (!candidates.length) return ok({ kind: "not_found" });
    const choice = await deps.chooseTextProduct({ mention: line.mention, priceHint: line.priceHint, candidates }, signal);
    return choice.success ? ok(decide(choice.data, candidates, deps)) : choice;
  }));
  const failed = identified.find((result) => !result.success);
  if (failed && !failed.success) return failed;
  return ok(identified.flatMap((result) => result.success ? [result.data] : []));
}

export async function identifyProductInText(line: TextMention, deps: IdentifyProductInTextDependencies, signal: AbortSignal):
  Promise<Result<TextIdentification, IdentifyProductInTextError>> {
  const identified = await identifyProductsInText([line], deps, signal);
  if (!identified.success) return identified;
  const [only] = identified.data;
  return only ? ok(only) : err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unexpected candidates" });
}

/** Best textual candidate of a mention by similarity, without any model call. */
export async function findTopTextCandidate(mention: string, deps: Pick<IdentifyProductInTextDependencies, "findTextCandidates">):
  Promise<Result<ProductRef | null, PersistenceError>> {
  const found = await deps.findTextCandidates([{ mention }]);
  if (!found.success) return found;
  const [top] = found.data[0] ?? [];
  return ok(top ? ref(top) : null);
}
