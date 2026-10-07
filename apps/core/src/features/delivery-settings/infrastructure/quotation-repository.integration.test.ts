import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { ok } from "@shared/functional";
import { deliverySettings } from "@core/src/features/delivery-settings/composition";
import { findRateWithQuotation, insertQuotationWithRates } from "@core/src/features/delivery-settings/infrastructure/quotation-repository";
import { prisma, withTenantIsolation, withinTransaction } from "@core/src/shared/infrastructure/persistance";

test("quotations persist all overlapping rates, remain immutable, isolate tenants and roll back failed writes", async () => {
  const companyId = randomUUID();
  const otherId = randomUUID();
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
      await prisma.deliveryZone.update({ where: { id: rate.zoneId }, data: { enabled: false, priceAmount: 99 } });
      expect(await withinTransaction(() => findRateWithQuotation(companyId, rate.id))).toEqual(ok({ quotation: first.data.quotation, rate }));
      expect(await withTenantIsolation(otherId, async () => await withinTransaction(() => findRateWithQuotation(otherId, rate.id)))).toEqual(ok(null));
      const empty = await deliverySettings.createQuotation({ ...request, districtCode: "040110" });
      expect(empty).toMatchObject({ success: true, data: { rates: [] } });
      expect(await prisma.quotation.count()).toBe(3);
      expect(await prisma.deliveryRate.count()).toBe(6);
      expect((await deliverySettings.get(context))).toMatchObject({ success: true, data: { version: 2 } });
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
