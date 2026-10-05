import type { CourierId } from "@core/src/features/delivery-settings/domain/delivery-settings";
import { randomUUID } from "node:crypto";
import { expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import { deliverySettings } from "@core/src/features/delivery-settings/composition";
import { saveDeliverySettings } from "@core/src/features/delivery-settings/application/delivery-settings";
import { readDeliverySettings, writeDeliverySettings } from "@core/src/features/delivery-settings/infrastructure/delivery-settings-repository";
import { prisma, systemPrisma, withTenantIsolation, withinTransaction } from "@core/src/shared/infrastructure/persistance";
import { log } from "@core/src/shared/infrastructure/logger";

const point = { name: "Tienda principal", address: "Av. Lima 123", instructions: "Puerta azul" };
const store = { enabled: true as const, pickupPoint: point };

async function fixture() {
  const companyId = randomUUID();
  const context = { companyId, userId: randomUUID() };
  await withTenantIsolation(companyId, async () => {
    await prisma.company.create({ data: { id: companyId, name: "Delivery test", country: "PE" } });
  });
  return { context, run: <T>(work: () => Promise<T>) => withTenantIsolation(companyId, async () => await work()),
    cleanup: () => withTenantIsolation(companyId, async () => {
      await prisma.companyCourier.deleteMany();
      await prisma.companyDeliverySettings.deleteMany();
      await prisma.company.delete({ where: { id: companyId } });
    }) };
}

test("reads an absent configuration without writes, versions edits and preserves a disabled point", async () => {
  const f = await fixture();
  try {
    await f.run(async () => {
      expect(await deliverySettings.get(f.context)).toEqual(ok({ version: 0, agency: { enabled: false }, couriers: [], home: { enabled: false }, store: { enabled: false, pickupPoint: null } }));
      expect(await prisma.companyDeliverySettings.count()).toBe(0);
      expect(await deliverySettings.save({ expectedVersion: 0, agency: { enabled: false }, couriers: [], home: { enabled: false }, store }, f.context)).toEqual(ok({ version: 1, agency: { enabled: false }, couriers: [], home: { enabled: false }, store }));
      expect(await deliverySettings.get(f.context)).toEqual(ok({ version: 1, agency: { enabled: false }, couriers: [], home: { enabled: false }, store }));
      const disabled = { enabled: false as const, pickupPoint: point };
      expect(await deliverySettings.save({ expectedVersion: 1, agency: { enabled: false }, couriers: [], home: { enabled: false }, store: disabled }, f.context)).toEqual(ok({ version: 2, agency: { enabled: false }, couriers: [], home: { enabled: false }, store: disabled }));
      expect(await deliverySettings.save({ expectedVersion: 1, agency: { enabled: false }, couriers: [], home: { enabled: false }, store }, f.context)).toMatchObject({ success: false, error: { code: "DELIVERY_SETTINGS_CONFLICT" } });
      expect(await deliverySettings.get(f.context)).toEqual(ok({ version: 2, agency: { enabled: false }, couriers: [], home: { enabled: false }, store: disabled }));
    });
  } finally { await f.cleanup(); }
});

test("serializes two initial creations and same-version edits with no duplicate rows", async () => {
  const f = await fixture();
  try {
    let arrived = 0;
    let release!: () => void;
    const bothRead = new Promise<void>((resolve) => { release = resolve; });
    const firstSave = () => f.run(() => saveDeliverySettings({ expectedVersion: 0, agency: { enabled: true }, couriers: [{ kind: "new", name: "Courier", enabled: true }], home: { enabled: false }, store }, f.context, {
      generateCourierId: () => randomUUID() as CourierId,
      transaction: (_companyId, work) => withinTransaction(work),
      findForUpdate: async (companyId) => {
        const found = await readDeliverySettings(companyId, "exclusive");
        if (++arrived === 2) release();
        await bothRead;
        return found;
      },
      save: writeDeliverySettings,
    }));
    const created = await Promise.all([firstSave(), firstSave()]);
    expect(created.filter((result) => result.success)).toHaveLength(1);
    expect(created.find((result) => !result.success)).toMatchObject({ error: { code: "DELIVERY_SETTINGS_CONFLICT", reason: "concurrent_creation" } });
    const winner = created.find(result => result.success);
    if (!winner?.success) throw new Error("Expected a successful initial save");
    const couriers = winner.data.couriers.map(courier => ({ ...courier, kind: "existing" as const }));
    const edits = await Promise.all([0, 1].map((index) => f.run(() => deliverySettings.save({ expectedVersion: 1,
      agency: { enabled: true }, couriers, home: { enabled: false }, store: { enabled: true, pickupPoint: { ...point, address: `Dirección ${index}` } } }, f.context))));
    expect(edits.filter((result) => result.success)).toHaveLength(1);
    expect(edits.find((result) => !result.success)).toMatchObject({ error: { code: "DELIVERY_SETTINGS_CONFLICT", currentVersion: 2 } });
    await f.run(async () => {
      expect(await prisma.companyDeliverySettings.count()).toBe(1);
      expect(await prisma.companyCourier.count()).toBe(1);
      expect(await deliverySettings.get(f.context)).toEqual(edits.find((result) => result.success));
    });
  } finally { await f.cleanup(); }
});

test("rolls back configuration writes when an enclosing transaction rejects", async () => {
  const f = await fixture();
  const summary = vi.spyOn(log, "info").mockImplementation(() => {});
  try {
    await f.run(async () => {
      const result = await withinTransaction(async () => {
        expect(await writeDeliverySettings(f.context.companyId, { version: 1, agency: { enabled: false }, couriers: [], home: { enabled: false }, store })).toEqual(ok(null));
        return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Controlled failure" });
      });
      expect(result.success).toBe(false);
      expect(await deliverySettings.get(f.context)).toMatchObject({ success: true, data: { version: 0 } });
      expect(await withinTransaction(async () => {
        expect((await deliverySettings.save({ expectedVersion: 0, agency: { enabled: false }, couriers: [], home: { enabled: false }, store }, f.context)).success).toBe(true);
        expect(summary).not.toHaveBeenCalled();
        return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Controlled failure after nested save" });
      })).toMatchObject({ success: false });
      expect(summary).not.toHaveBeenCalled();
      expect(await deliverySettings.get(f.context)).toMatchObject({ success: true, data: { version: 0 } });
      await withinTransaction(async () => {
        expect((await deliverySettings.save({ expectedVersion: 0, agency: { enabled: false }, couriers: [], home: { enabled: false }, store }, f.context)).success).toBe(true);
        expect(summary).not.toHaveBeenCalled();
        return ok(null);
      });
      expect(summary).toHaveBeenCalledOnce();
      expect(summary.mock.calls[0][0]).toMatchObject({ event: "delivery_settings_saved", savedVersion: 1, transactionOutcome: "committed" });
      expect(JSON.stringify(summary.mock.calls)).not.toContain(point.address);
    });
  } finally { summary.mockRestore(); await f.cleanup(); }
});

test("enforces relational constraints and keeps another company's settings inaccessible", async () => {
  const [a, b] = await Promise.all([fixture(), fixture()]);
  try {
    await a.run(async () => {
      expect((await deliverySettings.save({ expectedVersion: 0, agency: { enabled: false }, couriers: [], home: { enabled: false }, store }, a.context)).success).toBe(true);
      await expect(prisma.companyDeliverySettings.create({ data: { companyId: a.context.companyId, agencyEnabled: false, homeEnabled: false, storeEnabled: false, version: 1 } })).rejects.toThrow();
      for (const data of [{ version: 0 }, { pickupAddress: null }, { pickupName: " " },
        { pickupName: null, pickupAddress: null, pickupInstructions: null }]) {
        await expect(prisma.companyDeliverySettings.update({ where: { companyId: a.context.companyId }, data })).rejects.toThrow();
      }
    });
    await b.run(async () => {
      expect(await prisma.companyDeliverySettings.findMany()).toEqual([]);
      expect(await prisma.companyDeliverySettings.updateMany({ where: { companyId: a.context.companyId }, data: { version: 99 } })).toMatchObject({ count: 0 });
      await expect(prisma.companyDeliverySettings.create({ data: { companyId: a.context.companyId, agencyEnabled: false, homeEnabled: false, storeEnabled: false, version: 1 } })).rejects.toThrow();
      await expect(prisma.companyDeliverySettings.create({ data: { companyId: randomUUID(), agencyEnabled: false, homeEnabled: false, storeEnabled: false, version: 1 } })).rejects.toThrow();
      expect(await deliverySettings.get(b.context)).toMatchObject({ success: true, data: { version: 0 } });
    });
    await a.run(async () => {
      await expect(prisma.companyDeliverySettings.update({ where: { companyId: a.context.companyId }, data: { companyId: b.context.companyId } })).rejects.toThrow();
      // Direct writes can bypass application text limits; reads must detect that corruption.
      await prisma.companyDeliverySettings.update({ where: { companyId: a.context.companyId }, data: { pickupName: "x".repeat(121) } });
      expect(await deliverySettings.get(a.context)).toMatchObject({ success: false, error: { code: "INVALID_STORED_DATA" } });
    });
  } finally { await Promise.all([a.cleanup(), b.cleanup()]); }
});

test("courier storage requires configuration and retains deactivated records under the application role", async () => {
  const f = await fixture();
  const id = randomUUID();
  try {
    await f.run(async () => {
      await expect(prisma.companyCourier.create({ data: { id, name: "Courier", enabled: true } })).rejects.toMatchObject({ code: "P2003" });
      const settings = await prisma.companyDeliverySettings.create({ data: { storeEnabled: false, version: 1 } });
      expect(settings).toMatchObject({ companyId: f.context.companyId, agencyEnabled: false, homeEnabled: false });
      const courier = await prisma.companyCourier.create({ data: { id, name: "Courier", enabled: true } });
      expect(courier).toEqual({ id, companyId: f.context.companyId, name: "Courier", enabled: true });
      await prisma.companyCourier.update({ where: { id }, data: { name: "Renamed", enabled: false } });
      expect(await prisma.companyCourier.findMany()).toEqual([{ ...courier, name: "Renamed", enabled: false }]);
      await expect(prisma.companyCourier.create({ data: { id: randomUUID(), name: " ", enabled: true } })).rejects.toThrow();
      await expect(prisma.companyCourier.create({ data: { id: randomUUID(), name: "n".repeat(121), enabled: true } })).rejects.toThrow();
      expect(await prisma.companyCourier.count()).toBe(1);
    });
  } finally {
    await f.run(() => prisma.companyCourier.deleteMany());
    await f.cleanup();
  }
});


test("courier write failure rolls back settings and earlier courier edits; invalid stored agency is rejected", async () => {
  const f = await fixture();
  const summary = vi.spyOn(log, "info").mockImplementation(() => {});
  const failure = vi.spyOn(log, "error").mockImplementation(() => {});
  const id = randomUUID() as CourierId;
  try {
    await f.run(async () => {
      await prisma.companyDeliverySettings.create({ data: { version: 1, storeEnabled: false } });
      await prisma.companyCourier.create({ data: { id, name: "Original", enabled: true } });
      const result = await withinTransaction(() => writeDeliverySettings(f.context.companyId, { version: 2, home: { enabled: true }, store: { enabled: false, pickupPoint: null }, agency: { enabled: true },
        couriers: [{ id, name: "Renamed", enabled: true }, { id: randomUUID() as CourierId, name: "New courier", enabled: true }, { id: randomUUID() as CourierId, name: " ", enabled: true }] }));
      expect(result).toMatchObject({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE" } });
      expect(await deliverySettings.get(f.context)).toMatchObject({ success: true, data: { version: 1, home: { enabled: false }, agency: { enabled: false }, couriers: [{ id, name: "Original" }] } });
      expect(summary).not.toHaveBeenCalled();
      expect(failure).toHaveBeenCalledOnce();
      expect(failure.mock.calls[0][0]).toMatchObject({ event: "delivery_settings_write_failed", stage: "save_couriers" });
      await prisma.companyCourier.update({ where: { id }, data: { enabled: false } });
      await prisma.companyDeliverySettings.update({ where: { companyId: f.context.companyId }, data: { agencyEnabled: true } });
      expect(await deliverySettings.get(f.context)).toMatchObject({ success: false, error: { code: "INVALID_STORED_DATA" } });
    });
  } finally { summary.mockRestore(); failure.mockRestore(); await f.cleanup(); }
});


test("a reader during a settings write receives one complete version including couriers", async () => {
  const f = await fixture();
  let release!: () => void;
  let written!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const partialWrite = new Promise<void>(resolve => { written = resolve; });
  try {
    const created = await f.run(() => deliverySettings.save({ expectedVersion: 0, agency: { enabled: true }, couriers: [{ kind: "new", name: "Original", enabled: true }], home: { enabled: false }, store }, f.context));
    if (!created.success) throw new Error("Expected initial configuration");
    const courier = created.data.couriers[0];
    const writer = f.run(() => withinTransaction(async () => {
      expect((await readDeliverySettings(f.context.companyId, "exclusive")).success).toBe(true);
      await prisma.companyDeliverySettings.update({ where: { companyId: f.context.companyId }, data: { version: 2, homeEnabled: true, pickupAddress: "New address" } });
      written();
      await hold;
      await prisma.companyCourier.update({ where: { id: courier.id }, data: { name: "New name" } });
      return ok(null);
    }));
    await partialWrite;
    const reader = f.run(() => deliverySettings.get(f.context));
    try {
      await vi.waitFor(async () => {
        const waiting = await systemPrisma.$queryRaw<{ count: bigint }[]>`SELECT count(*) AS count FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%CompanyDeliverySettings%'`;
        expect(Number(waiting[0].count)).toBeGreaterThan(0);
      });
    } finally { release(); }
    expect(await writer).toEqual(ok(null));
    expect(await reader).toEqual(ok({ ...created.data, version: 2, home: { enabled: true }, store: { enabled: true, pickupPoint: { ...point, address: "New address" } }, couriers: [{ ...courier, name: "New name" }] }));
  } finally { release?.(); await f.cleanup(); }
});
