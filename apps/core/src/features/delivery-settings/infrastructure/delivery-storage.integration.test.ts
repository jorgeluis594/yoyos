import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { ok } from "@shared/functional";
import { prisma, withTenantIsolation, withinTransaction } from "@core/src/shared/infrastructure/persistance";

const destination = { country: "PE", districtCode: "150122", address: null, instructions: null };
async function fixture() {
  const companyId = randomUUID();
  const run = <T>(work: () => Promise<T>) => withTenantIsolation(companyId, async () => await work());
  await run(() => prisma.company.create({ data: { id: companyId, name: "Delivery storage test", country: "PE" } }));
  return { companyId, run, cleanup: () => run(async () => {
    await prisma.deliveryRate.deleteMany();
    await prisma.quotation.deleteMany();
    await prisma.deliveryZoneDistrict.deleteMany();
    await prisma.deliveryZone.deleteMany();
    await prisma.company.delete({ where: { id: companyId } });
  }) };
}
const zoneData = () => ({ id: randomUUID(), method: "home", name: "Nearby", enabled: true, priceAmount: 8, priceCurrency: "PEN" });
const quotationData = () => ({ id: randomUUID(), destination, createdAt: new Date("2026-10-07T16:00:00Z") });
const rateData = (quotationId: string, zoneId: string) => ({ id: randomUUID(), quotationId, zoneId, method: "home", districtCode: "150122",
  priceAmount: 8, priceCurrency: "PEN", settingsVersion: 1, createdAt: new Date("2026-10-07T16:00:00Z") });

test("storage allows overlapping zones and multiple quotations while retaining generated prices after configuration changes", async () => {
  const f = await fixture();
  try {
    await f.run(async () => {
      const [first, second] = await Promise.all([prisma.deliveryZone.create({ data: zoneData() }), prisma.deliveryZone.create({ data: zoneData() })]);
      for (const zone of [first, second]) {
        expect(zone.companyId).toBe(f.companyId);
        await prisma.deliveryZoneDistrict.create({ data: { method: "home", zoneId: zone.id, districtCode: "150122" } });
      }
      expect(await prisma.deliveryZoneDistrict.count({ where: { districtCode: "150122" } })).toBe(2);
      await expect(prisma.deliveryZoneDistrict.create({ data: { method: "home", zoneId: first.id, districtCode: "150122" } })).rejects.toMatchObject({ code: "P2002" });
      const quotation = await prisma.quotation.create({ data: quotationData() });
      const rates = [];
      for (const zone of [first, second]) rates.push(await prisma.deliveryRate.create({ data: rateData(quotation.id, zone.id) }));
      expect(rates.map(rate => rate.companyId)).toEqual([f.companyId, f.companyId]);
      await expect(prisma.deliveryRate.create({ data: rateData(quotation.id, first.id) })).rejects.toMatchObject({ code: "P2002" });
      const next = await prisma.quotation.create({ data: quotationData() });
      await prisma.deliveryRate.create({ data: rateData(next.id, first.id) });
      await prisma.deliveryZone.update({ where: { id: first.id }, data: { enabled: false, priceAmount: 10 } });
      await prisma.deliveryZoneDistrict.deleteMany({ where: { zoneId: first.id } });
      const persisted = await prisma.deliveryRate.findMany({ where: { quotationId: quotation.id }, orderBy: { zoneId: "asc" } });
      expect(persisted).toHaveLength(2);
      expect(persisted.every(rate => rate.priceAmount.toNumber() === 8 && rate.districtCode === "150122")).toBe(true);
      expect(await prisma.quotation.findUnique({ where: { id: quotation.id } })).toEqual(quotation);
      await expect(prisma.quotation.delete({ where: { id: quotation.id } })).rejects.toMatchObject({ code: "P2003" });
    });
  } finally { await f.cleanup(); }
});

