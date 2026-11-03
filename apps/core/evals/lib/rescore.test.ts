import { describe, expect, test } from "vitest";
import type { OrderLine } from "@core/evals/cases/schema";
import type { CaseRecord, ReadingRecord, StageFacts } from "@core/evals/lib/case-record";
import { messageRecord } from "@core/evals/lib/record-fixture";
import { buildReport } from "@core/evals/lib/report";
import { changeRowsOf, comparisonOf, formatComparison, rescoreArgumentsOf, rescoreFile, rescoreRecord } from "@core/evals/lib/rescore";

const meta = { runId: "run", startedAt: "", finishedAt: "", settings: {} };
const quote = (text: string) => ({ source: "current" as const, text });
const polo: OrderLine = { product: "polo-basico", variant: { Talla: "M", Color: "Negro" }, quantity: 1 };
const gorra: OrderLine = { product: "gorra-trucker", variant: { Color: "Negro" }, quantity: 1 };
const actualLine = (line: OrderLine, quantity = line.quantity) => ({ ...line, quantity, unitPrice: 50, mentionedPrice: null });

const intentStage = (kind: string) => ({ stage: "intent", reading: "primary", promptVersion: "v", errorCode: null, output: { stage: "intent", kind } });
const extractionStage = (requests: readonly object[]) => ({ stage: "extraction", reading: "primary", promptVersion: "v", errorCode: null, output: { stage: "extraction", requests } });
const resolutionStage = (values: readonly object[]) => ({ stage: "resolution", reading: "primary", promptVersion: "v", errorCode: null,
  output: { stage: "resolution", resolutions: [{ request: "r1", kind: "chosen", productId: "id", values }] } });
const reading = (stages: ReadingRecord["stages"], ...decisions: string[]): ReadingRecord =>
  ({ stages, decisions: decisions.map((decision) => ({ action: "add", risk: "low", agreement: "not_run", decision })) });

const staleFacts: StageFacts = { intent: false, fields: false, resolution: true, decision: false, decisionExpected: "silent", decisionActual: "urgent", requested: true, changeApplied: false, marked: false,
  point: false, noticed: false, orderMatches: false, changedNotice: false, readingMs: 321, queuedMs: 0, stageCostsUsd: { intent: 0.5 }, changedLines: 1, unmarkedLines: 1, silentLines: 1 };

/** An add of one black M polo that the reader applied right, with facts saved by an older scoring that got several of them wrong. */
const addedPolo = (over: Partial<CaseRecord> = {}): CaseRecord => messageRecord({
  caseId: "m1", expected: [{ notice: null, outcomes: ["added"], order: [{ ...polo, mentionedPrice: null }], stages: { fields: { quantity: "1", Talla: "M", Color: "Negro" } } }],
  actual: { outcomes: ["added"], notice: null, noticeProducts: [], order: [actualLine(polo)] }, facts: staleFacts,
  reading: reading([intentStage("requests"), extractionStage([{ request: "r1", kind: "add", quantity: null, price: null, values: [] }]),
    resolutionStage([{ attribute: "Color", value: "Negro", quote: quote("negro") }, { attribute: "Talla", value: "M", quote: quote("m") }])], "applied"), ...over });

