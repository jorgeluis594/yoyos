import { expect, test } from "vitest";
import { latestSettings, pickupCommit, settingsRequest, type Confirmed } from "@core/app/components/use-instant-delivery-settings";
import type { DeliverySettingsResponse, DeliveryZonesResponse } from "@shared/contracts/delivery-settings";

const point = { name: "Tienda Cercado", address: "Calle Mercaderes 210", instructions: null };
const confirmed = (store: Confirmed["store"] = { enabled: false, pickupPoint: null }): Confirmed =>
  ({ version: 4, home: { enabled: true }, agency: { enabled: false }, store });
const empty = { name: "", address: "", instructions: "" };

test("settingsRequest changes only the toggled method over the confirmed settings", () => {
  const base = confirmed({ enabled: true, pickupPoint: point });
  expect(settingsRequest(base, { method: "agency", enabled: true })).toEqual({ expectedVersion: 4, home: { enabled: true }, agency: { enabled: true }, store: { enabled: true, pickupPoint: point } });
  expect(settingsRequest(base, { method: "home", enabled: false })).toEqual({ expectedVersion: 4, home: { enabled: false }, agency: { enabled: false }, store: { enabled: true, pickupPoint: point } });
  expect(settingsRequest(base, { method: "store", store: { enabled: false, pickupPoint: point } }).store).toEqual({ enabled: false, pickupPoint: point });
});

test("pickupCommit activates store when name and address are saved during an activation attempt", () => {
  expect(pickupCommit(confirmed(), { name: " Tienda Cercado ", address: "Calle Mercaderes 210", instructions: "" }, true))
    .toEqual({ kind: "save", store: { enabled: true, pickupPoint: point } });
  expect(pickupCommit(confirmed(), { name: "Tienda Cercado", address: "Calle Mercaderes 210", instructions: "" }, false))
    .toEqual({ kind: "save", store: { enabled: false, pickupPoint: point } });
});

test("pickupCommit does not send an incomplete point and keeps the confirmed one", () => {
  expect(pickupCommit(confirmed({ enabled: true, pickupPoint: point }), { ...pickupDraft(), name: "" }, false)).toEqual({ kind: "invalid", fields: ["name"] });
  expect(pickupCommit(confirmed(), { ...empty, instructions: "Timbre" }, true)).toEqual({ kind: "invalid", fields: ["name", "address"] });
  expect(pickupCommit(confirmed({ enabled: true, pickupPoint: point }), empty, false)).toEqual({ kind: "invalid", fields: ["name", "address"] });
});

test("pickupCommit clears the point when the three fields are emptied with store disabled", () => {
  expect(pickupCommit(confirmed({ enabled: false, pickupPoint: point }), empty, false)).toEqual({ kind: "save", store: { enabled: false, pickupPoint: null } });
});

test("pickupCommit sends nothing when the draft equals the confirmed point", () => {
  expect(pickupCommit(confirmed({ enabled: true, pickupPoint: point }), { ...pickupDraft(), name: " Tienda Cercado " }, false)).toEqual({ kind: "none" });
  expect(pickupCommit(confirmed(), empty, false)).toEqual({ kind: "none" });
});

test("an older loader revalidation never overwrites a newer save", () => {
  const loaded = { ...confirmed(), couriers: [] } satisfies DeliverySettingsResponse;
  const newer = { ...loaded, version: 6, agency: { enabled: true } };
  expect(latestSettings(loaded, newer, undefined)).toBe(newer);
  expect(latestSettings(newer, loaded, undefined)).toBe(newer);
  const zones = { version: 7, home: { enabled: false }, agency: { enabled: true } } as DeliveryZonesResponse;
  expect(latestSettings(loaded, newer, zones)).toMatchObject({ version: 7, home: { enabled: false }, agency: { enabled: true }, store: loaded.store });
});

function pickupDraft() { return { name: point.name, address: point.address, instructions: "" }; }
