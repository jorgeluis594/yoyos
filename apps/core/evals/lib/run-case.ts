import { productById, describeVariantId, type ProductKey } from "@core/evals/fixtures/catalog";
import { needsJudge, type EvalCase, type ImageCase, type MessageCase, type TextCase } from "@core/evals/cases/schema";
import type { Claude, JudgeVerdict } from "@core/evals/lib/claude";
import { appendRecord, type CaseRecord } from "@core/evals/lib/case-record";
import { metered, type ModelCall } from "@core/evals/lib/model-meter";
import { itemCertainties, observing, type AppliedMessage, type ProductionPath } from "@core/evals/lib/production";
import { readFixtureImage } from "@core/evals/lib/eval-catalog";
import { noticeErrorOf, scoreImage, scoreMessage, scoreText, type ImageActual, type MessageActual, type Scored, type TextActual } from "@core/evals/lib/scorers";
import type { OutcomeKind } from "@core/evals/cases/schema";

/** Runs one case through the production path, scores it, asks the judge when the case allows several answers, and records it. */

const keyOf = (productId: string): ProductKey | null => productById(productId)?.key ?? null;

export function messageActualOf(applied: AppliedMessage): Readonly<MessageActual & { error: string | null }> {
  const order = applied.order ?? [];
  if (!applied.result.success) return { tools: [], outcomes: ["failed"], order, error: applied.result.error.code };
  const outcome = applied.result.data;
  if (outcome.kind === "skipped") return { tools: [], outcomes: [], order, error: null };
  if (outcome.kind === "already_processed") return { tools: [], outcomes: ["failed"], order, error: "ALREADY_PROCESSED" };
  return { tools: outcome.trace.tools, outcomes: outcome.outcomes.map(({ kind }) => kind as OutcomeKind), order, error: null };
}

const describeOrder = (order: MessageActual["order"]) => order.map((line) =>
  `${line.product ?? "?"}[${Object.values(line.variant).join(" ")}]x${line.quantity}${line.mentionedPrice ? `@${line.mentionedPrice.amount}/${line.mentionedPrice.units}` : ""}`).sort().join(",");

const messageSignature = (actual: MessageActual) => `${[...actual.tools].sort().join("+")}|${[...actual.outcomes].sort().join("+")}|${describeOrder(actual.order)}`;

function describeInput(testCase: EvalCase): string {
  if (testCase.pass === "text") return `mention «${testCase.input.mention}»${testCase.input.priceHint ? ` price ${testCase.input.priceHint}` : ""}`;
  if (testCase.pass === "image") return `photo ${testCase.input.file}`;
  const { input } = testCase;
  const photo = input.photo ? ("file" in input.photo ? `photo ${input.photo.file}` : `photo showing ${input.photo.shows}${"label" in input.photo && input.photo.label ? " (QR label)" : ""}`) : "";
  const order = input.order.length ? ` | order: ${input.order.map((line) => `${line.product}[${Object.values(line.variant).join(" ")}]x${line.quantity}`).join(", ")}` : "";
  return `${input.text !== undefined ? `text «${input.text}»` : `${photo}${input.caption ? ` caption «${input.caption}»` : ""}`}${order}`;
}

type Evaluated = Readonly<{
  actual: unknown; scored: Scored; signature: string; noticeError: CaseRecord["noticeError"]; error: string | null;
  /** The scored model step alone (setup excluded), and the attempts it took. */
  latencyMs: number; attempts: number;
  /** The tools that ran, whose item choices count as certainties. */
  tools: readonly string[];
}>;

/** Times one step of a case. */
async function timed<T>(work: () => Promise<T>): Promise<Readonly<{ value: T; latencyMs: number }>> {
  const started = performance.now();
  const value = await work();
  return { value, latencyMs: Math.round(performance.now() - started) };
}

function judgePrompt(testCase: EvalCase, actual: unknown): string {
  return JSON.stringify({
    case: testCase.id,
    pass: testCase.pass,
    buyerMessage: describeInput(testCase),
    note: testCase.ambiguous ?? "Several outcomes are acceptable.",
    acceptableOutcomes: testCase.expected,
    actualResult: actual,
  }, null, 2);
}

export type RunCaseContext = Readonly<{ runId: string; path: ProductionPath; claude: Claude }>;

