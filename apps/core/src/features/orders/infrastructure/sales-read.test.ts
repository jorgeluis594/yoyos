import { expect, test } from "vitest";
import { assistantReadBudget } from "@core/src/features/products/infrastructure/assistant-read";
import { salesPathStatements, salesReadBudget } from "@core/src/features/orders/infrastructure/sales-read";

test("keeps maxStatements × statementTimeoutMs + maxWait within the transaction timer for the product and the sales budgets", () => {
  for (const { maxStatements, statementTimeoutMs, maxWait, timeout } of [assistantReadBudget, salesReadBudget]) {
    expect(maxStatements * statementTimeoutMs + maxWait).toBeLessThanOrEqual(timeout);
  }
  expect(6 * 1500 + 1000).toBe(salesReadBudget.timeout);
});

test("keeps every sales path at least one statement under maxStatements", () => {
  for (const [path, statements] of Object.entries(salesPathStatements)) expect(statements, path).toBeLessThanOrEqual(salesReadBudget.maxStatements - 1);
});
