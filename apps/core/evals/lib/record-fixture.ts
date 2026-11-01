import type { CaseRecord } from "@core/evals/lib/case-record";

/** A message record with every optional part neutral, for the unit tests of the report, the rebuild and the picks. */
export const messageRecord = (over: Partial<CaseRecord> = {}): CaseRecord => ({
  caseId: "a", baseId: "a", pass: "interpretation", criterion: 1, kind: "k", tags: [], repeat: 0, passed: false, exactPassed: false, fields: {}, expectationIndex: 0,
  judge: null, messageKind: "text", conversationId: null, step: null, ignoredActions: 0, wrongVisibleField: false, extraNotice: false, expectedSilent: false,
  noticeProducts: [], expectsRepeatNotice: false, previousOrder: [], input: "text «x»", expected: [], actual: {}, signature: "", certainties: [],
  latencyMs: 0, retries: 0, calls: [], error: null, ...over,
});