describe("changeRowsOf", () => {
  test("an added line is a row with no line before, a removed one a row with no line after, a changed quantity one with both", () => {
    const rows = changeRowsOf([polo, gorra], [actualLine(polo, 3), actualLine({ ...polo, variant: { Talla: "L", Color: "Negro" } })]);

    expect(rows.map(({ before, after }) => [before === null ? null : (before as { quantity: number }).quantity, after === null ? null : (after as { quantity: number }).quantity]))
      .toEqual([[1, 3], [null, 1], [1, null]]);
  });

  test("an order that did not change leaves no row", () => {
    expect(changeRowsOf([polo], [actualLine(polo)])).toEqual([]);
  });

  test("an earlier price the record does not store is unknown, not none: a quantity change keeps the price it ends with", () => {
    const priced = { ...actualLine(polo, 2), mentionedPrice: { amount: 63, units: 1 } };

    const [row] = changeRowsOf([polo], [priced]);

    expect(row).toMatchObject({ before: { quantity: 1, mentionedPrice: { amount: { amount: 63 }, units: 1 } }, after: { quantity: 2, mentionedPrice: { amount: { amount: 63 }, units: 1 } } });
  });

  test("a price change on a line whose earlier price is unknown leaves no row, but a stored earlier price, or a price the message states, does", () => {
    const priced = { ...actualLine(polo), mentionedPrice: { amount: 63, units: 1 } };

    expect(changeRowsOf([polo], [priced])).toEqual([]);
    expect(changeRowsOf([{ ...polo, mentionedPrice: null }], [priced])).toHaveLength(1);
    expect(changeRowsOf([polo], [priced], { priceStated: true })).toHaveLength(1);
  });

  test("a removed line whose earlier price is unknown has the price of the line that replaces it: a variant change touches no price", () => {
    const priced = { ...actualLine({ ...polo, variant: { Talla: "L", Color: "Negro" } }), mentionedPrice: { amount: 63, units: 1 } };

    const removed = changeRowsOf([polo], [priced]).find(({ after }) => after === null)!;

    expect(removed.before).toMatchObject({ mentionedPrice: { amount: { amount: 63 }, units: 1 } });
    expect((changeRowsOf([polo], [priced], { priceStated: true }).find(({ after }) => after === null)!.before as { mentionedPrice: unknown }).mentionedPrice).toBeNull();
  });

  test("a product the earlier order stores as unknown is the null product of the actual order", () => {
    expect(changeRowsOf([{ ...polo, product: "unknown" as never }], [{ ...actualLine(polo), product: null }])).toEqual([]);
  });
});

