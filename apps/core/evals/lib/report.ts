import type { CaseRecord } from "@core/evals/lib/case-record";
import { costOf, type ModelCall } from "@core/evals/lib/model-meter";
import type { ErrorGroups } from "@core/evals/lib/claude";
import { gradePick, pickOf } from "@core/evals/lib/picks";
import { repeatedNoticeProducts } from "@core/evals/lib/scorers";
import type { ShippedFeatures } from "@core/evals/lib/shipped-expectations";
import { shippedReaderFeatures } from "@core/src/features/orders/infrastructure/shipped-reader-features";

/** Aggregation of one run's case records into the report written to eval-results/. Pure: unit-tested in report.test.ts. */

export type Tally = Readonly<{ total: number; passed: number; accuracy: number }>;
/** Right and wrong model picks in a confidence range; `unverified` picks the case cannot grade (lib/picks.ts). */
export type Bucket = Readonly<{ range: string; correct: number; wrong: number; unverified: number }>;
/** Calibration of one certainty source, graded by the model's own pick (lib/picks.ts), not by what its gate then decided. */
export type Calibration = Readonly<{
  buckets: readonly Bucket[];
  /** At the production gate of the source: right and wrong picks accepted (≥ gate) and rejected (< gate); ungraded picks apart. */
  atGate: Readonly<{ gate: number | null; acceptedCorrect: number; acceptedWrong: number; rejectedCorrect: number; rejectedWrong: number; unverified: number }>;
}>;
export type CalibrationPoint = Readonly<{ confidence: number; correct: boolean | null; gate: number }>;
export type ModelUsage = Readonly<{ calls: number; inputTokens: number; outputTokens: number; costUsd: number | null }>;

export type RunMeta = Readonly<{ runId: string; startedAt: string; finishedAt: string; settings: Readonly<Record<string, unknown>> }>;

export type EvalReport = Readonly<{
  runId: string;
  startedAt: string;
  finishedAt: string;
  settings: Readonly<Record<string, unknown>>;
  /** The reader features the run was scored under (lib/shipped-expectations.ts): which variant of the payment fallback the expectations were read as. */
  shippedReaderFeatures: ShippedFeatures;
  overall: Tally;
  byPass: Readonly<Record<string, Tally>>;
  byCriterion: Readonly<Record<string, Tally>>;
  byKind: Readonly<Record<string, Tally>>;
  byTag: Readonly<Record<string, Tally>>;
  fields: Readonly<Record<string, Tally>>;
  judge: Readonly<{ judged: number; passed: number; rescued: readonly string[]; disagreed: readonly string[] }>;
  /** The acceptance gate (evals/README.md), over the first repetition of each scored message; whole run and per family (`kind`). */
  gate: Readonly<{ whole: GateLines; withoutPhoto: GateLines; photo: GateLines; byFamily: Readonly<Record<string, GateLines>> }>;
  /** Cost per scored message against the reported target, with cached and reasoning tokens. */
  cost: CostLine;
  /** Model calls per message kind against what evals/README.md allows. */
  readerCalls: Readonly<Record<string, ReaderCallLine>>;
  /** Cases tagged `pinned-miss`: the actions ignored per repetition. */
  pinnedMiss: readonly Readonly<{ caseId: string; repeats: readonly Readonly<{ repeat: number; ignoredActions: number }>[]; ignoredInAnyRepeat: boolean }>[];
  /** The end-to-end pass split by input: photo messages and text messages. */
  endToEnd: Readonly<{ photo: Tally; text: Tally }>;
  /** Cases tagged `known-limitation`: beyond the documented design, listed here and left out of every score. */
  knownLimitations: readonly Readonly<{ caseId: string; passed: boolean; signature: string }>[];
  retries: Readonly<{ messages: number; attempts: number }>;
  /** Image pass views: the near-identical polos, negatives the vision chooser accepted, labels and non-product photos. */
  image: ImageView;
  calibration: Readonly<Record<string, Readonly<Record<string, Calibration>>>>;
  /** The production gate each certainty source was compared with, as the run's env configured it. */
  gates: Readonly<Record<string, number>>;
  /** Repeated cases (run more than once) whose runs all share one signature, whole and per family. `flipped` names the others. */
  consistency: Readonly<ConsistencyLine & { cases: number; repeats: number; flipped: readonly Readonly<{ caseId: string; signatures: readonly string[] }>[];
    byFamily: Readonly<Record<string, ConsistencyLine>> }>;
  /** Counts the gates do not hold (evals/README.md); no case id or text. */
  tagMetrics: TagMetrics;
  injection: Readonly<{ total: number; allowed: number; priceChanged: readonly string[] }>;
  latencyMs: Readonly<Record<string, Readonly<{ p50: number; p95: number }>>>;
  /** p95 over the messages of the message passes: the scored step's latency, and the time of its model calls added up. */
  messageLatency: Readonly<{ p95Ms: number; p95ModelMs: number }>;
  usage: Readonly<{
    systemCalls: number;
    claudeCalls: number;
    byModel: Readonly<Record<string, ModelUsage>>;
    byRole: Readonly<Record<string, ModelUsage>>;
    totalCostUsd: number;
    unpricedModels: readonly string[];
    systemCostPerMessageUsd: number;
  }>;
  failures: readonly Readonly<{ caseId: string; pass: string; input: string; expected: unknown; actual: unknown; fields: unknown; error: string | null;
    certainties: CaseRecord["certainties"] }>[];
  errorGroups: ErrorGroups["groups"];
}>;

