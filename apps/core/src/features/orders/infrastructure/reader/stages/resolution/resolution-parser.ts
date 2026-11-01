import { z } from "zod";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { ProductMention, ProductResolution, Quote, ResolvedValue } from "@core/src/features/orders/domain/reader/readings";
import type { ProductForReading } from "@core/src/features/products/domain/reading-product";
import type { ResolutionInput } from "@core/src/features/orders/infrastructure/reader/runtime/stage-version";
import { noneFor, planResolution, type ResolutionPlan } from "@core/src/features/orders/infrastructure/reader/stages/resolution/resolution-plan";

const answerSchema = z.object({
  results: z.array(z.object({
    request: z.string(), kind: z.enum(["chosen", "between", "none"]), names: z.enum(["yes", "no"]).default("yes"), products: z.array(z.string()),
    values: z.array(z.object({ attribute: z.string(), value: z.string(), quote: z.string() })),
    unmatched: z.array(z.string()).default([]),
  })),
});
type Answered = z.infer<typeof answerSchema>["results"][number];

const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Why one mention's answer was refused: a label outside its candidates is the only reason the stage falls back to `none`. */
type Refusal = Readonly<{ reason: "outside_candidates" | "invalid"; message: string }>;

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
  const refuse = (reason: Refusal["reason"], message: string) => err<Refusal>({ reason, message });
  const productIds = answered.products.map((label) => plan.products.get(label)?.productId);
  if (productIds.some((id) => id === undefined || !entry.allowed.includes(id))) return refuse("outside_candidates", `${answered.request} chose a product outside its candidates`);
  const ids = productIds as NonNullable<(typeof productIds)[number]>[];
  if (new Set(ids).size !== ids.length) return refuse("invalid", `${answered.request} repeats a product`);
  if (answered.kind === "none") return ids.length === 0 ? ok(noneFor(entry.mention.request)) : refuse("invalid", `${answered.request} is none but names a product`);
  if (answered.kind === "between") {
    if (ids.length < 2 || ids.length > 4) return refuse("invalid", `${answered.request} must be between two and four products`);
    const { values } = mapValues(answered, entry.mention, answered.products.map((label) => plan.products.get(label)!));
    return ok({ request: entry.mention.request, kind: "between", productIds: ids, values });
  }
  if (ids.length !== 1) return refuse("invalid", `${answered.request} must choose exactly one product`);
  const { values, unmatched } = mapValues(answered, entry.mention, [plan.products.get(answered.products[0]!)!]);
  const pointsOnly = entry.mention.fixed === true && answered.names === "no";
  return ok({ request: entry.mention.request, kind: "chosen", productId: ids[0]!, values, unmatched, ...pointsOnly ? { namesProduct: false as const } : {} });
}

/** The per-mention outcome of an answer, or the reason the answer as a whole is unusable. */
function resolveAnswer(answer: unknown, plan: ResolutionPlan): Result<ReadonlyMap<string, Result<ProductResolution, Refusal>>> {
  const shaped = answerSchema.safeParse(answer);
  if (!shaped.success) return err({ message: "The resolution answer does not match its schema" });
  const byRequest = new Map<string, Result<ProductResolution, Refusal>>();
  const known = new Set(plan.rendered.map(({ mention }) => mention.request as string));
  for (const answered of shaped.data.results) {
    if (!known.has(answered.request)) return err({ message: `The answer resolves ${answered.request}, which is not a mention` });
    if (byRequest.has(answered.request)) return err({ message: `The answer resolves ${answered.request} twice` });
    byRequest.set(answered.request, resolveOne(plan, answered));
  }
  const missing = plan.rendered.find(({ mention }) => !byRequest.has(mention.request));
  return missing ? err({ message: `The answer leaves ${missing.mention.request} unresolved` }) : ok(byRequest);
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
 * After the second invalid answer: every mention whose choice fell outside its candidates is `none`. Any other defect, or an answer that was not
 * JSON of the expected shape, is not repaired (null: the stage fails).
 */
export function resolutionFallback(lastAnswer: unknown, input: ResolutionInput, maxChars: number): readonly ProductResolution[] | null {
  if (lastAnswer === undefined) return null;
  const plan = planResolution(input, maxChars);
  const outcomes = resolveAnswer(lastAnswer, plan);
  if (!outcomes.success) return null;
  const resolved = new Map<string, ProductResolution>();
  for (const [request, outcome] of outcomes.data) {
    if (outcome.success) resolved.set(request, outcome.data);
    else if (outcome.error.reason === "outside_candidates") resolved.set(request, noneFor(plan.rendered.find(({ mention }) => mention.request === request)!.mention.request));
    else return null;
  }
  return withOmitted(plan, input, resolved);
}
