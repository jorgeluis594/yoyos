import type { DecisionKind, IntentKind } from "@core/evals/cases/schema";
import { decisionOf, type ExpectedStages, type StageAnswer } from "@core/evals/lib/stage-facts";
import type { MessageTrace, TraceShadow, TraceStage } from "@core/src/features/orders/domain/reader/trace";

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

const fold = (text: string): string => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

/** The extracted words under the name the case gives them: `quantity`, `price`, or the attribute the buyer named (the case's own spelling when the words fold to it). */
function fieldsOf(extraction: StageOutput<"extraction">, expected: Readonly<Record<string, string>> | null): Readonly<Record<string, string>> {
  const fields: Record<string, string> = {};
  for (const request of extraction.requests) {
    if (request.quantity) fields.quantity = String(request.quantity.value);
    if (request.price) fields.price = String(request.price.amount);
    for (const { attributeWords, valueWords } of request.values) {
      const stated = Object.entries(expected ?? {}).find(([name, value]) => fold(value) === fold(valueWords.text) && (attributeWords === null || fold(attributeWords.text) === fold(name)));
      if (stated) fields[stated[0]] = stated[1];
      else fields[attributeWords?.text ?? valueWords.text] = valueWords.text;
    }
  }
  return fields;
}

const severity: readonly DecisionKind[] = ["urgent", "pending", "doubtful", "applied", "silent"];

function decisionKindOf(trace: MessageTrace | null, notice: string | null, outcomes: readonly string[]): DecisionKind {
  if (notice !== null) return decisionOf({ notice } as Parameters<typeof decisionOf>[0]);
  const kinds: readonly DecisionKind[] = trace?.decisions.map(({ decision }) => decision) ?? [];
  const worst = severity.find((kind) => kinds.includes(kind));
  return worst ?? decisionOf({ outcomes } as Parameters<typeof decisionOf>[0]);
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
  return {
    intent: intent?.kind ?? intentFromOutcomes(outcomes),
    fields: extraction ? fieldsOf(extraction, expected.fields) : null,
    product: productId === null ? null : input.productKeyOf(productId),
    decision,
    // The change rows are the truth when read: a completion of a pending changes the order and its decision is `pending`, and a mark can be inherited.
    changeApplied: kinds.some((kind) => kind === "applied" || kind === "doubtful") || (kinds.length === 0 && decision === "applied") || (input.changedLines?.length ?? 0) > 0,
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