export type ConsistencyLine = Readonly<{ repeated: number; consistent: number; percent: number }>;
export type TagMetrics = Readonly<{
  /** Scored messages tagged `question-caption`, and those that added to the order with no notice. */
  questionCaptionSilentAdds: Readonly<{ messages: number; silentAdds: number }>;
  /** Scored messages with a payment request, and those whose notice was a several-problems count that swallowed it. */
  paymentInCount: Readonly<{ paymentRequests: number; insideCount: number }>;
  /** Scored messages per notice kind (`none` for a silent message). */
  noticesByKind: Readonly<Record<string, number>>;
}>;

export type GateLines = Readonly<{
  /** Scored messages: the first repetition of every message of the interpretation, end-to-end and conversation passes. */
  scored: number;
  right: number;
  rightPercent: number;
  ignoredActions: number;
  twoNoticeConversations: number;
  wrongSilentChanges: number;
  expectedSilent: number;
  extraNotices: number;
  extraNoticePercent: number;
}>;
export type CostLine = Readonly<{ perScoredMessageUsd: number | null; targetUsd: number; overTarget: boolean; inputTokens: number; outputTokens: number;
  cachedTokens: number; reasoningTokens: number }>;
export type ReaderCallLine = Readonly<{ messages: number; maxCalls: number; meanCalls: number; allowed: number; withinDesign: boolean }>;

/** The cost target per message (a reported target, not a gate). */
export const costTargetUsd = 0.003;
/**
 * Model calls a message may make (evals/README.md): a text 1 reader call; a photo without a caption 0 reader calls and at most
 * the visual chooser; a photo with a caption the visual chooser and 1 reader call. The reader and the chooser are not told apart.
 */
export const allowedCalls = { text: 1, photo: 1, photo_caption: 2 } as const;

export type ImageView = Readonly<{
  /** Buyer photos of the Polo básico or premium (founder rule): the exact product, not identified, or the other polo (the only error). */
  indistinguishablePair: Readonly<{ total: number; exact: readonly string[]; notIdentified: readonly string[]; otherPolo: readonly string[]; other: readonly string[];
    /** Cases where the vision chooser picked the other polo, at any confidence (only above the gate is it an error); needs recorded picks. */
    otherPoloPicks: readonly Readonly<{ caseId: string; confidence: number }>[] }>;
  /** Photos that must not be identified where the vision chooser still picked a product at or above its gate; `signature` is what the cascade then decided (a «not_product» answer stops it). */
  negativesAboveGate: readonly Readonly<{ caseId: string; confidence: number; signature: string }>[];
  labels: Tally;
  nonProduct: Tally;
  byScenario: Readonly<Record<string, Tally>>;
}>;

