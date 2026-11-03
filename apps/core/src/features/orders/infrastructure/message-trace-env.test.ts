import { expect, test } from "vitest";
import { readMessageTraceSettings } from "@core/src/features/orders/infrastructure/message-trace-env";

test("defaults the trace retention to 90 days and the delete batch to 500", () => {
  expect(readMessageTraceSettings({})).toEqual({ retentionDays: 90, deleteBatch: 500 });
  expect(readMessageTraceSettings({ MESSAGE_TRACE_RETENTION_DAYS: "", MESSAGE_TRACE_DELETE_BATCH: "" })).toEqual({ retentionDays: 90, deleteBatch: 500 });
});

test("reads the trace settings from the env and fails on an invalid one", () => {
  expect(readMessageTraceSettings({ MESSAGE_TRACE_RETENTION_DAYS: "30", MESSAGE_TRACE_DELETE_BATCH: "100" })).toEqual({ retentionDays: 30, deleteBatch: 100 });
  expect(() => readMessageTraceSettings({ MESSAGE_TRACE_RETENTION_DAYS: "0" })).toThrow();
  expect(() => readMessageTraceSettings({ MESSAGE_TRACE_DELETE_BATCH: "1.5" })).toThrow();
});
