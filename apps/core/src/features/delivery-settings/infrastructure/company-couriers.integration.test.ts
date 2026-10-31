import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { ok } from "@shared/functional";
import { deliverySettings } from "@core/src/features/delivery-settings/composition";
import { seededCourier } from "@core/src/features/delivery-settings/infrastructure/courier-catalog-fixture";
import { prisma, withTenantIsolation, withinTransaction } from "@core/src/shared/infrastructure/persistance";

const shalomCourier = await seededCourier("shalom");
const olvaCourier = await seededCourier("olva");
const shalomId = shalomCourier.id;
const olvaId = olvaCourier.id;

async function company() {
  const companyId = randomUUID();
  await withTenantIsolation(companyId, async () => { await prisma.company.create({ data: { id: companyId, name: "Couriers test", country: "PE" } }); });
  return companyId;
}
const cleanup = (companyId: string) => withTenantIsolation(companyId, async () => {
  await prisma.companyCourier.deleteMany();
  await prisma.companyDeliverySettings.deleteMany();
  await prisma.company.delete({ where: { id: companyId } });
});

test("lists a store's couriers, disabled included, without locking the settings row", async () => {
  const companyId = await company();
  const other = await company();
  try {
    const shalom = randomUUID();
    const olva = randomUUID();
    await withTenantIsolation(companyId, async () => {
      await prisma.companyDeliverySettings.create({ data: { companyId, version: 1, storeEnabled: false } });
      await prisma.companyCourier.create({ data: { id: shalom, courierId: shalomId, enabled: true } });
      await prisma.companyCourier.create({ data: { id: olva, courierId: olvaId, enabled: false } });
    });
    await withTenantIsolation(other, async () => {
      await prisma.companyDeliverySettings.create({ data: { companyId: other, version: 1, storeEnabled: false } });
      await prisma.companyCourier.create({ data: { id: randomUUID(), courierId: shalomId, enabled: true } });
    });

    // Another transaction holds the settings row exclusively: a FOR SHARE read would wait for it.
    let release = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    let locked = () => {};
    const isLocked = new Promise<void>((resolve) => { locked = resolve; });
    const holder = withTenantIsolation(companyId, () => withinTransaction(async () => {
      await prisma.$queryRaw`SELECT 1 FROM "CompanyDeliverySettings" WHERE "companyId" = ${companyId}::uuid FOR UPDATE`;
      locked();
      await held;
      return ok(null);
    }));
    await isLocked;
    try {
      const listed = await Promise.race([
        withTenantIsolation(companyId, () => deliverySettings.listCouriers(companyId)),
        new Promise<"blocked">((resolve) => setTimeout(() => resolve("blocked"), 3000)),
      ]);
      expect(listed).not.toBe("blocked");
      if (listed === "blocked" || !listed.success) throw new Error("expected the couriers");
      expect(listed.data).toEqual([{ id: shalom, name: shalomCourier.name, enabled: true }, { id: olva, name: olvaCourier.name, enabled: false }]
        .sort((a, b) => a.id.localeCompare(b.id)));
    } finally { release(); await holder; }
  } finally { await cleanup(companyId); await cleanup(other); }
});

test("lists no couriers for a store without settings", async () => {
  const companyId = await company();
  try {
    expect(await withTenantIsolation(companyId, () => deliverySettings.listCouriers(companyId))).toEqual(ok([]));
  } finally { await cleanup(companyId); }
});
