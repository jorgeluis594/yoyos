import { expect, test } from "vitest";
import { createReadingDeadline, remainingMsOf } from "@core/src/features/orders/infrastructure/reader/runtime/reading-deadline";

test("tells how much of the reading budget is left through its signal, and nothing for a plain signal", () => {
  let clock = 1_000;
  const deadline = createReadingDeadline(60_000, () => clock);
  clock = 21_000;

  expect(remainingMsOf(deadline.signal, () => clock)).toBe(40_000);
  expect(remainingMsOf(new AbortController().signal, () => clock)).toBe(Infinity);
});

test("its signal aborts with the job signal", () => {
  const job = new AbortController();
  const deadline = createReadingDeadline(60_000, () => 0, job.signal);
  job.abort();

  expect(deadline.signal.aborted).toBe(true);
});
