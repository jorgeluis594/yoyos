import { createPendingOrderSync, retryDelay } from "@mobile/features/orders/application/pending-order-sync";

test("retry delay grows exponentially, is capped at five minutes and is jittered", () => {
  expect([1, 2, 3, 4].map(failures => retryDelay(failures, () => 1))).toEqual([2_000, 4_000, 8_000, 16_000]);
  expect(retryDelay(20, () => 1)).toBe(300_000);
  expect(retryDelay(4, () => 0.5)).toBe(8_000);
  expect(retryDelay(4, () => 0)).toBe(1_000);
});

const flush = () => new Promise(resolve => setImmediate(resolve));
const fakeTimers = () => {
  const scheduled: { run: () => void; ms: number }[] = [];
  return { scheduled, timers: { setTimeout: (run: () => void, ms: number) => scheduled.push({ run, ms }), clearTimeout: () => {}, random: () => 1 } };
};

test("waiting sales are retried with growing delays until they are sent", async () => {
  const waiting = [2, 1, 0];
  const calls: string[] = [];
  const { scheduled, timers } = fakeTimers();
  const synced: string[] = [];
  const sync = createPendingOrderSync(async (companyId) => { calls.push(companyId); return { waiting: waiting.shift() ?? 0 }; }, timers, id => synced.push(id));
  sync.start("company");
  await flush();
  expect(scheduled.map(entry => entry.ms)).toEqual([2_000]);
  scheduled[0].run(); await flush();
  expect(scheduled.map(entry => entry.ms)).toEqual([2_000, 4_000]);
  scheduled[1].run(); await flush();
  expect(scheduled).toHaveLength(2);
  expect(calls).toEqual(["company", "company", "company"]);
  expect(synced).toHaveLength(3);
});

test("a trigger retries at once and resets the backoff; stop cancels further retries", async () => {
  const { scheduled, timers } = fakeTimers();
  let calls = 0;
  const sync = createPendingOrderSync(async () => { calls += 1; return { waiting: 1 }; }, timers);
  sync.start("company"); await flush();
  scheduled[0].run(); await flush();
  expect(scheduled.at(-1)?.ms).toBe(4_000);
  sync.trigger(); await flush();
  expect(scheduled.at(-1)?.ms).toBe(2_000);
  sync.stop();
  scheduled.at(-1)?.run(); await flush();
  expect(calls).toBe(3);
});

test("a trigger during a running sync runs once more after it", async () => {
  let release = () => {};
  let calls = 0;
  const sync = createPendingOrderSync(() => { calls += 1; return new Promise(resolve => { release = () => resolve({ waiting: 0 }); }); }, fakeTimers().timers);
  sync.start("company");
  sync.trigger(); sync.trigger();
  release(); await flush();
  release(); await flush();
  expect(calls).toBe(2);
});
