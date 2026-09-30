import { randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { err, ok } from "@shared/functional";
import { getCompanyId, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import type { EventSubscription } from "@core/src/shared/events/application/contracts";
import { createPgBossProvider } from "@core/src/shared/events/infrastructure/pg-boss-provider";

type Events = { "test.completed": { value: string } };
const payloadSchema = z.object({ companyId: z.uuid(), value: z.string() });
const parsePayload = (input: unknown) => {
  const parsed = payloadSchema.safeParse(input);
  return parsed.success ? ok(parsed.data) : err({ code: "INVALID_EVENT" as const, message: "Invalid test payload" });
};

describe("pg-boss event delivery", () => {
  it("persists fan-out while workers are offline and restores company context on delivery", async () => {
    expect(process.env.DATABASE_URL).toBeTruthy();
    const suffix = randomUUID().slice(0, 8);
    const companyId = randomUUID();
    const eventId = randomUUID();
    const calls: string[] = [];
    const handler = vi.fn(async () => { calls.push(getCompanyId()); return ok(undefined); });
    const subscriptions: EventSubscription<Events, "test.completed">[] = ["first", "second"].map(label => ({
      id: `event-test-${label}-${suffix}`, name: "test.completed", handler, parsePayload,
      policy: { retries: 0, retryDelaySeconds: 0, exponentialBackoff: false, concurrency: 1 },
    }));
    const producer = createPgBossProvider<Events>({ connectionString: process.env.DATABASE_URL!, subscriptions });
    const worker = createPgBossProvider<Events>({ connectionString: process.env.DATABASE_URL!, subscriptions, consume: true });
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    const names = subscriptions.map(subscription => subscription.id);
    try {
      await producer.start();
      const metadata = { eventId, occurredAt: "2026-09-30T12:00:00.000Z" };
      const published = await withTenantIsolation(companyId, () => producer.publish(
        "test.completed", { companyId, value: "saved" }, metadata,
      ));
      expect(published).toEqual(ok(undefined));
      const stored = await pool.query<{ name: string; data: { metadata: { eventId: string } } }>(
        "SELECT name, data FROM pgboss.job WHERE name = ANY($1) ORDER BY name", [names],
      );
      expect(stored.rows.map(row => row.name)).toEqual(names);
      expect(stored.rows.map(row => row.data.metadata.eventId)).toEqual([eventId, eventId]);
      expect(handler).not.toHaveBeenCalled();

      await worker.start();
      for (const subscription of subscriptions) expect((await worker.subscribe(subscription)).success).toBe(true);
      await vi.waitFor(() => expect(calls).toEqual([companyId, companyId]), { timeout: 15_000, interval: 100 });
    } finally {
      await worker.stop();
      await producer.stop();
      await pool.query("DELETE FROM pgboss.job WHERE name = ANY($1)", [names]);
      await pool.query("DELETE FROM pgboss.queue WHERE name = ANY($1)", [names]);
      await pool.end();
    }
  });
});
