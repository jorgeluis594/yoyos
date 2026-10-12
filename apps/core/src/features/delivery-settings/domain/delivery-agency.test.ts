import { expect, test } from "vitest";
import { parseDeliveryAgency } from "@core/src/features/delivery-settings/domain/delivery-agency";

const row = { id: "00000000-0000-4000-8000-000000000201", courierId: "00000000-0000-4000-8000-000000000101",
  name: "Shalom Miraflores", address: "Av. Larco 100", districtCode: "150122", enabled: true, courierEnabled: true };

test("a catalog row with a district from the Peru catalog parses", () => {
  expect(parseDeliveryAgency(row)).toMatchObject({ success: true, data: row });
});

test("a district outside the Peru catalog, or malformed data, is stored data that is invalid", () => {
  for (const invalid of [{ ...row, districtCode: "999999" }, { ...row, districtCode: "15" }, { ...row, name: " " }, { ...row, id: "x" }, { ...row, extra: 1 }])
    expect(parseDeliveryAgency(invalid)).toMatchObject({ success: false, error: { code: "INVALID_STORED_DATA" } });
});
