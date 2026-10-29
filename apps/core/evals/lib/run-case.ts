import { chooseSellerNotice } from "@core/src/features/orders/domain/seller-notice";
import { productById, describeVariantId, type CatalogScope } from "@core/evals/fixtures/catalog";
import { isMessageStep, needsJudge, type ConversationCase, type EvalCase, type ImageCase, type MessageCase, type MessageInput, type OrderLine, type OutcomeKind } from "@core/evals/cases/schema";
import type { Claude, JudgeVerdict } from "@core/evals/lib/claude";
import { appendRecord, type CaseRecord } from "@core/evals/lib/case-record";
import { metered, type ModelCall } from "@core/evals/lib/model-meter";
import { observing, type AppliedMessage, type Observation, type ProductionPath } from "@core/evals/lib/production";
import { readFixtureImage } from "@core/evals/lib/eval-catalog";
import { scoreImage, scoreMessage, type ImageActual, type MessageActual, type MessageScored, type Scored } from "@core/evals/lib/scorers";

/** Runs one case through the production path, scores it, asks the judge when the case allows several answers, and records it. */

const keyOf = (productId: string): string | null => productById(productId)?.key ?? null;

/** The products a notice names, whatever its kind: the keys `productId`, `namedProductId` and `productIds` hold (notices of the reader add more kinds). */
export function noticeProductsOf(notice: object | null): readonly string[] {
  if (!notice) return [];
  const data = notice as Record<string, unknown>;
  const ids = [data.productId, data.namedProductId, ...(Array.isArray(data.productIds) ? data.productIds : [])].filter((id): id is string => typeof id === "string");
  return [...new Set(ids.map((id) => keyOf(id) ?? id))];
}

export function messageActualOf(applied: AppliedMessage): Readonly<MessageActual & { error: string | null }> {
  const order = applied.order ?? [];
  if (!applied.result.success) return { outcomes: ["failed"], notice: "failed", noticeProducts: [], order, error: applied.result.error.code };
  const outcome = applied.result.data;
  if (outcome.kind === "skipped") return { outcomes: [], notice: null, noticeProducts: [], order, error: null };
  if (outcome.kind === "already_processed") return { outcomes: ["failed"], notice: "failed", noticeProducts: [], order, error: "ALREADY_PROCESSED" };
  const notice = chooseSellerNotice(outcome.outcomes);
  return { outcomes: outcome.outcomes.map(({ kind }) => kind as OutcomeKind), notice: notice?.kind ?? null, noticeProducts: noticeProductsOf(notice), order, error: null };
}

const describeOrder = (order: MessageActual["order"]) => order.map((line) =>
  `${line.product ?? "?"}[${Object.values(line.variant).join(" ")}]x${line.quantity}${line.mentionedPrice ? `@${line.mentionedPrice.amount}/${line.mentionedPrice.units}` : ""}`).sort().join(",");

const messageSignature = (actual: MessageActual) => `${actual.notice ?? "-"}|${[...actual.outcomes].sort().join("+")}|${describeOrder(actual.order)}`;

const messageKindOf = (input: Pick<MessageInput, "text" | "photo" | "caption">): NonNullable<CaseRecord["messageKind"]> =>
  input.photo === undefined ? "text" : input.caption ? "photo_caption" : "photo";

function describeMessage(input: Pick<MessageInput, "text" | "photo" | "caption">): string {
  const photo = input.photo ? ("file" in input.photo ? `photo ${input.photo.file}` : `photo showing ${input.photo.shows}${"label" in input.photo && input.photo.label ? " (QR label)" : ""}`) : "";
  return input.text !== undefined ? `text «${input.text}»` : `${photo}${input.caption ? ` caption «${input.caption}»` : ""}`;
}

function describeInput(testCase: EvalCase): string {
  if (testCase.pass === "image") return `photo ${testCase.input.file}`;
  if (testCase.pass === "conversation") return `conversation of ${testCase.steps.filter(isMessageStep).length} messages`;
  const { input } = testCase;
  const order = input.order.length ? ` | order: ${input.order.map((line) => `${line.product}[${Object.values(line.variant).join(" ")}]x${line.quantity}`).join(", ")}` : "";
  return `${describeMessage(input)}${order}`;
}

