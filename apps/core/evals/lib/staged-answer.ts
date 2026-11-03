import type { DecisionKind, IntentKind } from "@core/evals/cases/schema";
import { decisionFromEvidence, fold, type ExpectedStages, type StageAnswer } from "@core/evals/lib/stage-facts";
import type { MessageTrace, TraceShadow, TraceStage } from "@core/src/features/orders/domain/reader/trace";
import type { ExtractedRequest } from "@core/src/features/orders/domain/reader/readings";

/**
 * What the reading trace of the staged `applyChatMessage` says, as the `StageAnswer` that `scoreStages` compares with the case (technical design 6.3).
 * Pure: the trace is the one `buildMessageTrace` made, captured where the eval path would have stored it. The legacy baseline reads the legacy
 * reader's answer kind and cost instead (`legacyAnswerOf`).
 */

type StageOutput<Stage extends TraceStage["call"]["stage"]> = Extract<NonNullable<TraceStage["output"]>, { stage: Stage }>;

function primaryOutput<Stage extends TraceStage["call"]["stage"]>(trace: MessageTrace | null, stage: Stage): StageOutput<Stage> | null {
  const found = trace?.stages.find(({ call, output }) => call.stage === stage && call.reading === "primary" && output?.stage === stage);
  return (found?.output as StageOutput<Stage> | null | undefined) ?? null;
}

/** Words that join a value to the product (in «en L», «a negro»): never the name of an attribute. */
const connectors: ReadonlySet<string> = new Set(["en", "a", "de", "del", "la", "el", "los", "las", "un", "una", "con", "para", "por", "y"]);

/**
 * The fields of the message under the names the case gives them: `quantity`, `price`, and the catalog attribute of each value. The values are the
 * catalog's (the resolution stage's `values`, e.g. Color=Negro for «negros»), not the buyer's words. A request with no resolved values falls back to its
 * words, under the case's own spelling when they fold to a stated value. A request that adds an item with no quantity adds one.
 * A value word the resolution did not map to a catalog value (listed in `unmatched` or silently dropped, whether it chose a product or stayed `between`
 * several) stays in the answer as a word of its own: an extra field, so the comparison fails unless the label states that very word.
 * `between` tells that some request was left undecided between products, which the strict reading of the fields never passes.
 */
function fieldsOf(extraction: StageOutput<"extraction">, resolution: StageOutput<"resolution"> | null, expected: Readonly<Record<string, string>> | null): Readonly<{ fields: Readonly<Record<string, string>>; between: boolean }> {
  const fields: Record<string, string> = {};
  let between = false;
  const addWord = ({ attributeWords, valueWords }: ExtractedRequest["values"][number]) => {
    const attribute = attributeWords !== null && !connectors.has(fold(attributeWords.text)) ? attributeWords : null;
    const stated = Object.entries(expected ?? {}).find(([name, value]) => fold(value) === fold(valueWords.text) && (attribute === null || fold(attribute.text) === fold(name)));
    if (stated) fields[stated[0]] = stated[1];
    else fields[attribute?.text ?? valueWords.text] = valueWords.text;
  };
  for (const request of extraction.requests) {
    if (request.quantity) fields.quantity = String(request.quantity.value);
    else if (request.kind === "add") fields.quantity = "1";
    if (request.price) fields.price = String(request.price.amount);
    const resolved = resolution?.resolutions.find((candidate) => candidate.request === request.request);
    if (resolved?.kind === "between") between = true;
    const values = resolved && resolved.kind !== "none" ? resolved.values ?? [] : [];
    if (values.length === 0) {
      request.values.forEach(addWord);
      continue;
    }
    for (const { attribute, value } of values) fields[attribute] = value;
    const covered = new Set(values.map(({ quote }) => fold(quote.text)));
    const left = request.values.filter(({ valueWords }) => !covered.has(fold(valueWords.text)));
    left.forEach(addWord);
    const unmatched = resolved?.kind === "chosen" ? resolved.unmatched ?? [] : [];
    for (const { text } of unmatched) {
      if (!covered.has(fold(text)) && !left.some(({ valueWords }) => fold(valueWords.text) === fold(text))) addWord({ attributeWords: null, valueWords: { source: "current", text } });
    }
  }
  return { fields, between };
}

function decisionKindOf(trace: MessageTrace | null, notice: string | null, outcomes: readonly string[]): DecisionKind {
  return decisionFromEvidence({ notice, outcomes, decisions: trace?.decisions.map(({ decision }) => decision) ?? [] });
}

