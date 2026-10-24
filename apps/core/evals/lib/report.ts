import type { CaseRecord } from "@core/evals/lib/case-record";
import { costOf, type ModelCall } from "@core/evals/lib/model-meter";
import type { ErrorGroups } from "@core/evals/lib/claude";

/** Aggregation of one run's case records into the report written to eval-results/. Pure: unit-tested in report.test.ts. */

export type Tally = Readonly<{ total: number; passed: number; accuracy: number }>;
export type Bucket = Readonly<{ range: string; correct: number; wrong: number }>;
export type Calibration = Readonly<{
  /** The field that says whether the decision was right: tool for the action, product for text and visual, variant, outcome for items. */
  field: string;
  buckets: readonly Bucket[];
  /** At the production gate of the source: accepted (≥ gate) and rejected (< gate) certainties of right and wrong decisions. */
  atGate: Readonly<{ gate: number | null; acceptedCorrect: number; acceptedWrong: number; rejectedCorrect: number; rejectedWrong: number }>;
}>;
export type CalibrationPoint = Readonly<{ confidence: number; correct: boolean; gate: number }>;
export type ModelUsage = Readonly<{ calls: number; inputTokens: number; outputTokens: number; costUsd: number | null }>;

export type RunMeta = Readonly<{ runId: string; startedAt: string; finishedAt: string; settings: Readonly<Record<string, unknown>> }>;

export type EvalReport = Readonly<{
  runId: string;
  startedAt: string;
  finishedAt: string;
  settings: Readonly<Record<string, unknown>>;
  overall: Tally;
  byPass: Readonly<Record<string, Tally>>;
  byCriterion: Readonly<Record<string, Tally>>;
  byKind: Readonly<Record<string, Tally>>;
  byExpectedTool: Readonly<Record<string, Tally>>;
  byTag: Readonly<Record<string, Tally>>;
  fields: Readonly<Record<string, Tally>>;
  judge: Readonly<{ judged: number; passed: number; rescued: readonly string[]; disagreed: readonly string[] }>;
  notices: Readonly<{ falseNotices: readonly string[]; silentErrors: readonly string[]; wrongChanges: readonly string[];
    /** Silent drops: nothing changed and no notice was sent, where a notice (missed) or a change (dropped) was expected. */
    missedNotices: readonly string[]; droppedRequests: readonly string[] }>;
  /** Cases tagged `known-limitation`: beyond the documented design, listed here and left out of every score. */
  knownLimitations: readonly Readonly<{ caseId: string; passed: boolean; signature: string }>[];
  retries: Readonly<{ messages: number; attempts: number }>;
  /** Image pass views: the near-identical polos, negatives the vision chooser accepted, labels and non-product photos. */
  image: ImageView;
  calibration: Readonly<Record<string, Readonly<Record<string, Calibration>>>>;
  /** The production gate each certainty source was compared with, as the run's env configured it. */
  gates: Readonly<Record<string, number>>;
  consistency: Readonly<{ cases: number; repeats: number; flipped: readonly Readonly<{ caseId: string; signatures: readonly string[] }>[] }>;
  injection: Readonly<{ total: number; allowed: number; priceChanged: readonly string[] }>;
  latencyMs: Readonly<Record<string, Readonly<{ p50: number; p95: number }>>>;
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
    certainties: CaseRecord["certainties"]; extracted: readonly unknown[]; textChoices: readonly unknown[] }>[];
  errorGroups: ErrorGroups["groups"];
}>;

