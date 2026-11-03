import { describe, expect, test } from "vitest";
import type { CaseRecord, StageFacts } from "@core/evals/lib/case-record";
import { messageRecord } from "@core/evals/lib/record-fixture";
import { auditOf } from "@core/evals/lib/audit";
import { metricsOfRun } from "@core/evals/lib/metrics";

const facts = (over: Partial<StageFacts> = {}): StageFacts => ({
  intent: true, fields: null, resolution: null, decision: true, decisionExpected: "applied", decisionActual: "applied", requested: true, changeApplied: true, marked: false,
  point: false, noticed: false, orderMatches: true, changedNotice: false, readingMs: 1000, queuedMs: 0, stageCostsUsd: {}, ...over,
});
const record = (over: Partial<StageFacts> = {}, rest: Partial<CaseRecord> = {}) => messageRecord({ facts: facts(over), ...rest });

describe("stage fields read strictly", () => {
  test("counts the labelled messages, those left between products, and the accuracy where a between never passes", () => {
    const records = [
      record({ fields: true }, { caseId: "a" }),
      record({ fields: true, fieldsBetween: true }, { caseId: "b" }),
      record({ fields: false }, { caseId: "c" }),
      record({ fields: true }, { caseId: "d" }),
      record({ fields: true, fieldsBetween: true }, { caseId: "a", repeat: 1 }),
      record({ fields: true }, { caseId: "b", repeat: 1 }),
      record({}, { caseId: "e" }),
    ];
    const { stageFields } = auditOf(records);
    expect(stageFields.labelled).toMatchObject({ mean: 3, min: 2, max: 4 });
    expect(stageFields.between).toMatchObject({ mean: 1, min: 1, max: 1 });
    expect(stageFields.strictAccuracy).toMatchObject({ min: 0.5, max: 0.5 });
  });

  test("a run with no labelled fields measures nothing", () => {
    expect(auditOf([record()]).stageFields).toEqual({ labelled: null, between: null, strictAccuracy: null });
  });
});

describe("what the urgent measures would read if «listo» with pendings counted as urgent", () => {
  // A record whose notice and outcomes the reader states, and whose label states its own.
  const rwp = { notice: "ready_with_pendings", outcomes: ["ready_with_pendings"] };
  const message = (decisionExpected: StageFacts["decisionExpected"], decisionActual: StageFacts["decisionActual"], expectation: object, actual: object, rest: Partial<CaseRecord> = {}) =>
    record({ decisionExpected, decisionActual }, { expected: [expectation], actual, ...rest });

  test("a label and an answer that both say «listo» with pendings, with no decision stated, become urgent on both sides: no false urgent, and the miss is a hit", () => {
    const both = message("notice", "notice", rwp, rwp, { caseId: "both" });
    const { readyWithPendings } = auditOf([both]);
    expect(readyWithPendings.falseUrgentShare).toMatchObject({ mean: 0 });
    expect(readyWithPendings.urgentRecall).toMatchObject({ mean: 1 });
  });

  test("an answer with it where the label expects a plain «listo» is a false urgent only in the what-if, and a label that states urgent is a miss as is and a hit in the what-if", () => {
    const wrong = message("notice", "notice", { notice: "ready", outcomes: ["ready"] }, rwp, { caseId: "wrong" });
    const stated = message("urgent", "notice", { notice: "ready_with_pendings", decision: "urgent" }, rwp, { caseId: "stated" });
    const records = [wrong, stated];
    expect(auditOf(records).readyWithPendings.falseUrgentShare).toMatchObject({ mean: 0.5 });
    expect(auditOf(records).readyWithPendings.urgentRecall).toMatchObject({ mean: 1 });
    // The measures as they are: no false urgent, and the stated urgent label is missed.
    expect(metricsOfRun(records)).toMatchObject({ falseUrgentShare: 0, urgentRecall: 0 });
  });

  test("a label with its own decision keeps it, and a message that does not say it keeps its decisions", () => {
    const own = message("applied", "notice", { notice: "ready_with_pendings", decision: "applied" }, rwp, { caseId: "own" });
    const other = message("notice", "notice", { notice: "ready", outcomes: ["ready"] }, { notice: "ready", outcomes: ["ready"] }, { caseId: "other" });
    expect(auditOf([own, other]).readyWithPendings.falseUrgentShare).toMatchObject({ mean: 0.5 });
    expect(auditOf([other]).readyWithPendings.falseUrgentShare).toMatchObject({ mean: 0 });
  });
});
