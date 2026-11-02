import { z } from "zod";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { ProductMention, ProductResolution, Quote, ResolvedValue } from "@core/src/features/orders/domain/reader/readings";
import type { ProductForReading } from "@core/src/features/products/domain/reading-product";
import type { ResolutionInput } from "@core/src/features/orders/infrastructure/reader/runtime/stage-version";
import { noneFor, planResolution, type ResolutionPlan } from "@core/src/features/orders/infrastructure/reader/stages/resolution/resolution-plan";

/** Each result is checked on its own: one that does not fit is the same as one the model left out (the mention resolves to none), it never fails the answer. */
const answerSchema = z.object({ results: z.array(z.unknown()) });
const resultSchema = z.object({
  request: z.string(), kind: z.enum(["chosen", "between", "none"]), names: z.enum(["yes", "no"]).catch("no"), products: z.array(z.string()).catch([]),
  values: z.array(z.object({ attribute: z.string(), value: z.string(), quote: z.string() })).catch([]),
  unmatched: z.array(z.string()).catch([]),
});
type Answered = z.infer<typeof resultSchema>;

const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Why one mention's answer was refused: a label outside its candidates, which the stage retries and then falls back to `none`. */
type Refusal = Readonly<{ reason: "outside_candidates"; message: string }>;

/** The buyer's words a quote points to: a value of the mention, or words inside the mention's own words (a value the extraction left in the name). Null when it is neither. */
function quoteOf(mention: ProductMention, quote: string): Quote | null {
  const folded = fold(quote);
  if (folded === "") return null;
  const value = mention.values.find(({ valueWords }) => fold(valueWords.text) === folded);
  if (value) return value.valueWords;
  return !mention.valuesOnly && fold(mention.words.text).includes(folded) ? { ...mention.words, text: quote.trim() } : null;
}

/**
 * The values of an answer for the products it chose: a value that is not in the catalog, or whose quote is not the buyer's, is dropped, and the buyer's
 * words that fit nothing are `unmatched`. Only the products' common values are kept for several products (none unmatched).
 */
function mapValues(answered: Answered, mention: ProductMention, products: readonly ProductForReading[]): Readonly<{ values: ResolvedValue[]; unmatched: Quote[] }> {
  const values: ResolvedValue[] = [];
  const unmatched: Quote[] = [];
  for (const { attribute, value, quote } of answered.values) {
    const words = quoteOf(mention, quote);
    if (!words) continue;
    const found = products.map((product) => {
      const catalogAttribute = product.attributes.find(({ name }) => fold(name) === fold(attribute));
      const catalogValue = catalogAttribute?.values.find((candidate) => fold(candidate) === fold(value));
      return catalogAttribute && catalogValue !== undefined ? { attribute: catalogAttribute.name, value: catalogValue } : null;
    });
    const [first] = found;
    if (first && found.every((entry) => entry !== null && entry.attribute === first.attribute && entry.value === first.value)) values.push({ ...first, quote: words });
    else if (products.length === 1) unmatched.push(words);
  }
  if (products.length === 1) {
    for (const quote of answered.unmatched) {
      const words = quoteOf(mention, quote);
      if (words) unmatched.push(words);
    }
  }
  const left = unmatched.filter((words, index) => !values.some((entry) => fold(entry.quote.text) === fold(words.text)) && unmatched.findIndex((other) => fold(other.text) === fold(words.text)) === index);
  return { values, unmatched: left };
}

