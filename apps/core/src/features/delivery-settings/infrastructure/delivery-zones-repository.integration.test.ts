import { randomUUID } from "node:crypto";
import { deleteAgencies, insertAgency, seededCourier } from "@core/src/features/delivery-settings/infrastructure/courier-catalog-fixture";
import { expect, test } from "vitest";
import { ok } from "@shared/functional";
import type { CompanyId } from "@shared/identity";
import type { DeliveryZone } from "@core/src/features/delivery-settings/domain/delivery-zone";
import { deliverySettings } from "@core/src/features/delivery-settings/composition";
import { readDeliveryConfiguration, writeDeliveryZones } from "@core/src/features/delivery-settings/infrastructure/delivery-zones-repository";
import { writeDeliverySettings } from "@core/src/features/delivery-settings/infrastructure/delivery-settings-repository";
import { prisma, withTenantIsolation, withinTransaction } from "@core/src/shared/infrastructure/persistance";

const option = { kind: "new" as const, method: "home" as const, name: "Standard", enabled: true, price: { amount: 8, currency: "PEN" as const } };
const fields = { name: " Nearby ", enabled: true, districtCodes: ["150122"], options: [option] };
const existing = ({ id, name, enabled, districtCodes, options }: DeliveryZone) => ({ kind: "existing" as const, id, name, enabled, districtCodes,
  options: options.map(({ id, name, enabled, price, ...value }) => ({ kind: "existing" as const, id, name, enabled, price,
    ...(value.method === "agency" ? { method: value.method, agencyIds: [...value.agencyIds] } : { method: value.method }) })) });
async function fixture() {
  const companyId = randomUUID();
  const context = { companyId, userId: "seller" };
  const run = <T>(work: () => Promise<T>) => withTenantIsolation(companyId, async () => await work());
  await run(() => prisma.company.create({ data: { id: companyId, name: "Zone repository test", country: "PE" } }));
  return { companyId, context, run, cleanup: () => run(async () => {
    await prisma.deliveryRate.deleteMany();
    await prisma.quotation.deleteMany();
    await prisma.deliveryOptionAgency.deleteMany();
    await prisma.deliveryOption.deleteMany();
    await prisma.deliveryZoneDepartment.deleteMany();
    await prisma.deliveryZoneProvince.deleteMany();
    await prisma.deliveryZoneDistrict.deleteMany();
    await prisma.deliveryZone.deleteMany();
    await prisma.companyCourier.deleteMany();
    await prisma.companyDeliverySettings.deleteMany();
    await prisma.company.delete({ where: { id: companyId } });
  }) };
}