function imageView(records: readonly CaseRecord[]): ImageView {
  const images = records.filter(({ pass }) => pass === "image");
  const pair = images.filter(({ tags }) => tags.includes("indistinguishable-pair"));
  const expectedProduct = (record: CaseRecord) => (record.expected as readonly Readonly<{ product?: string }>[])[0]?.product;
  const otherPolo = pair.filter((record) => record.signature.startsWith("found:") && record.signature !== `found:${expectedProduct(record)}`
    && /^found:polo-(basico|premium)$/.test(record.signature));
  return {
    indistinguishablePair: {
      total: pair.length,
      exact: pair.filter((record) => record.signature === `found:${expectedProduct(record)}`).map(({ caseId }) => caseId),
      notIdentified: pair.filter(({ signature }) => signature === "not_found").map(({ caseId }) => caseId),
      otherPolo: otherPolo.map(({ caseId }) => caseId),
      other: pair.filter((record) => !otherPolo.includes(record) && record.signature !== "not_found" && record.signature !== `found:${expectedProduct(record)}`).map(({ caseId }) => caseId),
      otherPoloPicks: pair.flatMap((record) => record.certainties.filter((certainty) => certainty.source === "visual")
        .filter((certainty) => { const pick = pickOf(certainty); return typeof pick === "string" && /^polo-(basico|premium)$/.test(pick) && pick !== expectedProduct(record); })
        .map(({ confidence }) => ({ caseId: record.caseId, confidence }))),
    },
    negativesAboveGate: images.filter((record) => (record.expected as readonly Readonly<{ kind: string }>[]).every(({ kind }) => kind !== "found"))
      .flatMap((record) => record.certainties.filter(({ source, confidence, gate }) => source === "visual" && confidence >= gate)
        .map(({ confidence }) => ({ caseId: record.caseId, confidence, signature: record.signature }))),
    labels: tally(images.filter(({ tags }) => tags.includes("folder:label"))),
    nonProduct: tally(images.filter(({ tags }) => tags.includes("folder:non-product"))),
    byScenario: groupBy(images, ({ kind }) => [kind]),
  };
}

const tally = (records: readonly CaseRecord[]): Tally => {
  const passed = records.filter((record) => record.passed).length;
  return { total: records.length, passed, accuracy: records.length ? round(passed / records.length) : 0 };
};

const round = (value: number, digits = 3) => Math.round(value * 10 ** digits) / 10 ** digits;

function groupBy(records: readonly CaseRecord[], keys: (record: CaseRecord) => readonly string[]): Record<string, Tally> {
  const groups = new Map<string, CaseRecord[]>();
  for (const record of records) for (const key of keys(record)) groups.set(key, [...(groups.get(key) ?? []), record]);
  return Object.fromEntries([...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, group]) => [key, tally(group)]));
}

/** Nearest-rank percentile of a list of numbers; 0 for an empty list. */
export function percentile(values: readonly number[], fraction: number): number {
  if (!values.length) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.max(0, Math.ceil(fraction * ordered.length) - 1))]!;
}

const bucketEdges = [0, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0001];
const bucketName = (low: number, high: number) => `${low.toFixed(1)}–${Math.min(high, 1).toFixed(1)}`;
/** Each point is compared with its own production gate (lib/production.ts `gates`). */
export function calibrate(points: readonly CalibrationPoint[]): Calibration {
  const buckets = bucketEdges.slice(0, -1).map((low, index) => {
    const high = bucketEdges[index + 1]!;
    const inside = points.filter(({ confidence }) => confidence >= low && confidence < high);
    return { range: bucketName(low, high), correct: inside.filter(({ correct }) => correct === true).length, wrong: inside.filter(({ correct }) => correct === false).length,
      unverified: inside.filter(({ correct }) => correct === null).length };
  });
  const count = (accepted: boolean, correct: boolean) => points.filter((point) => (point.confidence >= point.gate) === accepted && point.correct === correct).length;
  return { buckets, atGate: { gate: points[0]?.gate ?? null, acceptedCorrect: count(true, true), acceptedWrong: count(true, false),
    rejectedCorrect: count(false, true), rejectedWrong: count(false, false), unverified: points.filter(({ correct }) => correct === null).length } };
}

/** Calibration points of one pass, per certainty source, each graded by the model's own pick. */
function calibrationOf(records: readonly CaseRecord[]): Record<string, Calibration> {
  const bySource = new Map<string, CalibrationPoint[]>();
  for (const record of records) {
    for (const certainty of record.certainties) {
      bySource.set(certainty.source, [...(bySource.get(certainty.source) ?? []), { confidence: certainty.confidence, gate: certainty.gate, correct: gradePick(certainty, record) }]);
    }
  }
  return Object.fromEntries([...bySource.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([source, points]) => [source, calibrate(points)]));
}

const isMessageRecord = ({ pass }: CaseRecord) => pass !== "image";
const percentOf = (part: number, whole: number) => whole ? Math.round((part / whole) * 1000) / 10 : 0;