describe("rescoreRecord", () => {
  test("recomputes every fact of the actual side from the stored trace, outcomes, notice and order", () => {
    const { record, kept } = rescoreRecord(addedPolo(), { hasReadings: true });

    expect(record.facts).toMatchObject({ intent: true, fields: true, decisionExpected: "applied", decisionActual: "applied", decision: true, requested: true, changeApplied: true, marked: false,
      noticed: false, orderMatches: true, changedLines: 1, unmarkedLines: 1, silentLines: 0 });
    expect(kept).toEqual([]);
  });

  test("keeps what depends on data a record does not hold: the resolved product, the timings and the costs", () => {
    const { record } = rescoreRecord(addedPolo(), { hasReadings: true });

    expect(record.facts).toMatchObject({ resolution: true, readingMs: 321, queuedMs: 0, stageCostsUsd: { intent: 0.5 } });
  });

  test("a silent-only step expects no request, and a request nobody answered is an ignored one", () => {
    const silent = addedPolo({ expected: [{ decision: "silent", notice: null, outcomes: ["no_intent"] }], actual: { outcomes: ["no_intent"], notice: null, noticeProducts: [], order: [] },
      reading: reading([intentStage("no_intent")]) });
    const lost = addedPolo({ actual: { outcomes: [], notice: null, noticeProducts: [], order: [] }, reading: reading([intentStage("requests")]) });

    expect(rescoreRecord(silent, { hasReadings: true }).record.facts).toMatchObject({ intent: true, requested: false });
    expect(rescoreRecord(lost, { hasReadings: true }).record.facts).toMatchObject({ requested: true, changeApplied: false, noticed: false, point: false });
  });

  test("a wrong line the reader applied with no mark and no notice is a silent change; a marked one is not", () => {
    const wrong = addedPolo({ actual: { outcomes: ["added"], notice: null, noticeProducts: [], order: [actualLine(polo, 4)] } });
    const marked = addedPolo({ actual: wrong.actual, facts: { ...staleFacts, unmarkedLines: 0 }, reading: reading([intentStage("requests")], "doubtful") });

    expect(rescoreRecord(wrong, { hasReadings: true }).record.facts).toMatchObject({ orderMatches: false, silentLines: 1, unmarkedLines: 1 });
    expect(rescoreRecord(marked, { hasReadings: true }).record.facts).toMatchObject({ marked: true, unmarkedLines: 0, silentLines: 0 });
  });

  test("a line the message did not touch does not count against it", () => {
    const record = addedPolo({ previousOrder: [gorra], expected: [{ notice: null, outcomes: ["added"], order: [{ ...polo, mentionedPrice: null }, { ...gorra, quantity: 2, mentionedPrice: null }] }],
      actual: { outcomes: ["added"], notice: null, noticeProducts: [], order: [actualLine(polo), actualLine(gorra)] } });

    expect(rescoreRecord(record, { hasReadings: true }).record.facts).toMatchObject({ changedLines: 1, silentLines: 0 });
  });

  test("the decision of both sides goes through one criterion: a pending's own point with an urgent notice is urgent on each", () => {
    const record = addedPolo({ expected: [{ notice: "not_clear", outcomes: ["pending_created", "not_clear"] }],
      actual: { outcomes: ["pending_created", "not_clear"], notice: "not_clear", noticeProducts: [], order: [] }, reading: reading([intentStage("requests")], "pending"),
      facts: { ...staleFacts, decisionExpected: "pending", decisionActual: "pending", decision: true, changedLines: 0, unmarkedLines: 0, silentLines: 0 } });

    expect(rescoreRecord(record, { hasReadings: true }).record.facts).toMatchObject({ decisionExpected: "urgent", decisionActual: "urgent", decision: true, noticed: true, point: true });
  });

  test("a run saved before the reading was kept keeps the stored facts and says so", () => {
    const old = addedPolo({ reading: undefined });

    const { record, kept } = rescoreRecord(old, { hasReadings: false });

    expect(record.facts).toMatchObject({ intent: false, fields: false, decisionActual: "urgent", silentLines: 1 });
    expect(record.facts!.decisionExpected).toBe("applied");
    expect(kept).toEqual(["facts"]);
  });

  test("in a run that kept readings, a message with no reading is one that read nothing: its outcomes give the facts", () => {
    const skipped = addedPolo({ reading: undefined, facts: { ...staleFacts, changedLines: 0, unmarkedLines: 0, silentLines: 0 }, actual: { outcomes: [], notice: null, noticeProducts: [], order: [] }, expected: [{ notice: null, outcomes: ["no_intent"] }] });

    const { record, kept } = rescoreRecord(skipped, { hasReadings: true });

    expect(record.facts).toMatchObject({ intent: false, decisionActual: "silent" });
    expect(kept).toEqual([]);
  });

  test("keeps the stored lines when the change rows cannot be rebuilt from the orders, and counts them", () => {
    const record = addedPolo({ facts: { ...staleFacts, changedLines: 3, unmarkedLines: 3, silentLines: 2 } });

    const { record: rescored, kept } = rescoreRecord(record, { hasReadings: true });

    expect(rescored.facts).toMatchObject({ changedLines: 3, unmarkedLines: 3, silentLines: 2, intent: true, decisionActual: "applied" });
    expect(kept).toEqual(["changedLines"]);
  });

  test("a quantity change on a line an earlier step priced is not judged on the price: the earlier price is not stored, so this message did not touch it", () => {
    const priced = { ...actualLine(polo, 2), mentionedPrice: { amount: 63, units: 1 } };
    const record = addedPolo({ previousOrder: [polo], expected: [{ notice: null, outcomes: ["quantity_changed"], order: [{ ...polo, quantity: 2, mentionedPrice: null }] }],
      actual: { outcomes: ["quantity_changed"], notice: null, noticeProducts: [], order: [priced] } });

    const { record: rescored, kept } = rescoreRecord(record, { hasReadings: true });

    expect(rescored.facts).toMatchObject({ changedLines: 1, silentLines: 0 });
    expect(kept).toEqual([]);
  });

  test("a variant change on a line an earlier step priced is not judged on the price either; one the message states is", () => {
    const lPolo: OrderLine = { ...polo, variant: { Talla: "L", Color: "Negro" } };
    const priced = { ...actualLine(lPolo), mentionedPrice: { amount: 63, units: 1 } };
    const record = addedPolo({ previousOrder: [polo], expected: [{ notice: null, outcomes: ["variant_changed"], order: [{ ...lPolo, mentionedPrice: null }] }],
      actual: { outcomes: ["variant_changed"], notice: null, noticeProducts: [], order: [priced] }, facts: { ...staleFacts, changedLines: 2, unmarkedLines: 2, silentLines: 1 } });
    const pricedRequest = { request: "r1", kind: "set_price", quantity: null, price: { amount: 63 }, values: [] };
    const stated = { ...record, reading: reading([intentStage("requests"), extractionStage([pricedRequest])], "applied") };

    const { record: rescored, kept } = rescoreRecord(record, { hasReadings: true });

    expect(rescored.facts).toMatchObject({ changedLines: 2, silentLines: 0 });
    expect(kept).toEqual([]);
    expect(rescoreRecord(stated, { hasReadings: true }).record.facts).toMatchObject({ changedLines: 2, silentLines: 1 });
  });

  test("a message that states a price and changes more than one priced line cannot say which line the price is for: the stored lines stay", () => {
    const priced = (line: OrderLine, quantity: number) => ({ ...actualLine(line, quantity), mentionedPrice: { amount: 63, units: 1 } });
    const pricedRequest = { request: "r1", kind: "set_price", quantity: null, price: { amount: 63 }, values: [] };
    const record = addedPolo({ previousOrder: [polo, gorra], expected: [{ notice: null, outcomes: ["mentioned_price_set"], order: [{ ...polo, mentionedPrice: null }, { ...gorra, quantity: 2, mentionedPrice: null }] }],
      actual: { outcomes: ["mentioned_price_set"], notice: null, noticeProducts: [], order: [priced(polo, 1), priced(gorra, 2)] }, facts: { ...staleFacts, changedLines: 2, unmarkedLines: 2, silentLines: 2 },
      reading: reading([intentStage("requests"), extractionStage([pricedRequest])], "applied") });

    const { record: rescored, kept } = rescoreRecord(record, { hasReadings: true });

    expect(rescored.facts).toMatchObject({ changedLines: 2, silentLines: 2 });
    expect(kept).toEqual(["changedLines"]);
  });

  test("a price change the stored data cannot place keeps the stored lines; one the message states is judged", () => {
    const priced = { ...actualLine(polo), mentionedPrice: { amount: 63, units: 1 } };
    const expected = [{ notice: null, outcomes: ["mentioned_price_set" as const], order: [{ ...polo, mentionedPrice: null }] }];
    const unplaced = addedPolo({ previousOrder: [polo], expected, actual: { outcomes: ["mentioned_price_set"], notice: null, noticeProducts: [], order: [priced] } });
    const pricedRequest = { request: "r1", kind: "set_price", quantity: null, price: { amount: 63 }, values: [] };
    const stated = { ...unplaced, reading: reading([intentStage("requests"), extractionStage([pricedRequest])], "applied") };

    expect(rescoreRecord(unplaced, { hasReadings: true }).kept).toEqual(["changedLines"]);
    const { record, kept } = rescoreRecord(stated, { hasReadings: true });
    expect(record.facts).toMatchObject({ changedLines: 1, silentLines: 1 });
    expect(kept).toEqual([]);
  });

  test("leaves an event record and a record with no facts alone, and counts a legacy record apart from the ones missing data", () => {
    const event = messageRecord({ caseId: "c#event1", conversationId: "c", event: { name: "report_payment", after: 1 }, expected: null, actual: { error: "x" } });
    const failed = messageRecord({ caseId: "c#2", conversationId: "c", step: 2, expected: [{ notice: null, outcomes: ["added"] }], actual: { error: "no order" } });
    const legacy = addedPolo({ facts: { ...staleFacts, decision: null, decisionActual: "silent" } });

    expect(rescoreRecord(event, { hasReadings: true })).toEqual({ record: event, kept: [] });
    expect(rescoreRecord(failed, { hasReadings: true })).toEqual({ record: failed, kept: [] });
    expect(rescoreRecord(legacy, { hasReadings: true }).kept).toEqual(["legacy"]);
  });
});

