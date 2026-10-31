import { expect, test } from "vitest";
import { readDispatchQueueMax } from "@core/src/features/orders/infrastructure/dispatch-queue-env";

test("defaults the dispatch queue ceiling to 5000 and reads the override", () => {
  expect(readDispatchQueueMax({})).toBe(5000);
  expect(readDispatchQueueMax({ ASSISTANT_DISPATCH_QUEUE_MAX: "" })).toBe(5000);
  expect(readDispatchQueueMax({ ASSISTANT_DISPATCH_QUEUE_MAX: "200" })).toBe(200);
});

test("rejects a ceiling that is not a positive integer", () => {
  expect(() => readDispatchQueueMax({ ASSISTANT_DISPATCH_QUEUE_MAX: "0" })).toThrow();
  expect(() => readDispatchQueueMax({ ASSISTANT_DISPATCH_QUEUE_MAX: "many" })).toThrow();
});
