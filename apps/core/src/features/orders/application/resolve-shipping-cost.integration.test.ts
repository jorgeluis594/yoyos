import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { ok } from "@shared/functional";
import type { CompanyId } from "@shared/identity";
import { deliverySettings } from "@core/src/features/delivery-settings";
import { deleteAgencies, insertAgency, seededCatalogId } from "@core/src/features/delivery-settings/infrastructure/courier-catalog-fixture";
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
      const saved = await deliverySettings.saveZones({ expectedVersion: 0, zones: [0, 8].map(amount => ({
        kind: "new" as const, name: "Zone", enabled: true, districtCodes: ["150122"],
        options: [{ kind: "new" as const, method: "home" as const, name: "Home", enabled: true, price: { amount, currency: "PEN" as const } }],
      })) }, context);
      if (!saved.success) throw new Error(saved.error.message);
      expect((await deliverySettings.save({ expectedVersion: 1, home: { enabled: true }, agency: { enabled: false }, couriers: [],
        store: { enabled: true, pickupPoint: { name: "Shop", address: "Street", instructions: null } } }, context)).success).toBe(true);
      const quote = await deliverySettings.createQuotation({ companyId, country: "PE", districtCode: "150122", address: null, instructions: null });
      if (!quote.success) throw new Error(quote.error.message);
      const rate = quote.data.rates.find(value => value.rate.price.amount === 8)?.rate;
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
        pricing: { quotationId: quote.data.quotation.id, rateId: rate.id, optionId: rate.optionId, settingsVersion: 2 },
        destination: { districtCode: "150122", district: "MIRAFLORES", province: "LIMA METROPOLITANA" }, recordedBy: { kind: "buyer" },
      } } });
      expect(await resolve({ method: "store", recipient }, 0)).toMatchObject({ success: true, data: { cost: { amount: 0 }, delivery: {
        method: "store", settingsVersion: 2, pickupPoint: { name: "Shop" },
      } } });
      expect(await resolve(input, 7)).toMatchObject({ success: false, error: { code: "TOTAL_CHANGED", currentPrice: { amount: 8 } } });
      const zones = (price: (optionId: string) => number, enabled: (optionId: string) => boolean = () => true) => saved.data.zones.map(zone => ({
        kind: "existing" as const, id: zone.id, name: zone.name, enabled: true, districtCodes: zone.districtCodes,
        options: zone.options.map(option => ({ kind: "existing" as const, id: option.id, method: "home" as const, name: option.name,
          enabled: enabled(option.id), price: { amount: price(option.id), currency: "PEN" as const } })),
      }));
      expect((await deliverySettings.saveZones({ expectedVersion: 2, zones: zones(id => id === rate.optionId ? 8 : 1) }, context)).success).toBe(true);
      expect(await resolve(input, 8)).toMatchObject({ success: true, data: { delivery: { pricing: { settingsVersion: 2 } } } });
      expect((await deliverySettings.saveZones({ expectedVersion: 3, zones: zones(id => id === rate.optionId ? 10 : 1) }, context)).success).toBe(true);
      expect(await resolve(input, 8)).toMatchObject({ success: false, error: { code: "TOTAL_CHANGED", currentPrice: { amount: 10 } } });
      expect((await deliverySettings.saveZones({ expectedVersion: 4, zones: zones(id => id === rate.optionId ? 10 : 1, id => id !== rate.optionId) }, context)).success).toBe(true);
      expect(await resolve(input, 8)).toMatchObject({ success: false, error: { code: "RATE_UNAVAILABLE" } });
      expect(await prisma.quotation.count()).toBe(1);
      expect(await prisma.deliveryRate.count()).toBe(2);
      expect((await prisma.deliveryRate.findUnique({ where: { id: rate.id } }))?.priceAmount.toNumber()).toBe(8);
    });
  } finally {
    await run(async () => {
      await prisma.deliveryRate.deleteMany();
      await prisma.quotation.deleteMany();
      await prisma.deliveryOption.deleteMany();
      await prisma.deliveryZoneDistrict.deleteMany();
      await prisma.deliveryZone.deleteMany();
      await prisma.companyDeliverySettings.deleteMany();
      await prisma.company.deleteMany({ where: { id: companyId } });
    });
  }
});