test("zone and rate constraints reject invalid prices, methods, versions and malformed destination JSON", async () => {
  const f = await fixture();
  try {
    await f.run(async () => {
      for (const invalid of [{ method: "store" }, { name: " " }, { priceAmount: -1 }, { priceAmount: "NaN" }, { priceCurrency: "INVALID" }]) {
        await expect(prisma.deliveryZone.create({ data: { ...zoneData(), ...invalid } })).rejects.toThrow();
      }
      const zone = await prisma.deliveryZone.create({ data: { ...zoneData(), priceAmount: 0 } });
      expect(zone.priceAmount.toNumber()).toBe(0);
      for (const invalid of [{ method: "agency", districtCode: "150122" }, { method: "home", districtCode: "abc" }]) {
        await expect(prisma.deliveryZoneDistrict.create({ data: { ...invalid, zoneId: zone.id } })).rejects.toThrow();
      }
      for (const invalid of [{}, { ...destination, country: null }, { ...destination, country: "US" },
        { ...destination, kind: "home" }, { ...destination, districtCode: 150122 }, { ...destination, address: 123 }]) {
        await expect(prisma.quotation.create({ data: { ...quotationData(), destination: invalid } })).rejects.toThrow();
      }
      const quotation = await prisma.quotation.create({ data: quotationData() });
      for (const invalid of [{ method: "store" }, { method: "agency" }, { districtCode: "abc" }, { priceAmount: -1 },
        { settingsVersion: -1 }, { priceCurrency: "INVALID" }]) {
        await expect(prisma.deliveryRate.create({ data: { ...rateData(quotation.id, zone.id), ...invalid } })).rejects.toThrow();
      }
      expect(await prisma.deliveryRate.count()).toBe(0);
    });
  } finally { await f.cleanup(); }
});

test("restricted tenant access and composite relationships prevent cross-company quotations, zones and rates", async () => {
  const [a, b] = await Promise.all([fixture(), fixture()]);
  try {
    const own = await a.run(async () => {
      const zone = await prisma.deliveryZone.create({ data: zoneData() });
      await prisma.deliveryZoneDistrict.create({ data: { method: "home", zoneId: zone.id, districtCode: "150122" } });
      const quotation = await prisma.quotation.create({ data: quotationData() });
      const rate = await prisma.deliveryRate.create({ data: rateData(quotation.id, zone.id) });
      const role = await prisma.$queryRaw<{ superuser: boolean; bypass: boolean }[]>`SELECT rolsuper AS superuser, rolbypassrls AS bypass FROM pg_roles WHERE rolname = current_user`;
      expect(role).toEqual([{ superuser: false, bypass: false }]);
      return { zone, quotation, rate };
    });
    await b.run(async () => {
      expect(await prisma.deliveryZone.findMany()).toEqual([]);
      expect(await prisma.deliveryZoneDistrict.findMany()).toEqual([]);
      expect(await prisma.quotation.findMany()).toEqual([]);
      expect(await prisma.deliveryRate.findMany()).toEqual([]);
      expect(await prisma.deliveryRate.updateMany({ where: { id: own.rate.id }, data: { priceAmount: 0 } })).toMatchObject({ count: 0 });
      await expect(prisma.deliveryZone.create({ data: { ...zoneData(), companyId: a.companyId } })).rejects.toThrow();
      const zone = await prisma.deliveryZone.create({ data: zoneData() });
      const quotation = await prisma.quotation.create({ data: quotationData() });
      await expect(prisma.deliveryZoneDistrict.create({ data: { method: "home", zoneId: own.zone.id, districtCode: "150122" } })).rejects.toMatchObject({ code: "P2003" });
      await expect(prisma.deliveryRate.create({ data: rateData(own.quotation.id, zone.id) })).rejects.toMatchObject({ code: "P2003" });
      await expect(prisma.deliveryRate.create({ data: rateData(quotation.id, own.zone.id) })).rejects.toMatchObject({ code: "P2003" });
      await expect(prisma.quotation.create({ data: { ...quotationData(), companyId: a.companyId } })).rejects.toThrow();
    });
  } finally { await Promise.all([a.cleanup(), b.cleanup()]); }
});

test("failed rate insertion rolls back the quotation and all previously inserted rates", async () => {
  const f = await fixture();
  try {
    await f.run(async () => {
      const zone = await prisma.deliveryZone.create({ data: zoneData() });
      await expect(withinTransaction(async () => {
        const quotation = await prisma.quotation.create({ data: quotationData() });
        await prisma.deliveryRate.create({ data: rateData(quotation.id, zone.id) });
        await prisma.deliveryRate.create({ data: rateData(quotation.id, zone.id) });
        return ok(null);
      })).rejects.toMatchObject({ code: "P2002" });
      expect(await prisma.quotation.count()).toBe(0);
      expect(await prisma.deliveryRate.count()).toBe(0);
      expect(await prisma.deliveryZone.count()).toBe(1);
    });
  } finally { await f.cleanup(); }
});
