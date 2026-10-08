import { randomUUID } from "node:crypto";
import { expect, test, vi } from "vitest";
import type { CompanyId } from "@shared/identity";
import { ok } from "@shared/functional";
import { deliverySettings } from "@core/src/features/delivery-settings/composition";
import { readDeliveryConfiguration } from "@core/src/features/delivery-settings/infrastructure/delivery-zones-repository";
import { findRateWithQuotation, insertQuotationWithRates } from "@core/src/features/delivery-settings/infrastructure/quotation-repository";
import { prisma, systemPrisma, withTenantIsolation, withinTransaction } from "@core/src/shared/infrastructure/persistance";

test("quotations persist all overlapping rates, remain immutable, isolate tenants and roll back failed writes", async () => {
  const companyId = randomUUID() as CompanyId;
  const otherId = randomUUID() as CompanyId;
  const context = { companyId, userId: "seller" };
  const run = <T>(work: () => Promise<T>) => withTenantIsolation(companyId, async () => await work());
  try {
    await run(async () => {
      await prisma.company.create({ data: { id: companyId, name: "Quotation test", country: "PE" } });
      const zones = await deliverySettings.saveZones({ method: "home", expectedVersion: 0, zones: [0, 8, 8].map(amount => ({
        kind: "new" as const, name: "Zone", enabled: true, districtCodes: ["150122"], price: { amount, currency: "PEN" as const },
      })) }, context);
      expect(zones.success).toBe(true);
      expect((await deliverySettings.save({ expectedVersion: 1, home: { enabled: true }, agency: { enabled: false }, couriers: [],
        store: { enabled: false, pickupPoint: null } }, context)).success).toBe(true);
      const request = { companyId, country: "PE", districtCode: "150122", address: null, instructions: null };
      const first = await deliverySettings.createQuotation(request);
      const second = await deliverySettings.createQuotation(request);
      if (!first.success || !second.success) throw new Error("Expected quotations");
      expect(first.data.rates).toHaveLength(3);
      expect(second.data.quotation.id).not.toBe(first.data.quotation.id);
      const rate = first.data.rates[0];
      expect(await withinTransaction(() => findRateWithQuotation(companyId, rate.id))).toEqual(ok({ quotation: first.data.quotation, rate }));
      const selection = { companyId, rateId: rate.id, method: rate.method, districtCode: rate.districtCode };
      expect(await deliverySettings.resolveSelectedDeliveryRate(selection)).toMatchObject({ success: true, data: { price: rate.price, settingsVersion: 2 } });
      await prisma.companyDeliverySettings.update({ where: { companyId }, data: { version: 3 } });
      expect(await deliverySettings.resolveSelectedDeliveryRate(selection)).toMatchObject({ success: true, data: { settingsVersion: 2 } });
      await prisma.deliveryZone.update({ where: { id: rate.zoneId }, data: { priceAmount: 99 } });
      expect(await deliverySettings.resolveSelectedDeliveryRate(selection)).toMatchObject({ success: false, error: { code: "TOTAL_CHANGED", currentPrice: { amount: 99, currency: "PEN" } } });
      await prisma.deliveryZone.update({ where: { id: rate.zoneId }, data: { enabled: false } });
      expect(await deliverySettings.resolveSelectedDeliveryRate(selection)).toMatchObject({ success: false, error: { code: "RATE_UNAVAILABLE" } });
      expect(await withinTransaction(() => findRateWithQuotation(companyId, rate.id))).toEqual(ok({ quotation: first.data.quotation, rate }));
      expect(await withTenantIsolation(otherId, async () => await withinTransaction(() => findRateWithQuotation(otherId, rate.id)))).toEqual(ok(null));
      const empty = await deliverySettings.createQuotation({ ...request, districtCode: "040110" });
      expect(empty).toMatchObject({ success: true, data: { rates: [] } });
      expect(await prisma.quotation.count()).toBe(3);
      expect(await prisma.deliveryRate.count()).toBe(6);
      expect((await deliverySettings.get(context))).toMatchObject({ success: true, data: { version: 3 } });
      const failedId = randomUUID() as typeof first.data.quotation.id;
      const failed = await withinTransaction(() => insertQuotationWithRates({ quotation: { ...first.data.quotation, id: failedId },
        rates: first.data.rates.map(value => ({ ...value, quotationId: failedId })) }));
      expect(failed).toMatchObject({ success: false, error: { code: "SERVICE_UNAVAILABLE" } });
      expect(await prisma.quotation.count()).toBe(3);
      expect(await prisma.deliveryRate.count()).toBe(6);
      await prisma.quotation.update({ where: { id: first.data.quotation.id }, data: { destination: {
        country: "PE", districtCode: "040110", address: null, instructions: null,
      } } });
      expect(await withinTransaction(() => findRateWithQuotation(companyId, rate.id))).toMatchObject({ success: false, error: { code: "INTERNAL_ERROR" } });
    });
  } finally {
    await run(async () => {
      await prisma.deliveryRate.deleteMany();
      await prisma.quotation.deleteMany();
      await prisma.deliveryZoneDistrict.deleteMany();
      await prisma.deliveryZone.deleteMany();
      await prisma.companyDeliverySettings.deleteMany();
      await prisma.company.deleteMany({ where: { id: companyId } });
    });
  }
});


