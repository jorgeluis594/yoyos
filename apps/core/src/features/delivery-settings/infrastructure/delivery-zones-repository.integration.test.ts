import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { ok } from "@shared/functional";
import type { DeliveryZone } from "@core/src/features/delivery-settings/domain/delivery-zone";
import { deliverySettings } from "@core/src/features/delivery-settings/composition";
import { readDeliveryConfiguration, writeDeliveryZones } from "@core/src/features/delivery-settings/infrastructure/delivery-zones-repository";
import { writeDeliverySettings } from "@core/src/features/delivery-settings/infrastructure/delivery-settings-repository";
import { prisma, withTenantIsolation, withinTransaction } from "@core/src/shared/infrastructure/persistance";

const fields = { name: " Nearby ", enabled: true, districtCodes: ["150122"], price: { amount: 8, currency: "PEN" as const } };
const existing = ({ id, name, enabled, districtCodes, price }: DeliveryZone) => ({ kind: "existing" as const, id, name, enabled, districtCodes, price });
async function fixture() {
  const companyId = randomUUID();
  const context = { companyId, userId: "seller" };
  const run = <T>(work: () => Promise<T>) => withTenantIsolation(companyId, async () => await work());
  await run(() => prisma.company.create({ data: { id: companyId, name: "Zone repository test", country: "PE" } }));
  return { companyId, context, run, cleanup: () => run(async () => {
    await prisma.deliveryRate.deleteMany();
    await prisma.quotation.deleteMany();
    await prisma.deliveryZoneDistrict.deleteMany();
    await prisma.deliveryZone.deleteMany();
    await prisma.companyCourier.deleteMany();
    await prisma.companyDeliverySettings.deleteMany();
    await prisma.company.delete({ where: { id: companyId } });
  }) };
}

test("zone saves preserve independent methods and general settings, retain disabled coverage and never generate rates", async () => {
  const f = await fixture();
  try {
    await f.run(async () => {
      expect(await deliverySettings.getZones(f.context)).toEqual(ok({ home: { enabled: false }, agency: { enabled: false }, version: 0, currency: "PEN", zones: [] }));
      expect(await prisma.companyDeliverySettings.count()).toBe(0);
      const home = await deliverySettings.saveZones({ method: "home", expectedVersion: 0, zones: [
        { kind: "new", ...fields }, { kind: "new", ...fields, name: "Free", price: { amount: 0, currency: "PEN" } },
      ] }, f.context);
      if (!home.success) throw new Error(home.error.message);
      expect(home.data).toMatchObject({ version: 1, home: { enabled: false }, agency: { enabled: false }, zones: [{ name: "Nearby" }, { name: "Free" }] });
      expect(await prisma.deliveryZoneDistrict.count({ where: { districtCode: "150122" } })).toBe(2);
      expect(await deliverySettings.save({ expectedVersion: 1, home: { enabled: true }, agency: { enabled: true },
        couriers: [{ kind: "new", name: "Courier", enabled: true }], store: { enabled: true, pickupPoint: { name: "Shop", address: "Street", instructions: null } } }, f.context))
        .toMatchObject({ success: true, data: { version: 2 } });
      const agency = await deliverySettings.saveZones({ method: "agency", expectedVersion: 2, zones: [{ kind: "new", ...fields, name: "Agency", price: { amount: 5, currency: "PEN" } }] }, f.context);
      if (!agency.success) throw new Error(agency.error.message);
      const agencyZone = agency.data.zones.find(zone => zone.method === "agency");
      const changed = await deliverySettings.saveZones({ method: "home", expectedVersion: 3,
        zones: home.data.zones.map(zone => ({ ...existing(zone), enabled: false, name: `${zone.name} disabled` })),
      }, f.context);
      if (!changed.success) throw new Error(changed.error.message);
      expect(changed.data.version).toBe(4);
      expect(changed.data.zones.find(zone => zone.method === "agency")).toEqual(agencyZone);
      expect(changed.data.zones.filter(zone => zone.method === "home").every(zone => !zone.enabled && zone.districtCodes.some(code => code === "150122"))).toBe(true);
      expect(await deliverySettings.get(f.context)).toMatchObject({ success: true, data: { version: 4, home: { enabled: true }, agency: { enabled: true },
        couriers: [{ name: "Courier", enabled: true }], store: { enabled: true, pickupPoint: { name: "Shop", address: "Street" } } } });
      expect(await prisma.quotation.count()).toBe(0);
      expect(await prisma.deliveryRate.count()).toBe(0);
      expect(await deliverySettings.saveZones({ method: "home", expectedVersion: 4, zones: [] }, f.context)).toMatchObject({ success: false, error: { code: "INVALID_DELIVERY_ZONE" } });
      expect((await deliverySettings.getZones(f.context))).toMatchObject({ success: true, data: { version: 4, zones: expect.arrayContaining([...changed.data.zones]) } });
    });
  } finally { await f.cleanup(); }
});