test("zone saves keep general settings, retain disabled zones and options and never generate rates", async () => {
  const f = await fixture();
  try {
    await f.run(async () => {
      expect(await deliverySettings.getZones(f.context)).toEqual(ok({ home: { enabled: false }, agency: { enabled: false }, version: 0, currency: "PEN", zones: [], agencies: [] }));
      expect(await prisma.companyDeliverySettings.count()).toBe(0);
      const saved = await deliverySettings.saveZones({ expectedVersion: 0, zones: [
        { kind: "new", ...fields },
        { kind: "new", ...fields, name: "Free", options: [{ ...option, name: "Free", price: { amount: 0, currency: "PEN" } },
          { ...option, name: "Express", price: { amount: 5, currency: "PEN" } }] },
      ] }, f.context);
      if (!saved.success) throw new Error(saved.error.message);
      expect(saved.data).toMatchObject({ version: 1, home: { enabled: false }, agency: { enabled: false }, zones: [{ name: "Nearby" }, { name: "Free" }] });
      expect(await prisma.deliveryZoneDistrict.count({ where: { districtCode: "150122" } })).toBe(2);
      expect(await prisma.deliveryOption.count()).toBe(3);
      expect(await deliverySettings.save({ expectedVersion: 1, home: { enabled: true }, agency: { enabled: true },
        store: { enabled: true, pickupPoint: { name: "Shop", address: "Street", instructions: null } } }, f.context))
        .toMatchObject({ success: true, data: { version: 2 } });
      const changed = await deliverySettings.saveZones({ expectedVersion: 2, zones: saved.data.zones.map(zone => ({ ...existing(zone), enabled: false,
        name: `${zone.name} disabled`, options: existing(zone).options.map(value => ({ ...value, enabled: false })) })) }, f.context);
      if (!changed.success) throw new Error(changed.error.message);
      expect(changed.data.version).toBe(3);
      expect(changed.data.zones.every(zone => !zone.enabled && zone.options.every(value => !value.enabled) && zone.districtCodes.some(code => code === "150122"))).toBe(true);
      expect(changed.data.zones.map(zone => zone.options.map(value => value.id))).toEqual(saved.data.zones.map(zone => zone.options.map(value => value.id)));
      expect(await deliverySettings.get(f.context)).toMatchObject({ success: true, data: { version: 3, home: { enabled: true }, agency: { enabled: true },
        couriers: [], store: { enabled: true, pickupPoint: { name: "Shop", address: "Street" } } } });
      expect(await prisma.quotation.count()).toBe(0);
      expect(await prisma.deliveryRate.count()).toBe(0);
      expect(await deliverySettings.saveZones({ expectedVersion: 3, zones: [] }, f.context)).toMatchObject({ success: false, error: { code: "INVALID_DELIVERY_ZONE" } });
      const [first] = saved.data.zones;
      expect(await deliverySettings.saveZones({ expectedVersion: 3, zones: [{ ...existing(first), options: [] }, existing(saved.data.zones[1])] }, f.context))
        .toMatchObject({ success: false, error: { code: "INVALID_DELIVERY_OPTION" } });
      // Reads order by id, saves keep input order.
      const byId = (zones: readonly DeliveryZone[]) => [...zones].sort((left, right) => left.id.localeCompare(right.id))
        .map(zone => ({ ...zone, options: [...zone.options].sort((left, right) => left.id.localeCompare(right.id)) }));
      const reloaded = await deliverySettings.getZones(f.context);
      if (!reloaded.success) throw new Error(reloaded.error.message);
      expect(reloaded.data.version).toBe(3);
      expect(byId(reloaded.data.zones)).toEqual(byId(changed.data.zones));
    });
  } finally { await f.cleanup(); }
});

test("zones and options round trip through the repository in a stable order", async () => {
  const f = await fixture();
  try {
    await f.run(async () => {
      const saved = await deliverySettings.saveZones({ expectedVersion: 0, zones: [{ kind: "new", ...fields }] }, f.context);
      if (!saved.success) throw new Error(saved.error.message);
      const loaded = await withinTransaction(() => readDeliveryConfiguration(f.companyId, "shared"));
      expect(loaded).toMatchObject({ success: true, data: { agencies: [], zones: saved.data.zones } });
      expect(saved.data.zones[0].options).toMatchObject([{ method: "home", name: "Standard", price: { amount: 8, currency: "PEN" } }]);
    });
  } finally { await f.cleanup(); }
});

