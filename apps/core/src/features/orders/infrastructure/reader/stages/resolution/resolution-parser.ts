import { z } from "zod";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { ProductResolution, Quote } from "@core/src/features/orders/domain/reader/readings";
import type { ResolutionInput } from "@core/src/features/orders/infrastructure/reader/runtime/stage-version";
import { noneFor, planResolution, type ResolutionPlan } from "@core/src/features/orders/infrastructure/reader/stages/resolution/resolution-plan";

const answerSchema = z.object({
  results: z.array(z.object({
    request: z.string(), kind: z.enum(["chosen", "between", "none"]), products: z.array(z.string()),
    values: z.array(z.object({ attribute: z.string(), value: z.string(), quote: z.string() })),
  })),
});
type Answered = z.infer<typeof answerSchema>["results"][number];

const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Why one mention's answer was refused: a label outside its candidates is the only reason the stage falls back to `none`. */
type Refusal = Readonly<{ reason: "outside_candidates" | "invalid"; message: string }>;

function resolveOne(plan: ResolutionPlan, answered: Answered): Result<ProductResolution, Refusal> {
  const entry = plan.rendered.find(({ mention }) => mention.request === answered.request)!;
  const refuse = (reason: Refusal["reason"], message: string) => err<Refusal>({ reason, message });
  const productIds = answered.products.map((label) => plan.products.get(label)?.productId);
  if (productIds.some((id) => id === undefined || !entry.allowed.includes(id))) return refuse("outside_candidates", `${answered.request} chose a product outside its candidates`);
  const ids = productIds as NonNullable<(typeof productIds)[number]>[];
  if (new Set(ids).size !== ids.length) return refuse("invalid", `${answered.request} repeats a product`);
  if (answered.kind === "none") return ids.length === 0 && answered.values.length === 0 ? ok(noneFor(entry.mention.request)) : refuse("invalid", `${answered.request} is none but carries data`);
  if (answered.kind === "between") {
    return ids.length >= 2 && ids.length <= 4 && answered.values.length === 0 ? ok({ request: entry.mention.request, kind: "between", productIds: ids }) : refuse("invalid", `${answered.request} must be between two and four products`);
  }
  if (ids.length !== 1) return refuse("invalid", `${answered.request} must choose exactly one product`);
  const product = plan.products.get(answered.products[0]!)!;
  const values: Extract<ProductResolution, { kind: "chosen" }>["values"][number][] = [];
  for (const { attribute, value, quote } of answered.values) {
    const catalogAttribute = product.attributes.find(({ name }) => fold(name) === fold(attribute));
    const catalogValue = catalogAttribute?.values.find((candidate) => fold(candidate) === fold(value));
    const mentioned = entry.mention.values.find(({ valueWords }) => fold(valueWords.text) === fold(quote));
    if (!catalogAttribute || catalogValue === undefined || !mentioned) return refuse("invalid", `${answered.request} maps a value that is not in the catalog or the mention`);
    const words: Quote = mentioned.valueWords;
    values.push({ attribute: catalogAttribute.name, value: catalogValue, quote: words });
  }
  return ok({ request: entry.mention.request, kind: "chosen", productId: ids[0]!, values });
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
