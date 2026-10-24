import type { DispatchLabel, DispatchLabelExclusion } from "@shared/dispatch-label/types";

const location = { department: "Lima", province: "Lima", district: "Miraflores" };
const base = { sender: { name: "Yoyos", phone: null }, orderNumber: 1, scheduledDate: null };
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

void [agency, home, agencyWithoutDocument, agencyWithoutCourier, emptyMissing];

// @ts-expect-error The sender is an object with a name and a nullable phone.
const stringSender: DispatchLabel = { ...home, sender: "Yoyos" };
// @ts-expect-error A label requires the order number.
const withoutNumber: DispatchLabel = { method: "home", sender: base.sender, scheduledDate: null, courier: null, recipient: home.recipient, destination: home.destination };
void [stringSender, withoutNumber];