test("quotation generation waits for a complete concurrent price and coverage update", async () => {
  const companyId = randomUUID() as CompanyId;
  const context = { companyId, userId: "seller" };
  const run = <T>(work: () => Promise<T>) => withTenantIsolation(companyId, async () => await work());
  let release!: () => void;
  let written!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const partialWrite = new Promise<void>(resolve => { written = resolve; });
  try {
    const zones = await run(async () => {
      await prisma.company.create({ data: { id: companyId, name: "Concurrent quotation", country: "PE" } });
      const saved = await deliverySettings.saveZones({ method: "home", expectedVersion: 0, zones: [8, 12].map(amount => ({
        kind: "new" as const, name: "Zone", enabled: true, districtCodes: ["150122"], price: { amount, currency: "PEN" as const },
      })) }, context);
      if (!saved.success) throw new Error("Expected zones");
      expect((await deliverySettings.save({ expectedVersion: 1, home: { enabled: true }, agency: { enabled: false }, couriers: [],
        store: { enabled: false, pickupPoint: null } }, context)).success).toBe(true);
      return saved.data.zones;
    });
    const writer = run(() => withinTransaction(async () => {
      expect((await readDeliveryConfiguration(companyId, "exclusive")).success).toBe(true);
      await prisma.deliveryZone.update({ where: { id: zones[0].id }, data: { priceAmount: 10 } });
      written();
      await hold;
      await prisma.deliveryZoneDistrict.updateMany({ where: { zoneId: zones[1].id }, data: { districtCode: "040110" } });
      await prisma.companyDeliverySettings.update({ where: { companyId }, data: { version: 3 } });
      return ok(null);
    }));
    await partialWrite;
    const reader = run(() => deliverySettings.createQuotation({ companyId, country: "PE", districtCode: "150122", address: null, instructions: null }));
    try {
      await vi.waitFor(async () => {
        const waiting = await systemPrisma.$queryRaw<{ count: bigint }[]>`SELECT count(*) AS count FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%CompanyDeliverySettings%'`;
        expect(Number(waiting[0].count)).toBeGreaterThan(0);
      });
    } finally { release(); }
    expect(await writer).toEqual(ok(null));
    const quotation = await reader;
    if (!quotation.success) throw new Error("Expected quotation");
    expect(quotation.data.rates).toHaveLength(1);
    expect(quotation.data.rates[0]).toMatchObject({ zoneId: zones[0].id, price: { amount: 10, currency: "PEN" }, settingsVersion: 3 });
    await run(async () => {
      expect(await withinTransaction(() => findRateWithQuotation(companyId, quotation.data.rates[0].id)))
        .toEqual(ok({ quotation: quotation.data.quotation, rate: quotation.data.rates[0] }));
      expect(await prisma.quotation.count()).toBe(1);
      expect(await prisma.deliveryRate.count()).toBe(1);
    });
  } finally {
    release();
    await run(async () => {
      await prisma.deliveryRate.deleteMany(); await prisma.quotation.deleteMany();
      await prisma.deliveryZoneDistrict.deleteMany(); await prisma.deliveryZone.deleteMany();
      await prisma.companyDeliverySettings.deleteMany(); await prisma.company.deleteMany({ where: { id: companyId } });
    });
  }
});
