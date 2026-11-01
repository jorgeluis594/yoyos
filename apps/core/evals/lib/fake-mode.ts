import { isMessageStep, type EvalCase, type ImageCase, type MessageExpectation, type MessageInput } from "@core/evals/cases/schema";
import { appendRecord, type CaseRecord } from "@core/evals/lib/case-record";
import { runsOf } from "@core/evals/lib/runs";
import { readerCasesOf } from "@core/evals/lib/run-selection";
import { expectedStagesOf, scoreStages, type StageAnswer } from "@core/evals/lib/stage-facts";
import { legacyAnswerOf } from "@core/evals/lib/staged-answer";
import type { EvalEnv } from "@core/evals/lib/eval-env";

/**
 * Fake mode (`EVAL_MODELS=fake`): every stage answers what the case expects, so the harness runs end to end with no key, no database and no model call.
 * It proves the plumbing (runs, scoring, metrics, report), not the models. The timings and costs are scripted from the latency and cost budget of the
 * design (6.9) with a small deterministic spread per case and per run, so the ranges of a fake report are not all zero-width.
 */

/** Scripted cost of each stage of a text message in US$ (technical design 6.9) and of a photo message's cascade. */
const scriptedStageCostsUsd = { intent: 0.00034, extraction: 0.00047, resolution: 0.00035 } as const;
const scriptedPhotoCostsUsd = { photo_qr: 0.0002, photo_visual: 0.0008 } as const;

const spread = (id: string, repeat: number): number => ([...id].reduce((total, char) => (total * 31 + char.charCodeAt(0)) % 997, 7) + repeat * 13) % 400;

function hasPhoto(input: MessageInput | Readonly<{ photo?: unknown }>): boolean {
  return input.photo !== undefined;
}

type Reader = EvalEnv["EVAL_READER"];
/** Scripted cost of the legacy reader's single call (the reference cost of paid-gate.ts). */
const scriptedLegacyCostUsd = 0.0011;

/** The legacy baseline in fake mode: the single call answers the expected intent, as the shadow reads it (lib/staged-answer.ts `legacyAnswerOf`). */
function scriptedLegacyAnswer(expectation: MessageExpectation, id: string, repeat: number): StageAnswer {
  const expected = expectedStagesOf(expectation);
  const answer = expected.intent === "requests" ? "actions" : expected.intent === "no_intent" ? "no_intent" : "doubt";
  return legacyAnswerOf({ shadow: { answer, actionKinds: answer === "actions" ? ["add"] : [], usage: null, costUsd: scriptedLegacyCostUsd }, expected, latencyMs: 2000 + spread(id, repeat) * 3 });
}

function scriptedAnswer(expectation: MessageExpectation, photo: boolean, id: string, repeat: number, reader: Reader = "staged"): StageAnswer {
  if (reader === "legacy") return scriptedLegacyAnswer(expectation, id, repeat);
  const expected = expectedStagesOf(expectation);
  const decision = expected.decision;
  return {
    intent: expected.intent, fields: expected.fields, product: expected.product, decision,
    changeApplied: decision === "applied" || decision === "doubtful", marked: decision === "doubtful", point: decision === "pending", noticed: decision === "urgent" || decision === "notice",
    changedNotice: false, orderMatches: expectation.order !== undefined ? true : null,
    readingMs: 3000 + spread(id, repeat) * 5, queuedMs: 0,
    stageCostsUsd: photo ? { ...scriptedStageCostsUsd, ...scriptedPhotoCostsUsd } : scriptedStageCostsUsd,
  };
}

const base = (testCase: EvalCase, repeat: number): Omit<CaseRecord, "caseId" | "expected" | "actual" | "signature" | "input" | "messageKind" | "conversationId" | "step" | "facts" | "pass" | "fields"> => ({
  baseId: testCase.paraphraseOf ?? testCase.id, criterion: testCase.pass === "conversation" ? 0 : testCase.criterion, kind: testCase.kind, tags: testCase.tags, repeat,
  passed: true, exactPassed: true, expectationIndex: 0, judge: null, ignoredActions: 0, wrongSilentChange: false, extraNotice: false, expectedSilent: false,
  noticeProducts: [], expectsRepeatNotice: false, previousOrder: [], certainties: [], latencyMs: 0, retries: 0, calls: [], error: null,
});

function messageRecordOf(testCase: EvalCase, repeat: number, expectation: MessageExpectation, input: MessageInput | Readonly<{ photo?: unknown; caption?: string; text?: string }>,
  extra: Readonly<{ caseId: string; conversationId: string | null; step: number | null; expectsRepeatNotice?: boolean; reader: Reader }>): CaseRecord {
  const photo = hasPhoto(input);
  const facts = scoreStages(expectedStagesOf(expectation), scriptedAnswer(expectation, photo, extra.caseId, repeat, extra.reader));
  const notice = expectation.notice ?? null;
  return {
    ...base(testCase, repeat), caseId: extra.caseId, pass: testCase.pass === "conversation" ? "conversation" : testCase.pass, conversationId: extra.conversationId, step: extra.step,
    fields: { notice: true, outcome: true }, messageKind: photo ? (input.caption ? "photo_caption" : "photo") : "text", expectedSilent: notice === null,
    expectsRepeatNotice: extra.expectsRepeatNotice === true, input: input.text ?? input.caption ?? "[photo]", expected: [expectation],
    actual: { notice, outcomes: expectation.outcomes ?? [], noticeProducts: [], order: [] }, signature: `fake:${extra.reader}:${facts.decisionActual}`, latencyMs: facts.readingMs, facts,
  };
}

function imageRecordOf(testCase: ImageCase, repeat: number): CaseRecord {
  const expectation = testCase.expected[0]!;
  return {
    ...base(testCase, repeat), caseId: testCase.id, pass: "image", conversationId: null, step: null, fields: { identification: true }, messageKind: null, input: testCase.input.file,
    expected: testCase.expected, actual: { kind: expectation.kind }, signature: expectation.kind === "found" ? `found:${expectation.product}` : expectation.kind,
  };
}

/** The records one run of a case leaves in fake mode: one for a case, one per message for a conversation. */
export function fakeRecordsOf(testCase: EvalCase, repeat: number, reader: Reader = "staged"): readonly CaseRecord[] {
  if (testCase.pass === "image") return [imageRecordOf(testCase, repeat)];
  if (testCase.pass === "conversation") {
    return testCase.steps.filter(isMessageStep).map((step, index) => messageRecordOf(testCase, repeat, step.expected, step.input,
      { caseId: `${testCase.id}#${index + 1}`, conversationId: testCase.id, step: index + 1, expectsRepeatNotice: step.expectsRepeatNotice, reader }));
  }
  return [messageRecordOf(testCase, repeat, testCase.expected[0]!, testCase.input, { caseId: testCase.id, conversationId: null, step: null, reader })];
}

/** Runs the selected cases `runs` times in memory, as the suites do through vitest-evals. */
export function runFakeHarness(cases: readonly EvalCase[], runs: number, reader: Reader = "staged"): Readonly<{ records: readonly CaseRecord[] }> {
  return { records: runsOf(readerCasesOf(cases, reader), runs).flatMap(({ testCase, repeat }) => fakeRecordsOf(testCase, repeat, reader)) };
}

/** The suite's `runCase` in fake mode: leaves the records in the run directory like the real one. */
export async function runFakeCase(runId: string, testCase: EvalCase, repeat: number, reader: Reader = "staged"): Promise<readonly CaseRecord[]> {
  const records = fakeRecordsOf(testCase, repeat, reader);
  for (const record of records) await appendRecord(runId, record);
  return records;
}
