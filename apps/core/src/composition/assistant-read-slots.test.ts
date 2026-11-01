import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createReadSlots } from "@core/src/composition/assistant-read-slots";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

test("hands out as many slots as it has and gives a waiting call the first one released", async () => {
  const slots = createReadSlots(2, 2000);
  const first = await slots.acquire();
  await slots.acquire();
  const third = slots.acquire();
  await vi.advanceTimersByTimeAsync(500);
  first!.release();
  expect(await third).toMatchObject({ waitedMs: 500 });
});

test("answers null to a call that waits its whole time and leaves the slot count intact", async () => {
  const slots = createReadSlots(1, 300);
  const held = await slots.acquire();
  const late = slots.acquire();
  await vi.advanceTimersByTimeAsync(300);
  expect(await late).toBeNull();
  held!.release();
  expect(await slots.acquire()).not.toBeNull();
});
