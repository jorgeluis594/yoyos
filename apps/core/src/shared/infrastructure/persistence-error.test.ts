import { Prisma } from "@prisma/client";
import { expect, test } from "vitest";
import { classifyPersistenceFailure, isPersistenceFailure } from "@core/src/shared/infrastructure/persistence-error";

test("recognizes Prisma and adapter database failures while preserving programming exceptions", () => {
  for (const cause of [
    new Prisma.PrismaClientKnownRequestError("database unavailable", { code: "P1001", clientVersion: "7.10.0" }),
    new Prisma.PrismaClientUnknownRequestError("database unavailable", { clientVersion: "7.10.0" }),
    new Prisma.PrismaClientInitializationError("database unavailable", "7.10.0"),
    Object.assign(new Error("deferred constraint"), { name: "DriverAdapterError", cause: { kind: "postgres" } }),
  ]) expect(isPersistenceFailure(cause)).toBe(true);
  for (const cause of [new Error("programming error"), Object.assign(new Error("unknown"), { name: "DriverAdapterError", cause: null }), "unknown"]) expect(isPersistenceFailure(cause)).toBe(false);
});

test("classifies Prisma timeouts and lost connections as transaction-ending and statement errors as contained", () => {
  const known = (code: string, message: string, meta?: object) => new Prisma.PrismaClientKnownRequestError(message, { code, clientVersion: "7.10.0", meta });
  expect(classifyPersistenceFailure(known("P2028", "Transaction API error: Transaction already closed"))).toEqual({ kind: "transaction_ending" });
  expect(classifyPersistenceFailure(Object.assign(new Error("Connection terminated unexpectedly"), { name: "DriverAdapterError", cause: { kind: "postgres" } }))).toEqual({ kind: "transaction_ending" });
  expect(classifyPersistenceFailure(known("P2010", "Raw query failed", { code: "55P03", message: "canceling statement due to lock timeout" }))).toEqual({ kind: "contained", errorCode: "LOCK_TIMEOUT" });
  expect(classifyPersistenceFailure(known("P2010", "Raw query failed", { code: "57014", message: "canceling statement due to statement timeout" }))).toEqual({ kind: "contained", errorCode: "STATEMENT_TIMEOUT" });
  expect(classifyPersistenceFailure(known("P2010", "Raw query failed", { code: "40P01", message: "deadlock detected" }))).toEqual({ kind: "contained", errorCode: "DEADLOCK" });
  expect(classifyPersistenceFailure(known("P2010", "Raw query failed", { code: "23505" }))).toEqual({ kind: "contained", errorCode: "DATABASE_ERROR" });
  expect(classifyPersistenceFailure(new Error("programming error"))).toBeUndefined();
});
