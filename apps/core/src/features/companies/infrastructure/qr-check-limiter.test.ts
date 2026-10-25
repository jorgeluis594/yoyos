import { expect, test, vi } from "vitest";
import { createQrCheckLimiter } from "@core/src/features/companies/infrastructure/qr-check-limiter";

const gate = () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
};

test("answers busy without running the check when every slot is taken", async () => {
  const limiter = createQrCheckLimiter(2);
  const first = gate();
  const second = gate();
  const running = [limiter.run(() => first.promise), limiter.run(() => second.promise)];
  const work = vi.fn(async () => "done");
  expect(await limiter.run(work)).toEqual({ busy: true });
  expect(work).not.toHaveBeenCalled();
  first.release();
  second.release();
  await Promise.all(running);
  expect(await limiter.run(work)).toEqual({ busy: false, value: "done" });
});

test("frees the slot after a failed check and after a thrown error", async () => {
  const limiter = createQrCheckLimiter(1);
  expect(await limiter.run(async () => ({ success: false as const }))).toEqual({ busy: false, value: { success: false } });
  await expect(limiter.run(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
  expect(await limiter.run(async () => "again")).toEqual({ busy: false, value: "again" });
});