/** The gate lines of a set of first-repetition records: every message of a conversation counts as a scored message; a conversation counts once for the two-notices line. */
export function gateLines(records: readonly CaseRecord[]): GateLines {
  const messages = records.filter(isMessageRecord);
  const silent = messages.filter(({ expectedSilent }) => expectedSilent);
  const extra = silent.filter(({ extraNotice }) => extraNotice);
  const right = messages.filter(({ passed }) => passed).length;
  return {
    scored: messages.length, right, rightPercent: percentOf(right, messages.length),
    ignoredActions: messages.reduce((sum, record) => sum + record.ignoredActions, 0),
    twoNoticeConversations: repeatedConversations(messages).length,
    wrongSilentChanges: messages.filter(({ wrongSilentChange }) => wrongSilentChange).length,
    expectedSilent: silent.length, extraNotices: extra.length, extraNoticePercent: percentOf(extra.length, silent.length),
  };
}

const consistencyLine = (runs: readonly (readonly CaseRecord[])[]): ConsistencyLine => {
  const consistent = runs.filter((group) => new Set(group.map(({ signature }) => signature)).size === 1).length;
  return { repeated: runs.length, consistent, percent: percentOf(consistent, runs.length) };
};

function gateOf(scored: readonly CaseRecord[]) {
  const families = [...new Set(scored.filter(isMessageRecord).map(({ kind }) => kind))].sort();
  return { whole: gateLines(scored), withoutPhoto: gateLines(scored.filter(({ photoCase }) => !photoCase)), photo: gateLines(scored.filter(({ photoCase }) => photoCase)),
    byFamily: Object.fromEntries(families.map((kind) => [kind, gateLines(scored.filter((record) => record.kind === kind))])) };
}

type ConsistencyFlips = EvalReport["consistency"]["flipped"];

function consistencyOf(repeated: ReadonlyMap<string, readonly CaseRecord[]>, flipped: ConsistencyFlips) {
  const groups = [...repeated.values()];
  const families = [...new Set(groups.map((runs) => runs[0]!.kind))].sort();
  return { ...consistencyLine(groups), cases: repeated.size, repeats: Math.max(0, ...groups.map((runs) => runs.length)), flipped,
    byFamily: Object.fromEntries(families.map((kind) => [kind, consistencyLine(groups.filter((runs) => runs[0]!.kind === kind))])) };
}

const noticeOf = (record: CaseRecord): string | null => (record.actual as { notice?: string | null } | null)?.notice ?? null;
/** The notice key of the count by kind: a message whose evaluation threw counts as `error`, not as a silent one. */
const noticeKeyOf = (record: CaseRecord): string => record.error !== null && noticeOf(record) === null ? "error" : noticeOf(record) ?? "none";
const outcomesOf = (record: CaseRecord): readonly string[] => (record.actual as { outcomes?: readonly string[] } | null)?.outcomes ?? [];
const addingOutcomes: ReadonlySet<string> = new Set(["added", "pending_created", "pending_completed"]);

function tagMetricsOf(scored: readonly CaseRecord[]): TagMetrics {
  const messages = scored.filter(isMessageRecord);
  const questions = messages.filter(({ tags }) => tags.includes("question-caption"));
  const payments = messages.filter((record) => outcomesOf(record).includes("payment_requested"));
  const byKind = new Map<string, number>();
  for (const record of messages) byKind.set(noticeKeyOf(record), (byKind.get(noticeKeyOf(record)) ?? 0) + 1);
  return {
    questionCaptionSilentAdds: { messages: questions.length, silentAdds: questions.filter((record) => noticeOf(record) === null && outcomesOf(record).some((kind) => addingOutcomes.has(kind))).length },
    paymentInCount: { paymentRequests: payments.length, insideCount: payments.filter((record) => noticeOf(record) === "several_problems").length },
    noticesByKind: Object.fromEntries([...byKind.entries()].sort(([a], [b]) => a.localeCompare(b))),
  };
}

/** Conversations whose messages' notices name one product twice, unless a message is marked as an expected repeat. */
function repeatedConversations(messages: readonly CaseRecord[]): readonly string[] {
  const byConversation = new Map<string, CaseRecord[]>();
  for (const record of messages) if (record.conversationId) byConversation.set(record.conversationId, [...(byConversation.get(record.conversationId) ?? []), record]);
  return [...byConversation.entries()].filter(([, steps]) => repeatedNoticeProducts([...steps].sort((a, b) => (a.step ?? 0) - (b.step ?? 0))).length > 0).map(([id]) => id);
}

