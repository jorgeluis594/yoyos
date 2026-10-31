import { Prisma } from "@prisma/client";
import { expect, test } from "vitest";
import { assistantReadBudget, assistantReadFailure } from "@core/src/features/products/infrastructure/assistant-read";

test("keeps maxStatements × statementTimeoutMs + maxWait within the transaction timer", () => {
  const { maxStatements, statementTimeoutMs, maxWait, timeout } = assistantReadBudget;
  expect(maxStatements * statementTimeoutMs + maxWait).toBeLessThanOrEqual(timeout);
});

test("maps a statement timeout to STATEMENT_TIMEOUT and a Prisma P2028 to TRANSACTION_TIMEOUT", () => {
  const timeout = new Prisma.PrismaClientKnownRequestError("canceling statement due to statement timeout", { code: "P2010", clientVersion: "test", meta: { code: "57014" } });
  const timer = new Prisma.PrismaClientKnownRequestError("Transaction API error: Transaction already closed", { code: "P2028", clientVersion: "test" });
  const lost = new Prisma.PrismaClientKnownRequestError("Connection refused", { code: "P1001", clientVersion: "test" });
  expect(assistantReadFailure(timeout).code).toBe("STATEMENT_TIMEOUT");
  expect(assistantReadFailure(timer).code).toBe("TRANSACTION_TIMEOUT");
  expect(assistantReadFailure(lost).code).toBe("PERSISTENCE_UNAVAILABLE");
  expect(() => assistantReadFailure(new TypeError("a bug"))).toThrow(TypeError);
});
