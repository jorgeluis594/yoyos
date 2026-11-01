import { expect, test } from "vitest";
import { assistantReadBudget } from "@core/src/features/products/infrastructure/assistant-read";

test("keeps maxStatements × statementTimeoutMs + maxWait within the transaction timer", () => {
  const { maxStatements, statementTimeoutMs, maxWait, timeout } = assistantReadBudget;
  expect(maxStatements * statementTimeoutMs + maxWait).toBeLessThanOrEqual(timeout);
});