describe("rescoreFile", () => {
  const good = addedPolo();
  const bad = addedPolo({ caseId: "m2", actual: { outcomes: ["added"], notice: null, noticeProducts: [], order: [actualLine(polo, 4)] }, facts: staleFacts });
  const file = { report: buildReport([good, bad], meta), records: [good, bad] };

  test("scores the whole report again, leaves the input as it was and counts what it kept", () => {
    const before = structuredClone(file);

    const { result, kept } = rescoreFile(file);

    expect(file).toEqual(before);
    expect(result.report.runs.metrics.silentWrongChanges).toMatchObject({ mean: 1 });
    expect(result.report.runs.metrics.intentAccuracy).toMatchObject({ mean: 1 });
    expect(kept).toEqual({ messages: 2, facts: 0, legacy: 0, changedLines: 0, withoutFacts: 0 });
  });

  test("a run with no reading at all keeps every stored fact, and the count says so", () => {
    const old = [good, bad].map((record) => ({ ...record, reading: undefined }));

    const { kept, result } = rescoreFile({ report: buildReport(old, meta), records: old });

    expect(kept).toEqual({ messages: 2, facts: 2, legacy: 0, changedLines: 0, withoutFacts: 0 });
    expect(result.report.runs.metrics.intentAccuracy).toMatchObject({ mean: 0 });
  });
});

