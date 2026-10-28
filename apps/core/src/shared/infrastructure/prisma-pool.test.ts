import { expect, it } from "vitest";
import { prismaPoolConfig } from "@core/src/shared/infrastructure/persistance";

it("leaves the pool size to the driver default when DATABASE_POOL_MAX is unset", () => {
  expect(prismaPoolConfig({ DATABASE_URL: "postgresql://db" })).toEqual({ connectionString: "postgresql://db" });
  expect(prismaPoolConfig({ DATABASE_URL: "postgresql://db", DATABASE_POOL_MAX: "" })).toEqual({ connectionString: "postgresql://db" });
});

it("passes DATABASE_POOL_MAX as the pool max", () => {
  expect(prismaPoolConfig({ DATABASE_URL: "postgresql://db", DATABASE_POOL_MAX: "24" })).toEqual({ connectionString: "postgresql://db", max: 24 });
});

it("rejects an invalid DATABASE_POOL_MAX instead of falling back", () => {
  for (const value of ["0", "-1", "1.5", "abc", "24 "]) {
    expect(() => prismaPoolConfig({ DATABASE_URL: "postgresql://db", DATABASE_POOL_MAX: value }), value).toThrow("DATABASE_POOL_MAX");
  }
});
