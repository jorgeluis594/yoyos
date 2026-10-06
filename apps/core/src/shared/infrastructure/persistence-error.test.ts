import { Prisma } from "@prisma/client";
import { expect, test } from "vitest";
import { isPersistenceFailure } from "@core/src/shared/infrastructure/persistence-error";

test("recognizes Prisma and adapter database failures while preserving programming exceptions", () => {
  for (const cause of [
    new Prisma.PrismaClientKnownRequestError("database unavailable", { code: "P1001", clientVersion: "7.10.0" }),
    new Prisma.PrismaClientUnknownRequestError("database unavailable", { clientVersion: "7.10.0" }),
    new Prisma.PrismaClientInitializationError("database unavailable", "7.10.0"),
    Object.assign(new Error("deferred constraint"), { name: "DriverAdapterError", cause: { kind: "postgres" } }),
  ]) expect(isPersistenceFailure(cause)).toBe(true);
  for (const cause of [new Error("programming error"), Object.assign(new Error("unknown"), { name: "DriverAdapterError", cause: null }), "unknown"]) expect(isPersistenceFailure(cause)).toBe(false);
});
