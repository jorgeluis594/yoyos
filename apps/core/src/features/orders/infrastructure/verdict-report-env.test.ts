import { expect, test } from "vitest";
import { readVerdictReportTimeoutMs } from "@core/src/features/orders/infrastructure/verdict-report-env";

test("defaults the verdict report statement timeout to 60 s and reads it from the env", () => {
  expect(readVerdictReportTimeoutMs({})).toBe(60_000);
  expect(readVerdictReportTimeoutMs({ VERDICT_REPORT_TIMEOUT_MS: "" })).toBe(60_000);
  expect(readVerdictReportTimeoutMs({ VERDICT_REPORT_TIMEOUT_MS: "90000" })).toBe(90_000);
});

test("fails on a timeout that is not a whole number of at least one second", () => {
  expect(() => readVerdictReportTimeoutMs({ VERDICT_REPORT_TIMEOUT_MS: "abc" })).toThrow();
  expect(() => readVerdictReportTimeoutMs({ VERDICT_REPORT_TIMEOUT_MS: "10" })).toThrow();
});