const isSystemModelCall = (call: ModelCall) => call.role === "system" && !call.endpoint.includes("embeddings");

function costOfRecords(records: readonly CaseRecord[]): CostLine {
  const calls = records.flatMap(({ calls: recorded }) => recorded.filter(({ role }) => role === "system"));
  const total = usageOf(calls).costUsd;
  const perMessage = total !== null && records.length ? round(total / records.length, 6) : null;
  return { perScoredMessageUsd: perMessage, targetUsd: costTargetUsd, overTarget: perMessage !== null && perMessage > costTargetUsd,
    inputTokens: calls.reduce((sum, call) => sum + call.inputTokens, 0), outputTokens: calls.reduce((sum, call) => sum + call.outputTokens, 0),
    cachedTokens: calls.reduce((sum, call) => sum + (call.cachedTokens ?? 0), 0), reasoningTokens: calls.reduce((sum, call) => sum + (call.reasoningTokens ?? 0), 0) };
}

function readerCallsOf(records: readonly CaseRecord[]): Record<string, ReaderCallLine> {
  const groups = new Map<keyof typeof allowedCalls, number[]>();
  for (const record of records) {
    if (!record.messageKind) continue;
    groups.set(record.messageKind, [...(groups.get(record.messageKind) ?? []), record.calls.filter(isSystemModelCall).length]);
  }
  return Object.fromEntries([...groups.entries()].map(([kind, counts]) => [kind, { messages: counts.length, maxCalls: Math.max(...counts),
    meanCalls: round(counts.reduce((sum, count) => sum + count, 0) / counts.length, 2), allowed: allowedCalls[kind], withinDesign: Math.max(...counts) <= allowedCalls[kind] }]));
}

function pinnedMissOf(records: readonly CaseRecord[]): EvalReport["pinnedMiss"] {
  const groups = new Map<string, CaseRecord[]>();
  for (const record of records.filter(({ tags }) => tags.includes("pinned-miss"))) groups.set(record.caseId, [...(groups.get(record.caseId) ?? []), record]);
  return [...groups.entries()].map(([caseId, runs]) => {
    const repeats = [...runs].sort((a, b) => a.repeat - b.repeat).map(({ repeat, ignoredActions }) => ({ repeat, ignoredActions }));
    return { caseId, repeats, ignoredInAnyRepeat: repeats.some(({ ignoredActions }) => ignoredActions > 0) };
  });
}

function usageOf(calls: readonly ModelCall[]): ModelUsage {
  const costs = calls.map(costOf);
  return {
    calls: calls.length,
    inputTokens: calls.reduce((sum, call) => sum + call.inputTokens, 0),
    outputTokens: calls.reduce((sum, call) => sum + call.outputTokens, 0),
    costUsd: costs.some((cost) => cost === null) ? null : round(costs.reduce<number>((sum, cost) => sum + (cost ?? 0), 0), 6),
  };
}

function usageBy(calls: readonly ModelCall[], key: (call: ModelCall) => string): Record<string, ModelUsage> {
  const groups = new Map<string, ModelCall[]>();
  for (const call of calls) groups.set(key(call), [...(groups.get(key(call)) ?? []), call]);
  return Object.fromEntries([...groups.entries()].map(([name, group]) => [name, usageOf(group)]));
}

/**
 * Builds the run report. `extraCalls` are model calls made outside any case (Claude's classifier). Accuracy counts the first run of
 * each case; repeats only feed consistency, latency and usage.
 */