test("agency resolution is serialized with zone saves: a snapshot never mixes an agency with a later association change", async () => {
  const companyId = randomUUID() as CompanyId;
  const run = <T>(work: () => Promise<T>) => withTenantIsolation(companyId, async () => await work());
  const context = { companyId, userId: "seller" };
  const catalogId = await seededCatalogId();
  const [kept, dropped, unlinked] = await Promise.all(["Kept", "Dropped", "Unlinked"].map(name => insertAgency({ courierId: catalogId, name, districtCode: "150122" })));
  try {
    await run(async () => {
      await prisma.company.create({ data: { id: companyId, name: "Agency resolution", country: "PE" } });
      expect((await deliverySettings.save({ expectedVersion: 0, home: { enabled: false }, agency: { enabled: true }, couriers: [{ kind: "new", catalogId, enabled: true }],
        store: { enabled: false, pickupPoint: null } }, context)).success).toBe(true);
      const saved = await deliverySettings.saveZones({ expectedVersion: 1, zones: [{ kind: "new", name: "Zone", enabled: true, districtCodes: ["040110"], options: [
        { kind: "new", method: "agency", name: "Agency", enabled: true, price: { amount: 4, currency: "PEN" }, agencyIds: [kept, dropped] }] }] }, context);
      if (!saved.success) throw new Error(saved.error.message);
      const quote = await deliverySettings.createQuotation({ companyId, country: "PE", districtCode: "040110", address: null, instructions: null });
      if (!quote.success) throw new Error(quote.error.message);
      const [offered] = quote.data.rates;
      if (!("agencies" in offered)) throw new Error("Expected an agency rate");
      expect(offered.agencies.map(value => value.agency.id).sort()).toEqual([kept, dropped].sort());
      const recipient = { name: "Ana", phone: "999", identity: { kind: "document", documentType: "national_id", document: "12345678" } };
      const selection = (agencyId: string) => ({ method: "agency", rateId: offered.rate.id, recipient, districtCode: "040110", agencyId });
      const resolve = (agencyId: string) => resolveShippingCost(selection(agencyId), { companyId, author: { kind: "buyer" } }, "PEN", { amount: 4, currency: "PEN" }, {
        getStoreSettings: async id => {
          const loaded = await readDeliveryConfiguration(id, "shared");
          return loaded.success ? ok(loaded.data.settings) : loaded;
        },
        resolveSelectedDeliveryRate: deliverySettings.resolveSelectedDeliveryRate,
      });
      expect(await withinTransaction(() => resolve(unlinked))).toMatchObject({ success: false, error: { code: "RATE_UNAVAILABLE" } });
      expect(await withinTransaction(() => resolve(dropped))).toMatchObject({ success: true, data: { cost: { amount: 4 }, delivery: { method: "agency",
        courier: { name: "Shalom" }, agency: { id: dropped, name: "Dropped", address: "Av. Test 123", location: { districtCode: "150122" } },
        destination: { districtCode: "040110" }, pricing: { optionId: offered.rate.optionId } } } });

      let assigning!: () => void;
      let finishAssigning!: () => void;
      const reached = new Promise<void>(resolve => { assigning = resolve; });
      const gate = new Promise<void>(resolve => { finishAssigning = resolve; });
      let zonesSaved = false;
      const assignment = run(() => withinTransaction(async () => {
        const resolved = await resolve(dropped);
        assigning();
        await gate;
        return resolved;
      }));
      await reached;
      const zone = saved.data.zones[0];
      const removal = run(() => deliverySettings.saveZones({ expectedVersion: 2, zones: [{ kind: "existing", id: zone.id, name: zone.name, enabled: true, districtCodes: zone.districtCodes,
        options: [{ kind: "existing", id: zone.options[0].id, method: "agency", name: "Agency", enabled: true, price: { amount: 4, currency: "PEN" }, agencyIds: [kept] }] }] }, context))
        .then(result => { zonesSaved = true; return result; });
      await new Promise(resolve => setTimeout(resolve, 300));
      expect(zonesSaved).toBe(false);
      finishAssigning();
      expect(await assignment).toMatchObject({ success: true, data: { delivery: { agency: { id: dropped } } } });
      expect(await removal).toMatchObject({ success: true, data: { version: 3 } });
      expect(await withinTransaction(() => resolve(dropped))).toMatchObject({ success: false, error: { code: "RATE_UNAVAILABLE" } });
      expect(await withinTransaction(() => resolve(kept))).toMatchObject({ success: true, data: { delivery: { agency: { id: kept } } } });
    });
  } finally {
    await run(async () => {
      await prisma.deliveryRate.deleteMany();
      await prisma.quotation.deleteMany();
      await prisma.deliveryOptionAgency.deleteMany();
      await prisma.deliveryOption.deleteMany();
      await prisma.deliveryZoneDistrict.deleteMany();
      await prisma.deliveryZone.deleteMany();
      await prisma.companyCourier.deleteMany();
      await prisma.companyDeliverySettings.deleteMany();
      await prisma.company.deleteMany({ where: { id: companyId } });
    });
    await deleteAgencies([kept, dropped, unlinked]);
  }
});