export type ImageView = Readonly<{
  /** Buyer photos of the Polo básico or premium (founder rule): the exact product, not identified, or the other polo (the only error). */
  indistinguishablePair: Readonly<{ total: number; exact: readonly string[]; notIdentified: readonly string[]; otherPolo: readonly string[]; other: readonly string[] }>;
  /** Photos that must not be identified where the vision chooser still picked a product at or above its gate. */
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

const bucketEdges = [0, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0001];
const bucketName = (low: number, high: number) => `${low.toFixed(1)}–${Math.min(high, 1).toFixed(1)}`;
/** The fields that say whether each kind of certainty was right, in order of preference (the image and text passes score `identification`). */
const fieldsOfSource: Readonly<Record<string, readonly string[]>> = {
  action: ["tool"], text: ["product", "identification"], text_none: ["product", "identification"], visual: ["identification", "product"],
  variant: ["variant"], variant_none: ["variant"], item: ["outcome"],
};

/** Each point is compared with its own production gate (lib/production.ts `gates`). */
export function calibrate(points: readonly CalibrationPoint[], field: string): Calibration {
  const buckets = bucketEdges.slice(0, -1).map((low, index) => {
    const high = bucketEdges[index + 1]!;
    const inside = points.filter(({ confidence }) => confidence >= low && confidence < high);
    return { range: bucketName(low, high), correct: inside.filter(({ correct }) => correct).length, wrong: inside.filter(({ correct }) => !correct).length };
  });
  const count = (accepted: boolean, correct: boolean) => points.filter((point) => (point.confidence >= point.gate) === accepted && point.correct === correct).length;
  return { field, buckets, atGate: { gate: points[0]?.gate ?? null, acceptedCorrect: count(true, true), acceptedWrong: count(true, false),
    rejectedCorrect: count(false, true), rejectedWrong: count(false, false) } };
}

/**
 * Calibration points of one pass: each certainty scored by its own field, not by the whole case, so a right product with a wrong
 * quantity is a right text choice. Certainties whose field is unscored are left out.
 */
function calibrationOf(records: readonly CaseRecord[]): Record<string, Calibration> {
  const bySource = new Map<string, { field: string; points: CalibrationPoint[] }>();
  for (const record of records) {
    for (const certainty of record.certainties) {
      const field = (fieldsOfSource[certainty.source] ?? []).find((name) => typeof record.fields[name] === "boolean");
      if (!field) continue;
      const group = bySource.get(certainty.source) ?? { field, points: [] };
      group.points.push({ confidence: certainty.confidence, gate: certainty.gate, correct: record.fields[field] === true });
      bySource.set(certainty.source, group);
    }
  }
  return Object.fromEntries([...bySource.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([source, { field, points }]) => [source, calibrate(points, field)]));
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
export function buildReport(records: readonly CaseRecord[], meta: RunMeta, extraCalls: readonly ModelCall[] = [], errorGroups: ErrorGroups["groups"] = []): EvalReport {
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

  const repeated = new Map<string, CaseRecord[]>();
  for (const record of records.filter(({ tags }) => tags.includes("consistency"))) repeated.set(record.caseId, [...(repeated.get(record.caseId) ?? []), record]);
  const flipped = [...repeated.entries()].flatMap(([caseId, runs]) => {
    const signatures = [...new Set(runs.map(({ signature }) => signature))];
    return signatures.length > 1 ? [{ caseId, signatures }] : [];
  });

  const injection = scored.filter(({ tags }) => tags.includes("injection"));
  const allCalls = [...records.flatMap(({ calls }) => calls), ...extraCalls];
  const systemCalls = allCalls.filter(({ role }) => role === "system");
  const byModel = usageBy(allCalls, ({ model }) => model);
  const systemCost = usageOf(systemCalls).costUsd;
  const latencyGroups = new Map<string, number[]>([["all", records.map(({ latencyMs }) => latencyMs)]]);
  for (const record of records) latencyGroups.set(record.pass, [...(latencyGroups.get(record.pass) ?? []), record.latencyMs]);

  return {
    runId: meta.runId, startedAt: meta.startedAt, finishedAt: meta.finishedAt, settings: meta.settings,
    overall: tally(scored),
    byPass: groupBy(scored, ({ pass }) => [pass]),
    byCriterion: groupBy(scored, ({ criterion }) => [`criterion ${criterion}`]),
    byKind: groupBy(scored, ({ kind }) => [kind]),
    byExpectedTool: groupBy(scored.filter(({ pass }) => pass === "interpretation" || pass === "end_to_end"), ({ expectedTool }) => [expectedTool]),
    byTag: groupBy(scored, ({ tags }) => tags),
    fields,
    judge: {
      judged: judged.length,
      passed: judged.filter(({ judge }) => judge?.pass).length,
      rescued: judged.filter(({ judge, exactPassed, passed }) => judge?.pass && !exactPassed && passed).map(({ caseId }) => caseId),
      disagreed: judged.filter(({ judge, exactPassed }) => judge?.pass !== exactPassed).map(({ caseId }) => caseId),
    },
    notices: {
      falseNotices: scored.filter(({ noticeError }) => noticeError === "false_notice").map(({ caseId }) => caseId),
      silentErrors: scored.filter(({ noticeError }) => noticeError === "silent_error").map(({ caseId }) => caseId),
      wrongChanges: scored.filter(({ noticeError }) => noticeError === "wrong_change").map(({ caseId }) => caseId),
      missedNotices: scored.filter(({ noticeError }) => noticeError === "missed_notice").map(({ caseId }) => caseId),
      droppedRequests: scored.filter(({ noticeError }) => noticeError === "dropped_request").map(({ caseId }) => caseId),
    },
    knownLimitations: known.map(({ caseId, passed, signature }) => ({ caseId, passed, signature })),
    image: imageView(scored),
    retries: { messages: records.filter(({ retries }) => retries > 0).length, attempts: records.reduce((sum, { retries }) => sum + retries, 0) },
    calibration,
    gates: Object.fromEntries(records.flatMap(({ certainties }) => certainties.map(({ source, gate }) => [source, gate] as const)).sort(([a], [b]) => a.localeCompare(b))),
    consistency: { cases: repeated.size, repeats: Math.max(0, ...[...repeated.values()].map((runs) => runs.length)), flipped },
    injection: { total: injection.length, allowed: injection.filter(({ passed }) => passed).length,
      priceChanged: injection.filter(({ fields }) => fields.unitPrice === false).map(({ caseId }) => caseId) },
    latencyMs: Object.fromEntries([...latencyGroups.entries()].map(([name, values]) => [name, { p50: percentile(values, 0.5), p95: percentile(values, 0.95) }])),
    usage: {
      systemCalls: systemCalls.length,
      claudeCalls: allCalls.filter(({ provider }) => provider === "anthropic").length,
      byModel,
      byRole: usageBy(allCalls, ({ role }) => role),
      totalCostUsd: round(Object.values(byModel).reduce((sum, usage) => sum + (usage.costUsd ?? 0), 0), 6),
      unpricedModels: Object.entries(byModel).filter(([, usage]) => usage.costUsd === null).map(([model]) => model),
      systemCostPerMessageUsd: records.length && systemCost !== null ? round(systemCost / records.length, 6) : 0,
    },
    failures: scored.filter(({ passed }) => !passed).map(({ caseId, pass, input, expected, actual, fields: scores, error, certainties, trace }) =>
      ({ caseId, pass, input, expected, actual, fields: scores, error, certainties, extracted: trace.extracted, textChoices: trace.textChoices })),
    errorGroups,
  };
}

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const line = (name: string, value: Tally) => `  ${name.padEnd(34)} ${String(value.passed).padStart(4)}/${String(value.total).padEnd(4)} ${percent(value.accuracy)}`;

/** The terminal summary printed after a run. */
export function formatSummary(report: EvalReport, path: string): string {
  const section = (title: string, groups: Readonly<Record<string, Tally>>) => [title, ...Object.entries(groups).map(([name, value]) => line(name, value))];
  const cost = (value: number | null) => value === null ? "unknown price" : `$${value.toFixed(4)}`;
  return [
    `Eval run ${report.runId}`,
    line("overall", report.overall),
    ...section("By pass", report.byPass),
    ...section("By criterion", report.byCriterion),
    ...section("By expected tool", report.byExpectedTool),
    ...section("Fields", report.fields),
    `Notices: ${report.notices.falseNotices.length} false notices, ${report.notices.silentErrors.length} silent errors, ${report.notices.wrongChanges.length} wrong silent changes`,
    `Silent drops (nothing changed, no notice): ${report.notices.missedNotices.length} missed notices, ${report.notices.droppedRequests.length} dropped requests`,
    "Calibration at the production gates (accepted ≥ gate / rejected < gate; right / wrong by the source's own field)",
    ...Object.entries(report.calibration).flatMap(([pass, sources]) => Object.entries(sources).map(([source, { field, atGate }]) =>
      `  ${`${pass} ${source}`.padEnd(28)} gate ${atGate.gate ?? "-"} by ${field.padEnd(14)} accepted ${atGate.acceptedCorrect} right / ${atGate.acceptedWrong} wrong, rejected ${atGate.rejectedCorrect} right / ${atGate.rejectedWrong} wrong`)),
    ...(report.byPass.image ? [
      `Image: indistinguishable pair ${report.image.indistinguishablePair.total} (exact ${report.image.indistinguishablePair.exact.length}, not identified ${report.image.indistinguishablePair.notIdentified.length}, other polo ${report.image.indistinguishablePair.otherPolo.length}${report.image.indistinguishablePair.otherPolo.length ? `: ${report.image.indistinguishablePair.otherPolo.join(", ")}` : ""}, other ${report.image.indistinguishablePair.other.length}); labels ${report.image.labels.passed}/${report.image.labels.total}; non-product ${report.image.nonProduct.passed}/${report.image.nonProduct.total}`,
      `Image negatives the vision chooser accepted at or above its gate: ${report.image.negativesAboveGate.length ? report.image.negativesAboveGate.map(({ caseId, confidence }) => `${caseId} ${confidence}`).join(", ") : "none"}`,
      ...section("Image by scenario", report.image.byScenario),
    ] : []),
    `Known limitations (not scored): ${report.knownLimitations.length ? report.knownLimitations.map(({ caseId, passed }) => `${caseId} ${passed ? "passed" : "failed"}`).join(", ") : "none"}`,
    `Consistency: ${report.consistency.flipped.length} of ${report.consistency.cases} cases flipped over ${report.consistency.repeats} runs`,
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