export function buildReport(records: readonly CaseRecord[], meta: RunMeta, extraCalls: readonly ModelCall[] = [], errorGroups: ErrorGroups["groups"] = [],
  features: ShippedFeatures = shippedReaderFeatures): EvalReport {
  const firstRuns = records.filter(({ repeat }) => repeat === 0);
  const known = firstRuns.filter(({ tags }) => tags.includes("known-limitation"));
  const scored = firstRuns.filter((record) => !known.includes(record));
  const fieldNames = [...new Set(scored.flatMap((record) => Object.keys(record.fields)))].sort();
  const fields = Object.fromEntries(fieldNames.map((name) => {
    const values = scored.flatMap((record) => typeof record.fields[name] === "boolean" ? [record.fields[name]] : []);
    const passed = values.filter(Boolean).length;
    return [name, { total: values.length, passed, accuracy: values.length ? round(passed / values.length) : 0 }];
  }));

  const judged = scored.filter(({ judge }) => judge !== null);
  const calibration: Record<string, Record<string, Calibration>> = {};
  for (const pass of [...new Set(scored.map((record) => record.pass))].sort()) calibration[pass] = calibrationOf(scored.filter((record) => record.pass === pass));

  // Every case run more than once (consistency, pinned misses, EVAL_REPEAT_TAGS) is checked for flips; the gates count the first run only.
  const runsOf = new Map<string, CaseRecord[]>();
  for (const record of records) runsOf.set(record.caseId, [...(runsOf.get(record.caseId) ?? []), record]);
  const repeated = new Map([...runsOf.entries()].filter(([, runs]) => runs.some(({ repeat }) => repeat > 0)));
  const flipped = [...repeated.entries()].flatMap(([caseId, runs]) => {
    const signatures = [...new Set(runs.map(({ signature }) => signature))];
    return signatures.length > 1 ? [{ caseId, signatures }] : [];
  });

  const injection = scored.filter(({ tags }) => tags.includes("injection"));
  const allCalls = [...records.flatMap(({ calls }) => calls), ...extraCalls];
  const systemCalls = allCalls.filter(({ role }) => role === "system");
  const byModel = usageBy(allCalls, ({ model }) => model);
  const systemCost = usageOf(systemCalls).costUsd;
  const messageRecords = records.filter(isMessageRecord);
  const latencyGroups = new Map<string, number[]>([["all", records.map(({ latencyMs }) => latencyMs)]]);
  for (const record of records) latencyGroups.set(record.pass, [...(latencyGroups.get(record.pass) ?? []), record.latencyMs]);

  return {
    runId: meta.runId, startedAt: meta.startedAt, finishedAt: meta.finishedAt, settings: meta.settings, shippedReaderFeatures: features,
    overall: tally(scored),
    byPass: groupBy(scored, ({ pass }) => [pass]),
    byCriterion: groupBy(scored.filter(({ criterion }) => criterion > 0), ({ criterion }) => [`criterion ${criterion}`]),
    byKind: groupBy(scored, ({ kind }) => [kind]),
    byTag: groupBy(scored, ({ tags }) => tags),
    fields,
    judge: {
      judged: judged.length,
      passed: judged.filter(({ judge }) => judge?.pass).length,
      rescued: judged.filter(({ judge, exactPassed, passed }) => judge?.pass && !exactPassed && passed).map(({ caseId }) => caseId),
      disagreed: judged.filter(({ judge, exactPassed }) => judge?.pass !== exactPassed).map(({ caseId }) => caseId),
    },
    gate: gateOf(scored),
    cost: costOfRecords(scored.filter(isMessageRecord)),
    readerCalls: readerCallsOf(scored),
    pinnedMiss: pinnedMissOf(records),
    endToEnd: {
      photo: tally(scored.filter(({ pass, input }) => pass === "end_to_end" && input.startsWith("photo"))),
      text: tally(scored.filter(({ pass, input }) => pass === "end_to_end" && !input.startsWith("photo"))),
    },
    knownLimitations: known.map(({ caseId, passed, signature }) => ({ caseId, passed, signature })),
    image: imageView(scored),
    retries: { messages: records.filter(({ retries }) => retries > 0).length, attempts: records.reduce((sum, { retries }) => sum + retries, 0) },
    calibration,
    gates: Object.fromEntries(records.flatMap(({ certainties }) => certainties.map(({ source, gate }) => [source, gate] as const)).sort(([a], [b]) => a.localeCompare(b))),
    consistency: consistencyOf(repeated, flipped),
    tagMetrics: tagMetricsOf(scored),
    injection: { total: injection.length, allowed: injection.filter(({ passed }) => passed).length,
      priceChanged: injection.filter(({ fields }) => fields.unitPrice === false).map(({ caseId }) => caseId) },
    latencyMs: Object.fromEntries([...latencyGroups.entries()].map(([name, values]) => [name, { p50: percentile(values, 0.5), p95: percentile(values, 0.95) }])),
    messageLatency: { p95Ms: percentile(messageRecords.map(({ latencyMs }) => latencyMs), 0.95),
      p95ModelMs: percentile(messageRecords.map(({ calls }) => calls.filter(isSystemModelCall).reduce((sum, call) => sum + call.durationMs, 0)), 0.95) },
    usage: {
      systemCalls: systemCalls.length,
      claudeCalls: allCalls.filter(({ provider }) => provider === "anthropic").length,
      byModel,
      byRole: usageBy(allCalls, ({ role }) => role),
      totalCostUsd: round(Object.values(byModel).reduce((sum, usage) => sum + (usage.costUsd ?? 0), 0), 6),
      unpricedModels: Object.entries(byModel).filter(([, usage]) => usage.costUsd === null).map(([model]) => model),
      systemCostPerMessageUsd: records.length && systemCost !== null ? round(systemCost / records.length, 6) : 0,
    },
    failures: scored.filter(({ passed }) => !passed).map(({ caseId, pass, input, expected, actual, fields: scores, error, certainties }) =>
      ({ caseId, pass, input, expected, actual, fields: scores, error, certainties })),
    errorGroups,
  };
}

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const line = (name: string, value: Tally) => `  ${name.padEnd(34)} ${String(value.passed).padStart(4)}/${String(value.total).padEnd(4)} ${percent(value.accuracy)}`;

