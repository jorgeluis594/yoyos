import { beforeEach, describe, expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";

const persistence = vi.hoisted(() => ({ withinTransaction: vi.fn(), options: [] as unknown[] }));
vi.mock("@core/src/shared/infrastructure/persistance", async (importOriginal) => ({
  ...await importOriginal<typeof import("@core/src/shared/infrastructure/persistance")>(),
  withTenantIsolation: (_companyId: string, callback: () => unknown) => callback(),
  withinTransaction: (work: () => unknown, options: unknown) => { persistence.options.push(options); return persistence.withinTransaction(work); },
}));

const { log } = await import("@core/src/shared/infrastructure/logger");
const { productTransaction, productWriteTransactionOptions } = await import("@core/src/features/products/product-editing");
const { transactionFailureStage } = await import("@core/src/shared/infrastructure/persistence-error");

class PrismaLikeError extends Error {
  constructor(message: string, readonly code?: string, readonly meta?: unknown) { super(message); }
}

describe("productWriteTransactionOptions", () => {
  test("defaults to a 10 s Prisma timer with a 2 s wait and PostgreSQL limits below it", () => {
    expect(productWriteTransactionOptions({})).toEqual({ timeout: 10_000, maxWait: 2_000, lockTimeoutMs: 3_000, statementTimeoutMs: 8_000 });
  });

  test("treats an empty value as unset and scales the PostgreSQL limits down for a short timeout", () => {
    expect(productWriteTransactionOptions({ PRODUCT_WRITE_TRANSACTION_TIMEOUT_MS: "" })).toMatchObject({ timeout: 10_000 });
    expect(productWriteTransactionOptions({ PRODUCT_WRITE_TRANSACTION_TIMEOUT_MS: "2000" })).toEqual({ timeout: 2_000, maxWait: 2_000, lockTimeoutMs: 600, statementTimeoutMs: 1_600 });
  });

  test("keeps both PostgreSQL limits below the Prisma timer for every accepted value", () => {
    for (const timeout of ["1000", "5000", "10000", "60000"]) {
      const options = productWriteTransactionOptions({ PRODUCT_WRITE_TRANSACTION_TIMEOUT_MS: timeout });
      expect(options.lockTimeoutMs).toBeLessThan(options.timeout as number);
      expect(options.statementTimeoutMs).toBeLessThan(options.timeout as number);
    }
  });

  test("rejects a value outside 1 s to 60 s or that is not a number, so the process fails at startup", () => {
    for (const value of ["999", "60001", "abc", "1.5"]) expect(() => productWriteTransactionOptions({ PRODUCT_WRITE_TRANSACTION_TIMEOUT_MS: value })).toThrow();
  });
});

describe("transactionFailureStage", () => {
  test("names a Prisma timer, a lock conflict and a statement timeout, and nothing else", () => {
    expect(transactionFailureStage(new PrismaLikeError("Transaction already closed", "P2028"))).toBe("transaction_timeout");
    expect(transactionFailureStage(new PrismaLikeError("write conflict", "P2034"))).toBe("lock_conflict");
    expect(transactionFailureStage(new PrismaLikeError("canceling statement due to lock timeout"))).toBe("lock_conflict");
    expect(transactionFailureStage(new PrismaLikeError("raw query failed", "P2010", { driverAdapterError: { cause: { originalCode: "55P03" } } }))).toBe("lock_conflict");
    expect(transactionFailureStage(new PrismaLikeError("deadlock detected", "P2010", { code: "40P01" }))).toBe("lock_conflict");
    expect(transactionFailureStage(new PrismaLikeError("canceling statement due to statement timeout"))).toBe("transaction_timeout");
    expect(transactionFailureStage(new Error("outer", { cause: new PrismaLikeError("closed", "P2028") }))).toBe("transaction_timeout");
    expect(transactionFailureStage(new PrismaLikeError("Unique constraint failed", "P2002"))).toBeUndefined();
    expect(transactionFailureStage("boom")).toBeUndefined();
    expect(transactionFailureStage(undefined)).toBeUndefined();
  });
});

describe("productTransaction", () => {
  const errorLog = vi.spyOn(log, "error").mockImplementation(() => undefined);
  beforeEach(() => { errorLog.mockClear(); persistence.withinTransaction.mockReset(); persistence.options.length = 0; });

  test("opens the transaction with the write options and returns the work result untouched", async () => {
    persistence.withinTransaction.mockImplementation((work: () => unknown) => work());
    expect(await productTransaction("company", async () => ok("saved"))).toEqual(ok("saved"));
    expect(persistence.options).toEqual([productWriteTransactionOptions(process.env)]);
    expect(errorLog).not.toHaveBeenCalled();
  });

  test("returns a rejection of the work as it is without logging a technical failure", async () => {
    persistence.withinTransaction.mockImplementation((work: () => unknown) => work());
    const rejection = { code: "PRODUCT_CHANGED" as const, message: "stale" };
    expect(await productTransaction("company", async () => err(rejection))).toEqual(err(rejection));
    expect(errorLog).not.toHaveBeenCalled();
  });

  test.each([
    ["a Prisma timer", new PrismaLikeError("Transaction already closed", "P2028"), "transaction_timeout"],
    ["a lock timeout", new PrismaLikeError("canceling statement due to lock timeout", "P2010"), "lock_conflict"],
    ["a deadlock", new PrismaLikeError("deadlock detected", "P2010", { code: "40P01" }), "lock_conflict"],
    ["a statement timeout", new PrismaLikeError("canceling statement due to statement timeout"), "transaction_timeout"],
  ])("answers PERSISTENCE_UNAVAILABLE and logs product_save_failed once with its stage for %s", async (_name, failure, stage) => {
    persistence.withinTransaction.mockRejectedValue(failure);
    const result = await productTransaction("company", async () => ok(1), { productId: "p1" });
    expect(result).toEqual(err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to save product" }));
    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(errorLog.mock.calls[0][0]).toMatchObject({ event: "product_save_failed", companyId: "company", productId: "p1", stage, errorCode: "PERSISTENCE_UNAVAILABLE", err: failure });
    expect(errorLog.mock.calls[0][0]).toHaveProperty("durationMs");
  });

  test("rethrows any other failure so it is not hidden", async () => {
    const failure = new Error("bug");
    persistence.withinTransaction.mockRejectedValue(failure);
    await expect(productTransaction("company", async () => ok(1))).rejects.toBe(failure);
    expect(errorLog).not.toHaveBeenCalled();
  });
});
