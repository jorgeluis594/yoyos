import { expect, test } from "vitest";
import type { DeliveryZonesState } from "@core/src/features/delivery-settings/application/delivery-zones";
import type { DeliveryAgency } from "@core/src/features/delivery-settings/domain/delivery-agency";
import { toDeliveryZonesResponse } from "@core/src/features/delivery-settings/presentation/zones-response";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const agency = (value: number, enabled: boolean, courierEnabled: boolean) => ({ id: id(value), courierId: id(100), name: `Agencia ${value}`, address: "Av. 1",
  districtCode: "150122", enabled, courierEnabled }) as unknown as DeliveryAgency;
const state = (agencies: readonly DeliveryAgency[]) => ({ home: { enabled: true }, agency: { enabled: true }, version: 1, currency: "PEN", zones: [], agencies }) as unknown as DeliveryZonesState;

test("zones response marks an agency inactive when its catalog courier is retired", () => {
  const response = toDeliveryZonesResponse(state([agency(1, true, true), agency(2, true, false), agency(3, false, true), agency(4, false, false)]));
  expect(response.agencies.map(value => value.enabled)).toEqual([true, false, false, false]);
});