const featuresText = (features: ShippedFeatures) => `payment request ${features.paymentRequest ? "on" : "off"}, closed-order line ${features.closedOrderLine ? "on" : "off"}`;

const gateText = (name: string, lines: GateLines) => [
  `${name}: right ${lines.right} of ${lines.scored} scored messages (${lines.rightPercent.toFixed(1)}%)`,
  `${name}: ${lines.ignoredActions} ignored actions`,
  `${name}: ${lines.twoNoticeConversations} conversations with two notices for one product`,
  `${name}: ${lines.wrongSilentChanges} wrong silent changes`,
  `${name}: extra notices ${lines.extraNotices} of ${lines.expectedSilent} messages expected silent (${lines.extraNoticePercent.toFixed(1)}%)`,
];

/**
 * The aggregate gate lines (whole run and per family), cost and latency. Nothing here names a case, an input or a judge reason, so it
 * is the only output of a private run (`EVAL_PRIVATE_DIR`).
 */
export function formatGateSummary(report: EvalReport): string {
  const { cost, readerCalls } = report;
  return [
    `Eval gate ${report.runId}`,
    `Reader features scored: ${featuresText(report.shippedReaderFeatures)}`,
    ...gateText("whole run", report.gate.whole),
    ...gateText("without photo cases", report.gate.withoutPhoto),
    ...gateText("photo cases", report.gate.photo),
    ...Object.entries(report.gate.byFamily).flatMap(([family, lines]) => gateText(`family ${family}`, lines)),
    `Cost per scored message: ${cost.perScoredMessageUsd === null ? "unknown price" : `$${cost.perScoredMessageUsd.toFixed(5)}`} against $${cost.targetUsd.toFixed(3)}${cost.overTarget ? " (over the target)" : ""}; `
      + `${cost.inputTokens} in (${cost.cachedTokens} cached) / ${cost.outputTokens} out (${cost.reasoningTokens} reasoning) tokens`,
    `Latency per message: p95 ${report.messageLatency.p95Ms} ms, p95 model time ${report.messageLatency.p95ModelMs} ms`,
    ...Object.entries(readerCalls).map(([kind, line]) => `Model calls per ${kind} message: mean ${line.meanCalls}, max ${line.maxCalls}, design allows ${line.allowed}${line.withinDesign ? "" : " (over)"}`),
    `Consistency: ${report.consistency.consistent} of ${report.consistency.repeated} repeated cases gave one result over ${report.consistency.repeats} runs (${report.consistency.percent.toFixed(1)}%)`,
    ...Object.entries(report.consistency.byFamily).map(([family, lines]) => `Consistency of family ${family}: ${lines.consistent} of ${lines.repeated} (${lines.percent.toFixed(1)}%)`),
    `Silent adds on question captions: ${report.tagMetrics.questionCaptionSilentAdds.silentAdds} of ${report.tagMetrics.questionCaptionSilentAdds.messages} messages`,
    `Payment requests inside a several-problems count: ${report.tagMetrics.paymentInCount.insideCount} of ${report.tagMetrics.paymentInCount.paymentRequests}`,
    `Notices by kind: ${Object.entries(report.tagMetrics.noticesByKind).map(([kind, count]) => `${kind} ${count}`).join(", ") || "none"}`,
  ].join("\n");
}

