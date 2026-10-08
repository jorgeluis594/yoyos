import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { ok } from "@shared/functional";
import type { CompanyId } from "@shared/identity";
import { deliverySettings } from "@core/src/features/delivery-settings";
import { readDeliveryConfiguration } from "@core/src/features/delivery-settings/infrastructure/delivery-zones-repository";
import { resolveShippingCost } from "@core/src/features/orders/application/resolve-delivery-selection";
import { prisma, withTenantIsolation, withinTransaction } from "@core/src/shared/infrastructure/persistance";

test("shipping resolution reads persisted rates under the configuration transaction and preserves immutable price snapshots", async () => {
  const companyId = randomUUID() as CompanyId;
  const run = <T>(work: () => Promise<T>) => withTenantIsolation(companyId, async () => await work());
  const context = { companyId, userId: "seller" };
  try {
    await run(async () => {
      await prisma.company.create({ data: { id: companyId, name: "Shipping resolution", country: "PE" } });
      const saved = await deliverySettings.saveZones({ method: "home", expectedVersion: 0, zones: [0, 8].map(amount => ({
        kind: "new" as const, name: "Zone", enabled: true, districtCodes: ["150122"], price: { amount, currency: "PEN" as const },
      })) }, context);
      if (!saved.success) throw new Error(saved.error.message);
      expect((await deliverySettings.save({ expectedVersion: 1, home: { enabled: true }, agency: { enabled: false }, couriers: [],
        store: { enabled: true, pickupPoint: { name: "Shop", address: "Street", instructions: null } } }, context)).success).toBe(true);
      const quote = await deliverySettings.createQuotation({ companyId, country: "PE", districtCode: "150122", address: null, instructions: null });
      if (!quote.success) throw new Error(quote.error.message);
      const rate = quote.data.rates.find(value => value.price.amount === 8);
      if (!rate) throw new Error("Expected paid option");
      const recipient = { name: "Ana", phone: "999", identity: { kind: "absent" } };
      const input = { method: "home", rateId: rate.id, recipient, destination: { districtCode: "150122", address: "Street", instructions: null } };
      const resolve = (selection: unknown, amount: number) => withinTransaction(() => resolveShippingCost(selection,
        { companyId, author: { kind: "buyer" } }, "PEN", { amount, currency: "PEN" }, {
          getStoreSettings: async id => {
            const loaded = await readDeliveryConfiguration(id, "shared");
            return loaded.success ? ok(loaded.data.settings) : loaded;
          },
          resolveSelectedDeliveryRate: deliverySettings.resolveSelectedDeliveryRate,
        }));
      expect(await resolve(input, 8)).toMatchObject({ success: true, data: { cost: { amount: 8 }, delivery: {
        pricing: { quotationId: quote.data.quotation.id, rateId: rate.id, zoneId: rate.zoneId, settingsVersion: 2 },
        destination: { districtCode: "150122", district: "MIRAFLORES", province: "LIMA METROPOLITANA" }, recordedBy: { kind: "buyer" },
      } } });
      expect(await resolve({ method: "store", recipient }, 0)).toMatchObject({ success: true, data: { cost: { amount: 0 }, delivery: {
        method: "store", settingsVersion: 2, pickupPoint: { name: "Shop" },
      } } });
      expect(await resolve(input, 7)).toMatchObject({ success: false, error: { code: "TOTAL_CHANGED", currentPrice: { amount: 8 } } });
      const zones = saved.data.zones.map(zone => ({ kind: "existing" as const, id: zone.id, name: zone.name, enabled: true,
        districtCodes: zone.districtCodes, price: { amount: zone.id === rate.zoneId ? 8 : 1, currency: "PEN" as const } }));
      expect((await deliverySettings.saveZones({ method: "home", expectedVersion: 2, zones }, context)).success).toBe(true);
      expect(await resolve(input, 8)).toMatchObject({ success: true, data: { delivery: { pricing: { settingsVersion: 2 } } } });
      const changed = zones.map(zone => ({ ...zone, price: { ...zone.price, amount: zone.id === rate.zoneId ? 10 : 1 } }));
      expect((await deliverySettings.saveZones({ method: "home", expectedVersion: 3, zones: changed }, context)).success).toBe(true);
      expect(await resolve(input, 8)).toMatchObject({ success: false, error: { code: "TOTAL_CHANGED", currentPrice: { amount: 10 } } });
      expect((await deliverySettings.saveZones({ method: "home", expectedVersion: 4,
        zones: changed.map(zone => ({ ...zone, enabled: zone.id !== rate.zoneId })) }, context)).success).toBe(true);
      expect(await resolve(input, 8)).toMatchObject({ success: false, error: { code: "RATE_UNAVAILABLE" } });
      expect(await prisma.quotation.count()).toBe(1);
      expect(await prisma.deliveryRate.count()).toBe(2);
      expect((await prisma.deliveryRate.findUnique({ where: { id: rate.id } }))?.priceAmount.toNumber()).toBe(8);
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