describe("rescoreFile and the legacy baseline", () => {
  test("legacy records are counted apart, not as records missing data", () => {
    const legacy = addedPolo({ caseId: "l", facts: { ...staleFacts, decision: null, decisionActual: "silent" } });

    const { kept } = rescoreFile({ report: buildReport([legacy, addedPolo({ caseId: "g" })], meta), records: [legacy, addedPolo({ caseId: "g" })] });

    expect(kept).toEqual({ messages: 2, facts: 0, legacy: 1, changedLines: 0, withoutFacts: 0 });
    expect(formatComparison([], kept)).toContain("1 legacy baseline");
  });
});

describe("the arguments of the command", () => {
  const dir = "/repo/apps/core/eval-results";

  test("the run alone gets the default output under the results folder, beside no input", () => {
    expect(rescoreArgumentsOf(["/x/run-1.json"], dir)).toEqual({ input: "/x/run-1.json", target: "/repo/apps/core/eval-results/run-1.rescored.json" });
  });

  test("--out gives the target whichever side of the run it is on", () => {
    expect(rescoreArgumentsOf(["/x/run.json", "--out", "/y/z.json"], dir)).toEqual({ input: "/x/run.json", target: "/y/z.json" });
    expect(rescoreArgumentsOf(["--out", "/y/z.json", "/x/run.json"], dir)).toEqual({ input: "/x/run.json", target: "/y/z.json" });
  });

  test("a missing path after --out, no run, two runs and an --out that is the input are errors", () => {
    expect(rescoreArgumentsOf(["/x/run.json", "--out"], dir)).toMatchObject({ error: expect.stringContaining("--out") });
    expect(rescoreArgumentsOf([], dir)).toMatchObject({ error: expect.stringContaining("Usage") });
    expect(rescoreArgumentsOf(["/x/a.json", "/x/b.json"], dir)).toMatchObject({ error: expect.stringContaining("Usage") });
    expect(rescoreArgumentsOf(["/x/run.json", "--out", "/x/run.json"], dir)).toMatchObject({ error: expect.stringContaining("never overwritten") });
  });
});