/** The terminal summary printed after a run. */
export function formatSummary(report: EvalReport, path: string): string {
  const section = (title: string, groups: Readonly<Record<string, Tally>>) => [title, ...Object.entries(groups).map(([name, value]) => line(name, value))];
  const cost = (value: number | null) => value === null ? "unknown price" : `$${value.toFixed(4)}`;
  return [
    `Eval run ${report.runId}`,
    line("overall", report.overall),
    ...section("By pass", report.byPass),
    ...(report.endToEnd.photo.total && report.endToEnd.text.total ? [line("end_to_end photo messages", report.endToEnd.photo), line("end_to_end text messages", report.endToEnd.text)] : []),
    ...section("By criterion", report.byCriterion),
    ...section("Fields", report.fields),
    formatGateSummary(report),
    ...(report.pinnedMiss.length ? ["Pinned misses (ignored actions per repetition)", ...report.pinnedMiss.map(({ caseId, repeats, ignoredInAnyRepeat }) =>
      `  ${caseId.padEnd(34)} ${repeats.map(({ ignoredActions }) => ignoredActions).join(" / ")}${ignoredInAnyRepeat ? "  IGNORED" : ""}`)] : []),
    "Calibration at the production gates: the model's own picks, right / wrong, accepted (≥ gate) and rejected (< gate)",
    ...Object.entries(report.calibration).flatMap(([pass, sources]) => Object.entries(sources).map(([source, { atGate }]) =>
      `  ${`${pass} ${source}`.padEnd(28)} gate ${String(atGate.gate ?? "-").padEnd(4)} accepted ${atGate.acceptedCorrect} right / ${atGate.acceptedWrong} wrong, rejected ${atGate.rejectedCorrect} right / ${atGate.rejectedWrong} wrong${atGate.unverified ? `, ${atGate.unverified} ungraded` : ""}`)),
    ...(report.byPass.image ? [
      `Image: indistinguishable pair ${report.image.indistinguishablePair.total} (exact ${report.image.indistinguishablePair.exact.length}, not identified ${report.image.indistinguishablePair.notIdentified.length}, other polo ${report.image.indistinguishablePair.otherPolo.length}${report.image.indistinguishablePair.otherPolo.length ? `: ${report.image.indistinguishablePair.otherPolo.join(", ")}` : ""}, other ${report.image.indistinguishablePair.other.length}; other-polo picks at any confidence ${report.image.indistinguishablePair.otherPoloPicks.length}); labels ${report.image.labels.passed}/${report.image.labels.total}; non-product ${report.image.nonProduct.passed}/${report.image.nonProduct.total}`,
      `Image negatives the vision chooser picked at or above its gate (→ the cascade's result): ${report.image.negativesAboveGate.length
        ? report.image.negativesAboveGate.map(({ caseId, confidence, signature }) => `${caseId} ${confidence} → ${signature}`).join(", ") : "none"}`,
      ...section("Image by scenario", report.image.byScenario),
    ] : []),
    `Known limitations (not scored): ${report.knownLimitations.length ? report.knownLimitations.map(({ caseId, passed }) => `${caseId} ${passed ? "passed" : "failed"}`).join(", ") : "none"}`,
    `Injection: ${report.injection.allowed}/${report.injection.total} allowed outcomes, ${report.injection.priceChanged.length} price changes`,
    `Judge: ${report.judge.passed}/${report.judge.judged} passed, ${report.judge.rescued.length} rescued, ${report.judge.disagreed.length} disagree with exact match`,
    `Latency of the scored model step (setup excluded; ${report.retries.attempts} retried attempts in ${report.retries.messages} messages): ${Object.entries(report.latencyMs).map(([name, { p50, p95 }]) => `${name} p50 ${p50} ms / p95 ${p95} ms`).join("; ")}`,
    `Model calls: ${report.usage.systemCalls} by the system under test, ${report.usage.claudeCalls} to Claude`,
    ...Object.entries(report.usage.byModel).map(([model, usage]) => `  ${model.padEnd(24)} ${usage.calls} calls, ${usage.inputTokens} in / ${usage.outputTokens} out tokens, ${cost(usage.costUsd)}`),
    `Estimated cost: $${report.usage.totalCostUsd.toFixed(4)} (system $${report.usage.systemCostPerMessageUsd.toFixed(5)} per message)${report.usage.unpricedModels.length ? `; no price for ${report.usage.unpricedModels.join(", ")}` : ""}`,
    ...(report.errorGroups.length ? ["Error groups (Claude's hypotheses from the records, not verified causes)", ...report.errorGroups.map((group) => `  ${group.cause} (${group.caseIds.length}): ${group.caseIds.join(", ")}`)] : []),
    `Report: ${path}`,
  ].join("\n");
}