test("shared versions serialize concurrent initial zone creations and subsequent edits without duplicated zones", async () => {
  const f = await fixture();
  try {
    const create = () => f.run(() => deliverySettings.saveZones({ method: "home", expectedVersion: 0, zones: [{ kind: "new", ...fields }] }, f.context));
    const creations = await Promise.all([create(), create()]);
    expect(creations.filter(result => result.success)).toHaveLength(1);
    expect(creations.find(result => !result.success)).toMatchObject({ error: { code: "DELIVERY_SETTINGS_CONFLICT" } });
    const winner = creations.find(result => result.success);
    if (!winner?.success) throw new Error("Expected one initial save");
    const edits = await Promise.all([10, 12].map(amount => f.run(() => deliverySettings.saveZones({ method: "home", expectedVersion: 1,
      zones: winner.data.zones.map(zone => ({ ...existing(zone), price: { amount, currency: "PEN" } })),
    }, f.context))));
    expect(edits.filter(result => result.success)).toHaveLength(1);
    expect(edits.find(result => !result.success)).toMatchObject({ error: { code: "DELIVERY_SETTINGS_CONFLICT", currentVersion: 2 } });
    await f.run(async () => {
      expect(await prisma.deliveryZone.count()).toBe(1);
      expect(await prisma.deliveryZoneDistrict.count()).toBe(1);
      expect(await deliverySettings.getZones(f.context)).toEqual(edits.find(result => result.success));
    });
  } finally { await f.cleanup(); }
});

test("failed zone persistence rolls back the shared version and all earlier zone and district edits", async () => {
  const f = await fixture();
  try {
    await f.run(async () => {
      const initial = await deliverySettings.saveZones({ method: "home", expectedVersion: 0, zones: [{ kind: "new", ...fields }] }, f.context);
      if (!initial.success) throw new Error(initial.error.message);
      const zone = initial.data.zones[0];
      const result = await withinTransaction(async () => {
        const current = await readDeliveryConfiguration(f.companyId, "exclusive");
        if (!current.success) return current;
        const updated = await writeDeliverySettings(f.companyId, { ...current.data.settings, version: 2 });
        if (!updated.success) return updated;
        return writeDeliveryZones(f.companyId, "home", [
          { ...zone, name: "Changed", districtCodes: ["040110" as typeof zone.districtCodes[number]] },
          { ...zone, id: randomUUID() as typeof zone.id, districtCodes: [zone.districtCodes[0], zone.districtCodes[0]] },
        ]);
      });
      expect(result).toMatchObject({ success: false, error: { code: "SERVICE_UNAVAILABLE" } });
      expect(await deliverySettings.getZones(f.context)).toEqual(initial);
      expect(await prisma.deliveryZone.count()).toBe(1);
      expect(await prisma.deliveryZoneDistrict.findMany()).toMatchObject([{ zoneId: zone.id, districtCode: "150122" }]);
    });
  } finally { await f.cleanup(); }
});

test("stored zones are validated and foreign identities cannot be edited or moved between methods", async () => {
  const [a, b] = await Promise.all([fixture(), fixture()]);
  try {
    const own = await a.run(() => deliverySettings.saveZones({ method: "home", expectedVersion: 0, zones: [{ kind: "new", ...fields }] }, a.context));
    if (!own.success) throw new Error(own.error.message);
    const zone = own.data.zones[0];
    await b.run(async () => {
      expect(await deliverySettings.getZones(b.context)).toMatchObject({ success: true, data: { version: 0, zones: [] } });
      expect(await deliverySettings.saveZones({ method: "home", expectedVersion: 0, zones: [existing(zone)] }, b.context))
        .toMatchObject({ success: false, error: { code: "INVALID_DELIVERY_ZONE" } });
      expect(await prisma.companyDeliverySettings.count()).toBe(0);
    });
    await a.run(async () => {
      expect(await deliverySettings.saveZones({ method: "agency", expectedVersion: 1, zones: [existing(zone)] }, a.context))
        .toMatchObject({ success: false, error: { code: "INVALID_DELIVERY_ZONE" } });
      await prisma.deliveryZoneDistrict.deleteMany({ where: { zoneId: zone.id } });
      expect(await deliverySettings.getZones(a.context)).toMatchObject({ success: false, error: { code: "INTERNAL_ERROR" } });
    });
  } finally { await Promise.all([a.cleanup(), b.cleanup()]); }
});