describe("the before and after table", () => {
  const stale = [addedPolo({ caseId: "a" }), addedPolo({ caseId: "b", repeat: 1 })];
  const file = { report: buildReport(stale, meta), records: stale };

  test("has one row per audited metric, the stored report before and the recomputation after", () => {
    const { result } = rescoreFile(file);
    const rows = comparisonOf(file.report, result.report, { stored: file.records, rescored: result.records });

    expect(rows.map(({ metric }) => metric)).toEqual(["false urgent share", "false urgent share without the impossible labels", "false urgent share without carried failures (cascades)", "false urgent share without both", "false urgent share if «listo» with pendings counted as urgent (what-if)", "urgent recall", "urgent recall if «listo» with pendings counted as urgent (what-if)", "urgent precision", "silent wrong changes per run", "silent wrong changes per run without cascades", "ignored requests per run",
      "intent precision (intentAccuracy)", "variant and quantity (fields accuracy)", "stage fields, strict (a between never passes)", "stage fields: messages with a between per run", "final order variant", "final order quantity", "resolution accuracy", "decision accuracy", "end-to-end = overall accuracy: mean", "end-to-end = overall accuracy: range", "end-to-end without cascades: mean", "end-to-end without cascades: range", "end_to_end pass only: mean", "end_to_end pass only: range",
      "conversation failures own", "conversation failures carried"]);
    const intent = rows.find(({ metric }) => metric.startsWith("intent"))!;
    expect(intent).toMatchObject({ before: "0.0% (min 0.0%, max 0.0%)", after: "100.0% (min 100.0%, max 100.0%)" });
  });

  test("the order-level variant and quantity are the mean and range over all runs, the before from the stored records and their stored scores", () => {
    const run = (repeat: number, quantity: boolean) => addedPolo({ caseId: `o${repeat}`, repeat, fields: { variant: true, quantity } });
    const stored = [run(0, true), run(1, false)];
    const rescored = [run(0, true), run(1, true)];

    const rows = comparisonOf(buildReport(stored, meta), buildReport(rescored, meta), { stored, rescored });

    expect(rows.find(({ metric }) => metric === "final order variant")).toMatchObject({ before: "100.0% (min 100.0%, max 100.0%)", after: "100.0% (min 100.0%, max 100.0%)" });
    expect(rows.find(({ metric }) => metric === "final order quantity")).toMatchObject({ before: "50.0% (min 0.0%, max 100.0%)", after: "100.0% (min 100.0%, max 100.0%)" });
    expect(rows.find(({ metric }) => metric === "final order quantity")!.note).toContain("stored records");
  });

  test("an older report shows what it stored (the end-to-end of its first run, labelled) and counts the rest from its stored records, and says so", () => {
    const e2e = [addedPolo({ caseId: "e", pass: "end_to_end", passed: true }), addedPolo({ caseId: "e", pass: "end_to_end", repeat: 1, passed: false })];
    const report = buildReport(e2e, meta);
    const old = { ...report, endToEnd: { photo: report.endToEnd.photo, text: report.endToEnd.text } as never, conversationSteps: undefined as never,
      byPass: { end_to_end: { total: 1, passed: 1, accuracy: 1 } } };

    const rows = comparisonOf(old, report, { stored: e2e, rescored: e2e });

    expect(rows.find(({ metric }) => metric === "end_to_end pass only: mean")).toMatchObject({ before: "100.0% (stored report: first run only)", after: "50.0%" });
    expect(rows.find(({ metric }) => metric === "end_to_end pass only: range")).toMatchObject({ before: "n/a in stored report; recount with stored scores: 0.0%–100.0%", after: "0.0%–100.0%" });
    expect(rows.find(({ metric }) => metric === "conversation failures own")).toMatchObject({ before: "n/a in stored report; recount with stored scores: 0", after: "0" });
  });

  test("the audited end-to-end is the overall accuracy: an older report's first-run figure is labelled, and the comparable before is a recount with its stored scores", () => {
    const step = (number: number, passed: boolean, repeat: number) => addedPolo({ caseId: `c#${number}`, pass: "conversation", conversationId: "c", step: number, passed, repeat });
    const stored = [addedPolo({ caseId: "a", passed: true }), step(1, false, 0), step(2, false, 0), addedPolo({ caseId: "a", passed: true, repeat: 1 }), step(1, true, 1), step(2, true, 1)];
    const report = buildReport(stored, meta);
    const old = { ...report, overallRuns: undefined as never };

    const rows = comparisonOf(old, report, { stored, rescored: stored });
    const row = (metric: string) => rows.find((candidate) => candidate.metric === metric)!;

    expect(row("end-to-end = overall accuracy: mean")).toMatchObject({
      before: "66.7% (recount with stored scores, over 2 runs; 33.3% (1/3), stored report: repeat 0 only)", after: "66.7%" });
    expect(row("end-to-end = overall accuracy: range")).toMatchObject({ before: "33.3%–100.0% (recount with stored scores, over 2 runs; 33.3% (1/3), stored report: repeat 0 only)", after: "33.3%–100.0%" });
    expect(row("end-to-end without cascades: mean")).toMatchObject({ before: "75.0% (recount with stored scores, over 2 runs)", after: "75.0%" });
    expect(row("end-to-end without cascades: range")).toMatchObject({ before: "50.0%–100.0% (recount with stored scores, over 2 runs)", after: "50.0%–100.0%" });
  });

  test("a report that already holds the overall runs is shown as stored, and one with no records only has its first run", () => {
    const records = [addedPolo({ caseId: "a", passed: true }), addedPolo({ caseId: "b", passed: false, repeat: 1 })];
    const report = buildReport(records, meta);
    expect(comparisonOf(report, report).find(({ metric }) => metric === "end-to-end = overall accuracy: mean")).toMatchObject({ before: "50.0%", after: "50.0%" });
    const old = { ...report, overallRuns: undefined as never };
    expect(comparisonOf(old, report).find(({ metric }) => metric === "end-to-end = overall accuracy: mean")!.before).toBe("100.0% (1/1), stored report: repeat 0 only");
  });

  test("prints aggregates only: no case id and no input", () => {
    const secret = addedPolo({ caseId: "secret-case", input: "text «numero privado»" });
    const text = formatComparison(comparisonOf(buildReport([secret], meta), buildReport([secret], meta)), { messages: 1, facts: 0, legacy: 0, changedLines: 0, withoutFacts: 0 });

    expect(text).not.toContain("secret-case");
    expect(text).not.toContain("privado");
    expect(text).toContain("false urgent share");
  });
});