async function record(context: RunCaseContext, testCase: EvalCase, repeat: number, evaluate: () => Promise<Evaluated>): Promise<CaseRecord> {
  const started = performance.now();
  // A thrown case (a harness or infrastructure failure) is recorded as failed rather than dropped from the report.
  const { value: observed, calls } = await metered("system", () => observing(() => evaluate().catch((cause: unknown): Evaluated => {
    const error = cause instanceof Error ? cause.message : String(cause);
    return { actual: { error }, scored: { passed: false, fields: {}, expectationIndex: 0 }, signature: "error", noticeError: null, error,
      latencyMs: Math.round(performance.now() - started), attempts: 1, tools: [] };
  })));
  const { actual, scored, signature, noticeError, error, latencyMs, attempts, tools } = observed.value;
  const { observation } = observed;
  let judge: JudgeVerdict | null = null;
  let judgeCalls: readonly ModelCall[] = [];
  if (needsJudge(testCase) && repeat === 0) {
    const judged = await metered("judge", () => context.claude.judge(judgePrompt(testCase, actual)));
    judge = judged.value;
    judgeCalls = judged.calls;
  }
  // A case marked ambiguous passes when the exact match or the judge accepts it; a plain set of acceptable answers needs the exact match.
  const passed = scored.passed || (testCase.ambiguous !== undefined && judge?.pass === true && scored.fields.unitPrice !== false);
  const entry: CaseRecord = {
    caseId: testCase.id, baseId: testCase.paraphraseOf ?? testCase.id, pass: testCase.pass, criterion: testCase.criterion, kind: testCase.kind, tags: testCase.tags,
    repeat, passed, exactPassed: scored.passed, fields: scored.fields, expectationIndex: scored.expectationIndex, judge, noticeError,
    expectedTool: testCase.pass === "interpretation" || testCase.pass === "end_to_end" ? (testCase.expected[0]?.tools?.join("+") || "-") : "-",
    input: describeInput(testCase), expected: testCase.expected, actual, signature,
    certainties: [...observation.certainties, ...itemCertainties(observation.decisions.at(-1), tools)],
    trace: { decisions: observation.decisions, extracted: observation.extracted, textChoices: observation.textChoices },
    latencyMs, retries: attempts - 1, calls: [...calls, ...judgeCalls], error,
  };
  await appendRecord(context.runId, entry);
  return entry;
}

export function runMessageCase(context: RunCaseContext, testCase: MessageCase, repeat: number): Promise<CaseRecord> {
  return record(context, testCase, repeat, async () => {
    const applied = await context.path.applyMessage(testCase.input, testCase.pass === "interpretation" ? "fixed" : "real");
    const actual = messageActualOf(applied);
    const scored = scoreMessage(actual, testCase.expected, testCase.input.order);
    const expected = testCase.expected[scored.expectationIndex]!;
    return { actual: { ...actual, attempts: applied.attempts }, scored, signature: messageSignature(actual),
      noticeError: noticeErrorOf(scored.passed, expected.outcomes, actual.outcomes), error: actual.error,
      latencyMs: applied.latencyMs, attempts: applied.attempts, tools: actual.tools };
  });
}

export function runTextCase(context: RunCaseContext, testCase: TextCase, repeat: number): Promise<CaseRecord> {
  return record(context, testCase, repeat, async () => {
    const { value: identified, latencyMs } = await timed(() => context.path.identifyText(testCase.input.mention, testCase.input.priceHint));
    const first = identified.success ? identified.data[0] : undefined;
    const actual: TextActual = !identified.success ? { kind: "error", code: identified.error.code }
      : !first ? { kind: "error", code: "NO_RESULT" }
        : first.kind === "found" ? { kind: "found", product: keyOf(first.productId) }
          : first.kind === "not_clear" ? { kind: "not_clear", products: first.candidates.map(({ productId }) => keyOf(productId)) }
            : { kind: "not_found" };
    const scored = scoreText(actual, testCase.expected);
    const signature = actual.kind === "found" ? `found:${actual.product}` : actual.kind === "not_clear" ? `not_clear:${[...actual.products].sort().join("+")}` : actual.kind;
    return { actual, scored, signature, noticeError: null, error: actual.kind === "error" ? actual.code : null, latencyMs, attempts: 1, tools: [] };
  });
}

export function runImageCase(context: RunCaseContext, testCase: ImageCase, repeat: number): Promise<CaseRecord> {
  return record(context, testCase, repeat, async () => {
    const image = await readFixtureImage(testCase.input.file);
    const { value: identified, latencyMs } = await timed(() => context.path.identifyImage(image));
    const data = identified.success ? identified.data : null;
    const labelled = (variantIds: readonly string[]): ImageActual => {
      const read = variantIds.map(describeVariantId);
      return { kind: "found", products: read.map((variant) => variant?.product ?? null), colors: read.map((variant) => variant?.attributes.Color ?? null) };
    };
    const actual: ImageActual = !data ? { kind: "error", code: identified.success ? "NO_RESULT" : identified.error.code }
      : data.kind === "found" ? (data.method === "qr" ? labelled(data.items.map(({ variantId }) => variantId)) : { kind: "found", products: [keyOf(data.productId)], colors: [null] })
        : data.kind === "not_found" ? { kind: "not_found", reason: data.reason } : { kind: "not_product" };
    const scored = scoreImage(actual, testCase.expected);
    const signature = actual.kind === "found" ? `found:${actual.products.join("+")}` : actual.kind;
    const method = data?.kind === "found" ? data.method : null;
    return { actual: { ...actual, method }, scored, signature, noticeError: null, error: actual.kind === "error" ? actual.code : null, latencyMs, attempts: 1, tools: [] };
  });
}
