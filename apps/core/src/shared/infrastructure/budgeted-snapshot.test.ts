import { Prisma } from "@prisma/client";
import { beforeEach, expect, test, vi } from "vitest";
import { ok } from "@shared/functional";

const persistance = vi.hoisted(() => ({ withinTransaction: vi.fn(), inActiveTransaction: vi.fn(() => false), prisma: { $queryRaw: vi.fn() } }));
const logger = vi.hoisted(() => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("@core/src/shared/infrastructure/persistance", () => persistance);
vi.mock("@core/src/shared/infrastructure/logger", () => logger);

import { budgetedSnapshot, classifyReadFailure } from "@core/src/shared/infrastructure/budgeted-snapshot";

const budget = { maxWait: 1000, timeout: 5000, statementTimeoutMs: 350, maxStatements: 11 } as const;
const statementTimeout = () => new Prisma.PrismaClientKnownRequestError("canceling statement due to statement timeout", { code: "P2010", clientVersion: "test", meta: { code: "57014" } });
const transactionTimer = () => new Prisma.PrismaClientKnownRequestError("Transaction API error: Transaction already closed", { code: "P2028", clientVersion: "test" });

beforeEach(() => {
  vi.clearAllMocks();
  persistance.inActiveTransaction.mockReturnValue(false);
});

test("reports a failure to onFailure with its duration and logs nothing by itself", async () => {
  persistance.withinTransaction.mockRejectedValue(statementTimeout());
  const onFailure = vi.fn();
  const result = await budgetedSnapshot(budget, onFailure)(async () => { throw new Error("unreachable"); });
  expect(result).toMatchObject({ success: false, error: { code: "STATEMENT_TIMEOUT" } });
  expect(onFailure).toHaveBeenCalledTimes(1);
  expect(onFailure).toHaveBeenCalledWith({ code: "STATEMENT_TIMEOUT", message: expect.any(String) }, expect.any(Error), expect.any(Number));
  expect(Object.values(logger.log).every((method) => method.mock.calls.length === 0)).toBe(true);
});

test("opens the transaction with the budget, and a snapshot already open is joined without a second transaction", async () => {
  persistance.withinTransaction.mockImplementation(async (work: () => Promise<unknown>) => work());
  const snapshot = budgetedSnapshot(budget);
  const opened = await snapshot(async () => ok(1));
  expect(opened).toEqual(ok(1));
  expect(persistance.withinTransaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "RepeatableRead", maxWait: 1000, timeout: 5000, statementTimeoutMs: 350 });
  persistance.inActiveTransaction.mockReturnValue(true);
  await snapshot(async () => ok(2));
  expect(persistance.withinTransaction).toHaveBeenCalledTimes(1);
});

test("classifies a PostgreSQL statement timeout as STATEMENT_TIMEOUT and a Prisma P2028 as TRANSACTION_TIMEOUT", () => {
  const lost = new Prisma.PrismaClientKnownRequestError("Connection refused", { code: "P1001", clientVersion: "test" });
  expect(classifyReadFailure(statementTimeout()).code).toBe("STATEMENT_TIMEOUT");
  expect(classifyReadFailure(transactionTimer()).code).toBe("TRANSACTION_TIMEOUT");
  expect(classifyReadFailure(lost).code).toBe("PERSISTENCE_UNAVAILABLE");
  expect(() => classifyReadFailure(new TypeError("a bug"))).toThrow(TypeError);
});
