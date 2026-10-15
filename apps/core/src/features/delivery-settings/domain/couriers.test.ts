import { expect, test } from "vitest";
import { syncCouriers, type Courier, type CourierCatalogEntry, type CourierCatalogId, type CourierCode, type CourierId } from "@core/src/features/delivery-settings/domain/delivery-settings";

const id = "00000000-0000-4000-8000-000000000001" as CourierId;
const newId = "00000000-0000-4000-8000-000000000002" as CourierId;
const shalomId = "00000000-0000-4000-8000-000000000101" as CourierCatalogId;
const olvaId = "00000000-0000-4000-8000-000000000102" as CourierCatalogId;
const catalog: readonly CourierCatalogEntry[] = [{ id: shalomId, code: "shalom" as CourierCode, name: "Shalom", enabled: true }, { id: olvaId, code: "olva" as CourierCode, name: "Olva Courier", enabled: false }];
const shalom: Courier = { id, catalogId: shalomId, name: "Shalom", enabled: true, catalogEnabled: true };

test("a courier referenced only by inactive options is added disabled, so the option can still be saved", () => {
  expect(syncCouriers([], [olvaId], [], catalog, () => newId))
    .toEqual([{ id: newId, catalogId: olvaId, name: "Olva Courier", enabled: false, catalogEnabled: false }]);
  expect(syncCouriers([], [shalomId], [shalomId], catalog, () => newId))
    .toEqual([{ id: newId, catalogId: shalomId, name: "Shalom", enabled: true, catalogEnabled: true }]);
});

test("enablement follows the shipping options only, and a catalog-disabled courier keeps its company flag", () => {
  // The catalog read is unfiltered: a temporarily disabled catalog entry is gated at quote time through catalogEnabled.
  const delisted: Courier = { ...shalom, catalogEnabled: false };
  expect(syncCouriers([delisted], [shalomId], [shalomId], catalog, () => newId)).toEqual([delisted]);
  expect(syncCouriers([shalom], [shalomId], [], catalog, () => newId)).toEqual([{ ...shalom, enabled: false }]);
  expect(syncCouriers([shalom], [], [], catalog, () => newId)).toEqual([{ ...shalom, enabled: false }]);
});