function resolveOne(plan: ResolutionPlan, answered: Answered): Result<ProductResolution, Refusal> {
  const entry = plan.rendered.find(({ mention }) => mention.request === answered.request)!;
  const productIds = answered.products.map((label) => plan.products.get(label)?.productId);
  if (productIds.some((id) => id === undefined || !entry.allowed.includes(id))) return err<Refusal>({ reason: "outside_candidates", message: `${answered.request} chose a product outside its candidates` });
  // A defect of the shape (a repeated product, none with a product, a count that does not fit the kind) is no choice: the mention resolves to none, which the checks
  // answer with a doubt, and never to the product the model may have meant.
  const labels = answered.products.filter((label, index) => answered.products.indexOf(label) === index);
  const distinct = labels.map((label) => plan.products.get(label)!);
  const none = ok(noneFor(entry.mention.request));
  if (answered.kind === "none" || distinct.length === 0 || distinct.length > 4) return none;
  const pointsOnly = entry.mention.fixed === true && answered.names === "no";
  if (answered.kind === "between" || distinct.length > 1) {
    if (distinct.length < 2) return none;
    const { values } = mapValues(answered, entry.mention, distinct);
    return ok({ request: entry.mention.request, kind: "between", productIds: distinct.map(({ productId }) => productId), values, ...pointsOnly ? { namesProduct: false as const } : {} });
  }
  const { values, unmatched } = mapValues(answered, entry.mention, distinct);
  return ok({ request: entry.mention.request, kind: "chosen", productId: distinct[0]!.productId, values, unmatched, ...pointsOnly ? { namesProduct: false as const } : {} });
}

/** The per-mention outcome of an answer, or the reason the answer as a whole is unusable. */
function resolveAnswer(answer: unknown, plan: ResolutionPlan): Result<ReadonlyMap<string, Result<ProductResolution, Refusal>>> {
  const shaped = answerSchema.safeParse(answer);
  if (!shaped.success) return err({ message: "The resolution answer does not match its schema" });
  const byRequest = new Map<string, Result<ProductResolution, Refusal>>();
  const known = new Set(plan.rendered.map(({ mention }) => mention.request as string));
  const twice = new Set<string>();
  for (const entry of shaped.data.results) {
    const answered = resultSchema.safeParse(entry);
    // An entry that does not fit, or that resolves something that is no mention, says nothing; a mention answered twice has no one answer. Both leave the mention to none.
    if (!answered.success || !known.has(answered.data.request)) continue;
    if (byRequest.has(answered.data.request)) twice.add(answered.data.request);
    else byRequest.set(answered.data.request, resolveOne(plan, answered.data));
  }
  for (const request of twice) byRequest.delete(request);
  return ok(byRequest);
}

function withOmitted(plan: ResolutionPlan, input: ResolutionInput, resolved: ReadonlyMap<string, ProductResolution>): readonly ProductResolution[] {
  return input.mentions.map(({ request }) => resolved.get(request) ?? noneFor(request));
}

/** Parses an answer into one resolution per mention. A mention that was not rendered resolves to `none`. */
export function parseResolution(answer: unknown, input: ResolutionInput, maxChars: number): Result<readonly ProductResolution[]> {
  const plan = planResolution(input, maxChars);
  const outcomes = resolveAnswer(answer, plan);
  if (!outcomes.success) return outcomes;
  const resolved = new Map<string, ProductResolution>();
  for (const [request, outcome] of outcomes.data) {
    if (!outcome.success) return err({ message: outcome.error.message });
    resolved.set(request, outcome.data);
  }
  return ok(withOmitted(plan, input, resolved));
}

/**
 * After the second invalid answer: every mention whose choice fell outside its candidates is `none`. An answer that was not
 * JSON of the expected shape is not repaired (null: the stage fails).
 */
export function resolutionFallback(lastAnswer: unknown, input: ResolutionInput, maxChars: number): readonly ProductResolution[] | null {
  if (lastAnswer === undefined) return null;
  const plan = planResolution(input, maxChars);
  const outcomes = resolveAnswer(lastAnswer, plan);
  if (!outcomes.success) return null;
  const resolved = new Map<string, ProductResolution>();
  for (const [request, outcome] of outcomes.data) {
    if (outcome.success) resolved.set(request, outcome.data);
    else resolved.set(request, noneFor(plan.rendered.find(({ mention }) => mention.request === request)!.mention.request));
  }
  return withOmitted(plan, input, resolved);
}