type Evaluated = Readonly<{
  actual: unknown; scored: Scored | MessageScored; signature: string; error: string | null;
  /** The scored model step alone (setup excluded), and the attempts it took. */
  latencyMs: number; attempts: number;
  /** Set for message passes and conversation messages. */
  message?: Readonly<{ kind: NonNullable<CaseRecord["messageKind"]>; noticeProducts: readonly string[]; previousOrder: readonly OrderLine[]; expectsRepeatNotice: boolean;
    conversationId: string | null; step: number | null; expected: unknown; input: string }>;
}>;

/** Times one step of a case. */
async function timed<T>(work: () => Promise<T>): Promise<Readonly<{ value: T; latencyMs: number }>> {
  const started = performance.now();
  const value = await work();
  return { value, latencyMs: Math.round(performance.now() - started) };
}

function judgePrompt(testCase: Exclude<EvalCase, ConversationCase>, actual: unknown): string {
  return JSON.stringify({
    case: testCase.id,
    pass: testCase.pass,
    buyerMessage: describeInput(testCase),
    note: testCase.ambiguous ?? "Several outcomes are acceptable.",
    acceptableOutcomes: testCase.expected,
    actualResult: actual,
  }, null, 2);
}

export type RunCaseContext = Readonly<{ runId: string; path: ProductionPath; claude: Claude; scope: CatalogScope }>;

const isMessageScored = (scored: Scored | MessageScored): scored is MessageScored => "ignoredActions" in scored;

function entryOf(testCase: Readonly<{ id: string; kind: string; tags: readonly string[]; pass: CaseRecord["pass"]; paraphraseOf?: string }>, criterion: number, repeat: number,
  evaluated: Evaluated, observation: Observation, calls: readonly ModelCall[], judge: JudgeVerdict | null, passed: boolean, caseId = testCase.id): CaseRecord {
  const { scored, message } = evaluated;
  const flags = isMessageScored(scored) ? scored : null;
  return {
    caseId, baseId: message?.conversationId ?? testCase.paraphraseOf ?? testCase.id, pass: testCase.pass, criterion, kind: testCase.kind, tags: testCase.tags, repeat,
    passed, exactPassed: scored.passed, fields: scored.fields, expectationIndex: scored.expectationIndex, judge,
    messageKind: message?.kind ?? null, conversationId: message?.conversationId ?? null, step: message?.step ?? null,
    ignoredActions: flags?.ignoredActions ?? 0, wrongSilentChange: flags?.wrongSilentChange ?? false, extraNotice: flags?.extraNotice ?? false, expectedSilent: flags?.expectedSilent ?? false,
    noticeProducts: message?.noticeProducts ?? [], expectsRepeatNotice: message?.expectsRepeatNotice ?? false, previousOrder: message?.previousOrder ?? [],
    input: message?.input ?? "", expected: message?.expected ?? null, actual: evaluated.actual, signature: evaluated.signature,
    certainties: observation.certainties, latencyMs: evaluated.latencyMs, retries: evaluated.attempts - 1, calls, error: evaluated.error,
  };
}

const failedEvaluation = (cause: unknown, started: number): Evaluated => {
  const error = cause instanceof Error ? cause.message : String(cause);
  return { actual: { error }, scored: { passed: false, fields: {}, expectationIndex: 0 }, signature: "error", error, latencyMs: Math.round(performance.now() - started), attempts: 1 };
};

