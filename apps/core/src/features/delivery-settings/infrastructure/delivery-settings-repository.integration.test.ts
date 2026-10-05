import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { err, ok } from "@shared/functional";
import { deliverySettings } from "@core/src/features/delivery-settings/composition";
import { saveDeliverySettings } from "@core/src/features/delivery-settings/application/delivery-settings";
import { readDeliverySettings, writeDeliverySettings } from "@core/src/features/delivery-settings/infrastructure/delivery-settings-repository";
import { prisma, withTenantIsolation, withinTransaction } from "@core/src/shared/infrastructure/persistance";

const point = { name: "Tienda principal", address: "Av. Lima 123", instructions: "Puerta azul" };
const store = { enabled: true as const, pickupPoint: point };

async function fixture() {
  const companyId = randomUUID();
  const context = { companyId, userId: randomUUID() };
  await withTenantIsolation(companyId, async () => {
    await prisma.company.create({ data: { id: companyId, name: "Delivery test", country: "PE" } });
  });
  return { context, run: <T>(work: () => Promise<T>) => withTenantIsolation(companyId, work),
    cleanup: () => withTenantIsolation(companyId, async () => {
      await prisma.companyDeliverySettings.deleteMany();
      await prisma.company.delete({ where: { id: companyId } });
    }) };
}

test("reads an absent configuration without writes, versions edits and preserves a disabled point", async () => {
  const f = await fixture();
  try {
    await f.run(async () => {
      expect(await deliverySettings.get(f.context)).toEqual(ok({ version: 0, store: { enabled: false, pickupPoint: null } }));
      expect(await prisma.companyDeliverySettings.count()).toBe(0);
      expect(await deliverySettings.save({ expectedVersion: 0, store }, f.context)).toEqual(ok({ version: 1, store }));
      expect(await deliverySettings.get(f.context)).toEqual(ok({ version: 1, store }));
      const disabled = { enabled: false as const, pickupPoint: point };
      expect(await deliverySettings.save({ expectedVersion: 1, store: disabled }, f.context)).toEqual(ok({ version: 2, store: disabled }));
      expect(await deliverySettings.save({ expectedVersion: 1, store }, f.context)).toMatchObject({ success: false, error: { code: "DELIVERY_SETTINGS_CONFLICT" } });
      expect(await deliverySettings.get(f.context)).toEqual(ok({ version: 2, store: disabled }));
    });
  } finally { await f.cleanup(); }
});

test("serializes two initial creations and same-version edits with no duplicate rows", async () => {
  const f = await fixture();
  try {
    let arrived = 0;
    let release!: () => void;
    const bothRead = new Promise<void>((resolve) => { release = resolve; });
    const firstSave = () => f.run(() => saveDeliverySettings({ expectedVersion: 0, store }, f.context, {
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
    const edits = await Promise.all([0, 1].map((index) => f.run(() => deliverySettings.save({ expectedVersion: 1,
      store: { enabled: true, pickupPoint: { ...point, address: `Dirección ${index}` } } }, f.context))));
    expect(edits.filter((result) => result.success)).toHaveLength(1);
    expect(edits.find((result) => !result.success)).toMatchObject({ error: { code: "DELIVERY_SETTINGS_CONFLICT", currentVersion: 2 } });
    await f.run(async () => {
      expect(await prisma.companyDeliverySettings.count()).toBe(1);
      expect(await deliverySettings.get(f.context)).toEqual(edits.find((result) => result.success));
    });
  } finally { await f.cleanup(); }
});

test("rolls back configuration writes when an enclosing transaction rejects", async () => {
  const f = await fixture();
  try {
    await f.run(async () => {
      const result = await withinTransaction(async () => {
        expect(await writeDeliverySettings(f.context.companyId, { version: 1, store })).toEqual(ok(null));
        return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Controlled failure" });
      });
      expect(result.success).toBe(false);
      expect(await deliverySettings.get(f.context)).toMatchObject({ success: true, data: { version: 0 } });
      await expect(withinTransaction(() => deliverySettings.save({ expectedVersion: 0, store }, f.context))).rejects.toThrow("independent transactions");
    });
  } finally { await f.cleanup(); }
});

test("enforces relational constraints and keeps another company's settings inaccessible", async () => {
  const [a, b] = await Promise.all([fixture(), fixture()]);
  try {
    await a.run(async () => {
      expect((await deliverySettings.save({ expectedVersion: 0, store }, a.context)).success).toBe(true);
      await expect(prisma.companyDeliverySettings.create({ data: { companyId: a.context.companyId, storeEnabled: false, version: 1 } })).rejects.toThrow();
      for (const data of [{ version: 0 }, { pickupAddress: null }, { pickupName: " " },
        { pickupName: null, pickupAddress: null, pickupInstructions: null }]) {
        await expect(prisma.companyDeliverySettings.update({ where: { companyId: a.context.companyId }, data })).rejects.toThrow();
      }
    });
    await b.run(async () => {
      expect(await prisma.companyDeliverySettings.findMany()).toEqual([]);
      expect(await prisma.companyDeliverySettings.updateMany({ where: { companyId: a.context.companyId }, data: { version: 99 } })).toMatchObject({ count: 0 });
      await expect(prisma.companyDeliverySettings.create({ data: { companyId: a.context.companyId, storeEnabled: false, version: 1 } })).rejects.toThrow();
      await expect(prisma.companyDeliverySettings.create({ data: { companyId: randomUUID(), storeEnabled: false, version: 1 } })).rejects.toThrow();
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
