import { describe, expect, test } from "vitest";
import type { CaseRecord, StageFacts } from "@core/evals/lib/case-record";
import { messageRecord } from "@core/evals/lib/record-fixture";
import { auditOf } from "@core/evals/lib/audit";

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