async function record(context: RunCaseContext, testCase: Exclude<EvalCase, ConversationCase>, repeat: number, evaluate: () => Promise<Evaluated>): Promise<CaseRecord> {
  const started = performance.now();
  // A thrown case (a harness or infrastructure failure) is recorded as failed rather than dropped from the report.
  const { value: observed, calls } = await metered("system", () => observing(() => evaluate().catch((cause: unknown) => failedEvaluation(cause, started))));
  const evaluated = observed.value;
  let judge: JudgeVerdict | null = null;
  let judgeCalls: readonly ModelCall[] = [];
  if (needsJudge(testCase) && repeat === 0) {
    const judged = await metered("judge", () => context.claude.judge(judgePrompt(testCase, evaluated.actual)));
    judge = judged.value;
    judgeCalls = judged.calls;
  }
  // A case marked ambiguous passes when the exact match or the judge accepts it; a plain set of acceptable answers needs the exact match.
  const ambiguous = "ambiguous" in testCase ? testCase.ambiguous : undefined;
  const passed = evaluated.scored.passed || (ambiguous !== undefined && judge?.pass === true && evaluated.scored.fields.unitPrice !== false);
  const entry = entryOf(testCase, testCase.criterion, repeat, evaluated, observed.observation, [...calls, ...judgeCalls], judge, passed);
  const complete = evaluated.message ? entry : { ...entry, input: describeInput(testCase), expected: testCase.expected };
  await appendRecord(context.runId, complete);
  return complete;
}

const lineOf = (line: Readonly<{ product: string | null; variant: Readonly<Record<string, string>>; quantity: number }>): OrderLine =>
  ({ product: line.product ?? "unknown", variant: line.variant, quantity: line.quantity });

export function runMessageCase(context: RunCaseContext, testCase: MessageCase, repeat: number): Promise<CaseRecord> {
  return record(context, testCase, repeat, async () => {
    const applied = await context.path.applyMessage(testCase.input, testCase.pass === "interpretation" ? "fixed" : "real", context.scope);
    const actual = messageActualOf(applied);
    const scored = scoreMessage(actual, testCase.expected, testCase.input.order, context.scope);
    return { actual: { ...actual, attempts: applied.attempts }, scored, signature: messageSignature(actual), error: actual.error, latencyMs: applied.latencyMs, attempts: applied.attempts,
      message: { kind: messageKindOf(testCase.input), noticeProducts: actual.noticeProducts, previousOrder: testCase.input.order, expectsRepeatNotice: false,
        conversationId: null, step: null, expected: testCase.expected, input: describeInput(testCase) } };
  });
}

/**
 * Runs a conversation and leaves one record per message, with the conversation id. A message the conversation never reached (an
 * earlier step threw) is recorded as failed, so a broken run cannot look like fewer messages.
 */
export async function runConversationCase(context: RunCaseContext, testCase: ConversationCase, repeat: number): Promise<readonly CaseRecord[]> {
  const messages = testCase.steps.filter(isMessageStep);
  const { results, error } = await context.path.applyConversation(testCase.steps, context.scope);
  const records: CaseRecord[] = [];
  for (const [index, step] of messages.entries()) {
    const number = index + 1;
    const caseId = `${testCase.id}#${number}`;
    const done = results[index];
    const base = { conversationId: testCase.id, step: number, expected: [step.expected], input: describeMessage(step.input), kind: messageKindOf(step.input), expectsRepeatNotice: step.expectsRepeatNotice === true };
    if (!done) {
      const evaluated = failedEvaluation(error ?? new Error("The conversation stopped before this message"), performance.now());
      records.push(entryOf({ ...testCase, id: testCase.id }, 0, repeat, { ...evaluated, message: { ...base, noticeProducts: [], previousOrder: [] } }, { certainties: [] }, [], null, false, caseId));
    } else {
      const { applied, previousOrder, observation, calls } = done.result;
      const actual = messageActualOf(applied);
      const before = previousOrder.map(lineOf);
      const scored = scoreMessage(actual, [step.expected], before, context.scope);
      const evaluated: Evaluated = { actual: { ...actual, attempts: applied.attempts }, scored, signature: messageSignature(actual), error: actual.error, latencyMs: applied.latencyMs,
        attempts: applied.attempts, message: { ...base, noticeProducts: actual.noticeProducts, previousOrder: before } };
      records.push(entryOf(testCase, 0, repeat, evaluated, observation, calls, null, scored.passed, caseId));
    }
  }
  for (const entry of records) await appendRecord(context.runId, entry);
  return records;
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
    return { actual: { ...actual, method }, scored, signature, error: actual.kind === "error" ? actual.code : null, latencyMs, attempts: 1 };
  });
}
