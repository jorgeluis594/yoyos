import { expect, it } from "vitest";
import { validHandlerPolicy } from "@core/src/shared/events/infrastructure/pg-boss-provider";

it("validates handler policy without silently changing zero retries or delay", () => {
  const valid = { retries: 0, retryDelaySeconds: 0, exponentialBackoff: false, concurrency: 1 };
  expect(validHandlerPolicy(valid)).toBe(true);
  for (const changed of [
    { retries: -1 }, { retries: 1.5 }, { retryDelaySeconds: -1 },
    { retryDelaySeconds: 0.5 }, { concurrency: 0 }, { concurrency: 1.5 },
    { retries: 2_147_483_648 }, { retryDelaySeconds: 2_147_483_648 },
  ]) expect(validHandlerPolicy({ ...valid, ...changed })).toBe(false);
});
