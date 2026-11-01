import { expect, test } from "vitest";
import { createReadingDeadline, logMetaOf, remainingMsOf, withAbort } from "@core/src/features/orders/infrastructure/reader/runtime/reading-deadline";

test("tells how much of the reading budget is left through its signal, and nothing for a plain signal", () => {
  let clock = 1_000;
  const deadline = createReadingDeadline(60_000, {}, () => clock);
  clock = 21_000;

  expect(remainingMsOf(deadline.signal, () => clock)).toBe(40_000);
  expect(remainingMsOf(new AbortController().signal, () => clock)).toBe(Infinity);
});

test("its signal aborts with the job signal", () => {
  const job = new AbortController();
  const deadline = createReadingDeadline(60_000, {}, () => 0, job.signal);
  job.abort();

  expect(deadline.signal.aborted).toBe(true);
});

test("a signal derived with withAbort keeps the budget and the log ids, and aborts with the extra signal", () => {
  const deadline = createReadingDeadline(60_000, { companyId: "c1", messageId: "m1" }, () => 0);
  const extra = new AbortController();
  const derived = withAbort(deadline.signal, extra.signal);

  expect(remainingMsOf(derived, () => 10_000)).toBe(50_000);
  expect(logMetaOf(derived)).toEqual({ companyId: "c1", messageId: "m1" });
  expect(logMetaOf(new AbortController().signal)).toEqual({});
  extra.abort();
  expect(derived.aborted).toBe(true);
  expect(deadline.signal.aborted).toBe(false);
});