test("shared versions serialize concurrent initial zone creations and subsequent edits without duplicated zones", async () => {
  const f = await fixture();
  try {
    const create = () => f.run(() => deliverySettings.saveZones({ expectedVersion: 0, zones: [{ kind: "new", ...fields }] }, f.context));
    const creations = await Promise.all([create(), create()]);
    expect(creations.filter(result => result.success)).toHaveLength(1);
    expect(creations.find(result => !result.success)).toMatchObject({ error: { code: "DELIVERY_SETTINGS_CONFLICT" } });
    const winner = creations.find(result => result.success);
    if (!winner?.success) throw new Error("Expected one initial save");
    const edits = await Promise.all([10, 12].map(amount => f.run(() => deliverySettings.saveZones({ expectedVersion: 1,
      zones: winner.data.zones.map(zone => ({ ...existing(zone), options: existing(zone).options.map(value => ({ ...value, price: { amount, currency: "PEN" as const } })) })),
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
      const initial = await deliverySettings.saveZones({ expectedVersion: 0, zones: [{ kind: "new", ...fields }] }, f.context);
      if (!initial.success) throw new Error(initial.error.message);
      const zone = initial.data.zones[0];
      const result = await withinTransaction(async () => {
        const current = await readDeliveryConfiguration(f.companyId, "exclusive");
        if (!current.success) return current;
        const updated = await writeDeliverySettings(f.companyId, { ...current.data.settings, version: 2 });
        if (!updated.success) return updated;
        return writeDeliveryZones(f.companyId, [
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
    const own = await a.run(() => deliverySettings.saveZones({ expectedVersion: 0, zones: [{ kind: "new", ...fields }] }, a.context));
    if (!own.success) throw new Error(own.error.message);
    const zone = own.data.zones[0];
    await b.run(async () => {
      expect(await deliverySettings.getZones(b.context)).toMatchObject({ success: true, data: { version: 0, zones: [] } });
      expect(await deliverySettings.saveZones({ expectedVersion: 0, zones: [existing(zone)] }, b.context))
        .toMatchObject({ success: false, error: { code: "INVALID_DELIVERY_ZONE" } });
      expect(await prisma.companyDeliverySettings.count()).toBe(0);
    });
    await a.run(async () => {
      const option = zone.options[0];
      expect(await deliverySettings.saveZones({ expectedVersion: 1, zones: [{ ...existing(zone), options: [{ ...existing(zone).options[0], method: "agency", agencyIds: [] }] }] }, a.context))
        .toMatchObject({ success: false, error: { code: "INVALID_DELIVERY_OPTION", field: "method", index: 0, optionIndex: 0 } });
      expect(await deliverySettings.saveZones({ expectedVersion: 1, zones: [existing(zone),
        { kind: "new", ...fields, options: [{ ...existing(zone).options[0], id: option.id }] }] }, a.context))
        .toMatchObject({ success: false, error: { code: "INVALID_DELIVERY_OPTION", field: "id", index: 1, optionIndex: 0 } });
      await prisma.deliveryZoneDistrict.deleteMany({ where: { zoneId: zone.id } });
      expect(await deliverySettings.getZones(a.context)).toMatchObject({ success: false, error: { code: "INTERNAL_ERROR" } });
    });
  } finally { await Promise.all([a.cleanup(), b.cleanup()]); }
});

test("agency options keep their catalog associations, replace them on save and return disabled agencies", async () => {
  const f = await fixture();
  const courier = await seededCourier();
  const [first, second, other] = await Promise.all([insertAgency({ courierId: courier.id, name: "First" }),
    insertAgency({ courierId: courier.id, name: "Second", enabled: false }), insertAgency({ courierId: (await seededCourier("olva")).id, name: "Other" })]);
  const agencyOption = (agencyIds: string[]) => ({ kind: "new" as const, method: "agency" as const, name: "Agency", enabled: true, price: { amount: 5, currency: "PEN" as const }, agencyIds });
  try {
    await f.run(async () => {
      expect(await deliverySettings.save({ expectedVersion: 0, home: { enabled: false }, agency: { enabled: true },
        store: { enabled: false, pickupPoint: null } }, f.context)).toMatchObject({ success: true });
      // An agency outside the catalog is rejected and nothing is written.
      expect(await deliverySettings.saveZones({ expectedVersion: 1, zones: [{ kind: "new", ...fields, options: [agencyOption([first, randomUUID()])] }] }, f.context))
        .toMatchObject({ success: false, error: { code: "INVALID_DELIVERY_OPTION", field: "agencyIds", optionIndex: 0 } });
      expect(await prisma.deliveryZone.count()).toBe(0);
      const saved = await deliverySettings.saveZones({ expectedVersion: 1, zones: [{ kind: "new", ...fields, options: [agencyOption([first, second])] }] }, f.context);
      if (!saved.success) throw new Error(saved.error.message);
      expect(saved.data.agencies.map(agency => [agency.id, agency.enabled]).sort()).toEqual([[first, true], [second, false]].sort());
      expect(await prisma.deliveryOptionAgency.count()).toBe(2);
      const zone = saved.data.zones[0];
      const replaced = await deliverySettings.saveZones({ expectedVersion: 2, zones: [{ ...existing(zone), options: [{ kind: "existing", id: zone.options[0].id, method: "agency", name: "Agency", enabled: true, price: { amount: 5, currency: "PEN" }, agencyIds: [second] }] }] }, f.context);
      if (!replaced.success) throw new Error(replaced.error.message);
      expect(replaced.data.agencies.map(agency => agency.id)).toEqual([second]);
      expect((await prisma.deliveryOptionAgency.findMany()).map(row => row.agencyId)).toEqual([second]);
      const loaded = await deliverySettings.getZones(f.context);
      expect(loaded).toMatchObject({ success: true, data: { agencies: [{ id: second, enabled: false }], zones: [{ options: [{ agencyIds: [second] }] }] } });
      // The company ships with Shalom only: switching the option to an Olva agency enables Olva and disables Shalom in the same write.
      expect(await deliverySettings.saveZones({ expectedVersion: 3, zones: [{ ...existing(zone), options: [{ kind: "existing", id: zone.options[0].id, method: "agency", name: "Agency", enabled: true, price: { amount: 5, currency: "PEN" }, agencyIds: [other] }] }] }, f.context))
        .toMatchObject({ success: true, data: { version: 4 } });
      expect(await deliverySettings.get(f.context)).toMatchObject({ success: true, data: { couriers: expect.arrayContaining([expect.objectContaining({ name: "Shalom", enabled: false }), expect.objectContaining({ name: "Olva Courier", enabled: true })]) } });
    });
  } finally { await f.cleanup(); await deleteAgencies([first, second, other]); }
});

const zonaSur = { kind: "new" as const, name: "Zona sur", enabled: true, departmentCodes: ["04", "08"], provinceCodes: [], districtCodes: [],
  options: [{ ...option, name: "Domicilio", price: { amount: 15, currency: "PEN" as const } }] };
const enableHome = { home: { enabled: true }, agency: { enabled: false }, store: { enabled: false as const, pickupPoint: null } };

test("delivery zones repository stores and reads whole departments and provinces as units", async () => {
  const f = await fixture();
  try {
    await f.run(async () => {
      const saved = await deliverySettings.saveZones({ expectedVersion: 0, zones: [zonaSur,
        { ...zonaSur, name: "Lima", departmentCodes: [], provinceCodes: ["1501"], districtCodes: ["040103"] }] }, f.context);
      if (!saved.success) throw new Error(saved.error.message);
      const byName = <T extends { name: string }>(zones: readonly T[]) => [...zones].sort((x, y) => x.name.localeCompare(y.name));
      expect(byName(saved.data.zones).map(({ departmentCodes, provinceCodes, districtCodes }) => ({ departmentCodes, provinceCodes, districtCodes }))).toEqual([
        { departmentCodes: [], provinceCodes: ["1501"], districtCodes: ["040103"] }, { departmentCodes: ["04", "08"], provinceCodes: [], districtCodes: [] }]);
      expect(await prisma.deliveryZoneDistrict.count()).toBe(1);
      const loaded = await withinTransaction(() => readDeliveryConfiguration(f.companyId, "shared"));
      expect(loaded).toMatchObject({ success: true, data: { zones: [...saved.data.zones].sort((x, y) => x.id.localeCompare(y.id)) } });
      const [lima, sur] = byName(saved.data.zones);
      const edited = await deliverySettings.saveZones({ expectedVersion: 1, zones: [{ ...existing(sur), departmentCodes: ["04"] },
        { ...existing(lima), provinceCodes: [...lima.provinceCodes] }] }, f.context);
      expect(edited).toMatchObject({ success: true, data: { zones: expect.arrayContaining([expect.objectContaining({ id: sur.id, departmentCodes: ["04"] })]) } });
      expect(await prisma.deliveryZoneDepartment.count()).toBe(1);
    });
  } finally { await f.cleanup(); }
});

test("delivery zone unit rows are isolated by company", async () => {
  const [a, b] = [await fixture(), await fixture()];
  try {
    await a.run(async () => { await deliverySettings.saveZones({ expectedVersion: 0, zones: [zonaSur] }, a.context); });
    await b.run(async () => {
      expect(await prisma.deliveryZoneDepartment.count()).toBe(0);
      expect(await prisma.deliveryZoneProvince.count()).toBe(0);
    });
    await a.run(async () => { expect(await prisma.deliveryZoneDepartment.count()).toBe(2); });
  } finally { await a.cleanup(); await b.cleanup(); }
});

test("quotation for Cayma returns the rate of a zone with Arequipa complete and Miraflores gets none", async () => {
  const f = await fixture();
  try {
    await f.run(async () => {
      expect((await deliverySettings.saveZones({ expectedVersion: 0, zones: [zonaSur] }, f.context)).success).toBe(true);
      expect((await deliverySettings.save({ expectedVersion: 1, ...enableHome }, f.context)).success).toBe(true);
      const quote = (districtCode: string) => deliverySettings.createQuotation({ companyId: f.companyId as CompanyId, country: "PE", districtCode, address: null, instructions: null });
      expect(await quote("040103")).toMatchObject({ success: true, data: { rates: [{ zoneName: "Zona sur", rate: { price: { amount: 15, currency: "PEN" } } }] } });
      expect(await quote("080101")).toMatchObject({ success: true, data: { rates: [{ zoneName: "Zona sur" }] } });
      expect(await quote("150122")).toMatchObject({ success: true, data: { rates: [] } });
    });
  } finally { await f.cleanup(); }
});

test("resolving a rate quoted through a complete province succeeds at order creation", async () => {
  const f = await fixture();
  try {
    await f.run(async () => {
      expect((await deliverySettings.saveZones({ expectedVersion: 0, zones: [{ ...zonaSur, departmentCodes: [], provinceCodes: ["1501"] }] }, f.context)).success).toBe(true);
      expect((await deliverySettings.save({ expectedVersion: 1, ...enableHome }, f.context)).success).toBe(true);
      const quote = async (districtCode: string) => await deliverySettings.createQuotation({ companyId: f.companyId as CompanyId, country: "PE", districtCode, address: null, instructions: null });
      const miraflores = await quote("150122");
      const huaral = await quote("150601");
      if (!miraflores.success || !huaral.success) throw new Error("Expected quotations");
      expect(huaral.data.rates).toEqual([]);
      const { rate } = miraflores.data.rates[0];
      expect(await deliverySettings.resolveSelectedDeliveryRate({ companyId: f.companyId as CompanyId, rateId: rate.id, method: "home", districtCode: rate.districtCode }))
        .toMatchObject({ success: true, data: { price: { amount: 15, currency: "PEN" } } });
    });
  } finally { await f.cleanup(); }
});

test("settings saves with a stale version after a zones save return a conflict and keep the zones", async () => {
  const f = await fixture();
  try {
    await f.run(async () => {
      expect((await deliverySettings.saveZones({ expectedVersion: 0, zones: [zonaSur] }, f.context)).success).toBe(true);
      expect(await deliverySettings.save({ expectedVersion: 0, ...enableHome }, f.context))
        .toMatchObject({ success: false, error: { code: "DELIVERY_SETTINGS_CONFLICT", currentVersion: 1 } });
      expect(await deliverySettings.getZones(f.context)).toMatchObject({ success: true, data: { zones: [{ departmentCodes: ["04", "08"] }] } });
    });
  } finally { await f.cleanup(); }
});
