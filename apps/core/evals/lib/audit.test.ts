import { describe, expect, test } from "vitest";
import type { CaseRecord, StageFacts } from "@core/evals/lib/case-record";
import { messageRecord } from "@core/evals/lib/record-fixture";
import { auditOf, impossibleLabelCaseIds } from "@core/evals/lib/audit";
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

describe("false urgent as is, without impossible labels, without cascades and both", () => {
  const falseUrgent = { decisionExpected: "applied", decisionActual: "urgent" } as const;
  const step = (conversation: string, number: number, passed: boolean, over: Partial<StageFacts> = {}, repeat = 0) =>
    record(over, { caseId: `${conversation}#${number}`, baseId: conversation, conversationId: conversation, step: number, passed, repeat });
  const shares = (records: readonly CaseRecord[]) => {
    const { falseUrgent: views } = auditOf(records);
    return [views.asIs, views.withoutImpossibleLabels, views.withoutCascades, views.withoutBoth].map((range) => range?.mean);
  };

  test("names the labels that cannot be matched as a constant, apart from the cases, which are not edited", () => {
    expect([...impossibleLabelCaseIds].sort()).toEqual(["h5-100", "h5-103", "h5-104"]);
  });

  test("a label that is impossible, by its base id, is not counted as a false urgent, and stays among the decided messages", () => {
    const records = [
      record(falseUrgent, { caseId: "h5-100", baseId: "h5-100" }),
      record(falseUrgent, { caseId: "h5-100-p1", baseId: "h5-100" }),
      record(falseUrgent, { caseId: "real", baseId: "real" }),
      record({}, { caseId: "fine", baseId: "fine" }),
    ];
    expect(shares(records)).toEqual([0.75, 0.25, 0.75, 0.25]);
  });

  test("a false urgent that is a carried failure is left out of the cascades view; an own failure and a carried record that is no false urgent stay", () => {
    const records = [
      step("c1", 1, false, falseUrgent),
      step("c1", 2, false, falseUrgent),
      step("c1", 3, false),
      record({}, { caseId: "plain" }),
    ];
    // The first failed step is the own one; the second is carried and a false urgent, left out; the third is carried but no false urgent, so nothing changes for it.
    expect(shares(records)).toEqual([0.5, 0.5, 0.25, 0.25]);
  });

  test("a failed event is no message, but it makes the later messages of the conversation carried", () => {
    const event = record({}, { caseId: "c2#event1", baseId: "c2", conversationId: "c2", step: null, event: { name: "report_payment", after: 1 }, passed: false, facts: undefined });
    const records = [step("c2", 1, true), event, step("c2", 2, false, falseUrgent)];
    expect(shares(records)).toEqual([1 / 2, 1 / 2, 0, 0]);
  });

  test("each run is read apart: a failure in an earlier run does not make a later run's step carried, and the mean is over the runs", () => {
    const records = [
      step("c3", 1, false, falseUrgent, 0), step("c3", 2, false, falseUrgent, 0),
      step("c3", 1, true, {}, 1), step("c3", 2, false, falseUrgent, 1),
    ];
    const { falseUrgent: views } = auditOf(records);
    expect(views.asIs).toMatchObject({ mean: 0.75, min: 0.5, max: 1 });
    expect(views.withoutCascades).toMatchObject({ mean: 0.5, min: 0.5, max: 0.5 });
    const carried = [step("c3", 1, false, {}, 0), step("c3", 2, false, falseUrgent, 0)];
    expect(auditOf(carried).falseUrgent.withoutCascades).toMatchObject({ mean: 0 });
  });

  test("a record with no decision (the legacy baseline) is not among the decided messages", () => {
    const records = [record({ ...falseUrgent, decision: null }), record(falseUrgent, { caseId: "b" })];
    expect(shares(records)[0]).toBe(1);
  });
});

describe("silent wrong changes without the cascades", () => {
  const silent = { orderMatches: false, changedLines: 1, unmarkedLines: 1, silentLines: 1 } as const;
  const step = (number: number, passed: boolean, over: Partial<StageFacts> = {}) =>
    record(over, { caseId: `c#${number}`, baseId: "c", conversationId: "c", step: number, passed });

  test("a silent wrong change that is a carried failure is not counted in the view without cascades; the first one is", () => {
    const records = [step(1, false, silent), step(2, false, silent), record(silent, { caseId: "alone", passed: false })];
    const { silentWrongChanges } = auditOf(records);
    expect(silentWrongChanges.asIs).toMatchObject({ mean: 3 });
    expect(silentWrongChanges.withoutCascades).toMatchObject({ mean: 2 });
  });

  test("a record carrying no silent change is not counted either way", () => {
    expect(auditOf([step(1, false), step(2, false)]).silentWrongChanges).toEqual({ asIs: { mean: 0, min: 0, max: 0, runs: 1 }, withoutCascades: { mean: 0, min: 0, max: 0, runs: 1 } });
  });
});
