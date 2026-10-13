import type { DispatchLabel, DispatchLabelExclusion } from "@mobile/features/orders/domain/dispatch-label";

const location = { department: "Lima", province: "Lima", district: "Miraflores" };
const base = { sender: "Yoyos", scheduledDate: null };
const document = { type: "national_id", number: "12345678" } as const;

const agency: DispatchLabel = {
  ...base, method: "agency", courier: "Olva",
  recipient: { name: "Ana", phone: "999", document },
  destination: { agencyName: "Olva Centro", address: "Av. 1", location },
};
const home: DispatchLabel = {
  ...base, method: "home", courier: null,
  recipient: { name: "Ana", phone: "999", document: null },
  destination: { address: "Calle 2", location, reference: null },
};
// @ts-expect-error An agency label requires the recipient document.
const agencyWithoutDocument: DispatchLabel = { ...agency, recipient: { name: "Ana", phone: "999", document: null } };
// @ts-expect-error An agency label requires a courier.
const agencyWithoutCourier: DispatchLabel = { ...agency, courier: null };
// @ts-expect-error Missing-data exclusions must name at least one field.
const emptyMissing: DispatchLabelExclusion = { code: "MISSING_DATA", fields: [] };

test("agency and home labels are constructible", () => {
  expect([agency.method, home.method]).toEqual(["agency", "home"]);
  void [agencyWithoutDocument, agencyWithoutCourier, emptyMissing];
});
