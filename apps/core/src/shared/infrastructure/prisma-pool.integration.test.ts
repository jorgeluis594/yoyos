import pg from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { expect, it } from "vitest";
import { prismaPoolConfig } from "@core/src/shared/infrastructure/persistance";

it("a worker with DATABASE_POOL_MAX=24 opens at most 24 Prisma connections", async () => {
  const databaseUrl = process.env.DATABASE_URL!;
  const marker = `pool_max_${Date.now()}`;
  const client = new PrismaClient({ adapter: new PrismaPg(prismaPoolConfig({ DATABASE_URL: databaseUrl, DATABASE_POOL_MAX: "24" })) });
  const observer = new pg.Client({ connectionString: databaseUrl });
  await observer.connect();
  let peak = 0;
  // Samples run one after another, and the last one ends before the observer closes.
  let sampling: Promise<void> = Promise.resolve();
  const sample = async () => {
    const result = await observer.query<{ count: string }>(
      "SELECT count(*) FROM pg_stat_activity WHERE query LIKE $1 AND pid <> pg_backend_pid()", [`%${marker}%`]);
    peak = Math.max(peak, Number(result.rows[0].count));
  };
  const sampler = setInterval(() => { sampling = sampling.then(sample); }, 25);
  try {
    await Promise.all(Array.from({ length: 60 }, () => client.$queryRawUnsafe(`SELECT pg_sleep(0.4)::text, '${marker}'`)));
  } finally {
    clearInterval(sampler);
    await sampling;
    await client.$disconnect();
    await observer.end();
  }
  expect(peak).toBeGreaterThan(10);
  expect(peak).toBeLessThanOrEqual(24);
});