function stageCostsOf(trace: MessageTrace | null): Readonly<Record<string, number>> {
  const costs: Record<string, number> = {};
  for (const { call } of trace?.stages ?? []) {
    const name = call.reading === "primary" ? call.stage : `confirming_${call.stage}`;
    costs[name] = (costs[name] ?? 0) + (call.costUsd ?? 0);
  }
  if (trace?.photo && trace.photo.method !== "none") costs[`photo_${trace.photo.method}`] = trace.photo.costUsd ?? 0;
  return costs;
}

const intentFromOutcomes = (outcomes: readonly string[]): IntentKind => outcomes.length > 0 && outcomes.every((kind) => kind === "no_intent" || kind === "questions") ? "no_intent" : "requests";

export type StagedAnswerInput = Readonly<{
  /** The trace the run built; null when no reading ran (a text too long, a photo with no caption). */
  trace: MessageTrace | null;
  expected: ExpectedStages;
  outcomes: readonly string[];
  notice: string | null;
  /** The order after the message equals the expected one; null when the case states none. */
  orderMatches: boolean | null;
  /** The lines the message changed with their marks, read from its change rows; absent when they were not read. */
  changedLines?: StageAnswer["changedLines"];
  /** Wall time of the scored attempt: from the start of the reading to the decision, with no queue wait in an eval. */
  latencyMs: number;
  productKeyOf: (productId: string) => string | null;
}>;

export function stagedAnswerOf(input: StagedAnswerInput): StageAnswer {
  const { trace, expected, outcomes, notice } = input;
  const intent = primaryOutput(trace, "intent");
  const extraction = primaryOutput(trace, "extraction");
  const decisions = trace?.decisions ?? [];
  const productId = decisions.find(({ action }) => action.productId !== null)?.action.productId
    ?? primaryOutput(trace, "resolution")?.resolutions.find((resolution) => resolution.kind === "chosen")?.productId ?? null;
  const decision = decisionKindOf(trace, notice, outcomes);
  const kinds = decisions.map(({ decision: kind }) => kind);
  const read = extraction ? fieldsOf(extraction, primaryOutput(trace, "resolution"), expected.fields) : null;
  return {
    intent: intent?.kind ?? intentFromOutcomes(outcomes),
    fields: read?.fields ?? null,
    ...(read?.between ? { fieldsBetween: true } : {}),
    product: productId === null ? null : input.productKeyOf(productId),
    decision,
    // The change rows are the truth when read: a completion of a pending changes the order and its decision is `pending`, and a mark can be inherited.
    changeApplied: kinds.some((kind) => kind === "applied" || kind === "doubtful") || (input.changedLines === undefined ? kinds.length === 0 && decision === "applied" : input.changedLines.length > 0),
    marked: kinds.includes("doubtful") || (input.changedLines?.some(({ marked }) => marked) ?? false),
    ...(input.changedLines ? { changedLines: input.changedLines } : {}),
    point: kinds.includes("pending"),
    noticed: notice !== null,
    changedNotice: notice === "order_changed_after_link",
    orderMatches: input.orderMatches,
    readingMs: input.latencyMs, queuedMs: 0,
    stageCostsUsd: stageCostsOf(trace),
  };
}

export type LegacyAnswerInput = Readonly<{ shadow: TraceShadow | null; expected: ExpectedStages; latencyMs: number }>;

/**
 * The legacy baseline (E1). The legacy reader can no longer apply a message, so it is read as the shadow reads it: its answer kind gives the intent, a
 * request answered with actions counts as a change, and the single call's cost is the message's cost. Fields, product and decision are not stated, and a
 * failed reading is an unsure intent that left nothing.
 */
export function legacyAnswerOf(input: LegacyAnswerInput): StageAnswer {
  const { shadow } = input;
  const intent: IntentKind = shadow === null ? "unsure" : shadow.answer === "actions" || shadow.answer === "fixed" ? "requests" : shadow.answer === "no_intent" ? "no_intent" : "unsure";
  return {
    intent, fields: null, product: null, decision: null, intentOnly: true,
    changeApplied: shadow?.answer === "actions", marked: false, point: false, noticed: false, changedNotice: false, orderMatches: null,
    readingMs: input.latencyMs, queuedMs: 0,
    stageCostsUsd: shadow?.costUsd != null ? { legacy: shadow.costUsd } : {},
  };
}
