import assert from "node:assert/strict";
import test from "node:test";
import { classifyDispatchLabel, prepareOrderDispatchLabel } from "./build.ts";

const id = "00000000-0000-4000-8000-000000000001";
const district = { country: "PE", districtCode: "150122", district: "Miraflores", province: "Lima", department: "Lima" };
const pricing = { quotationId: id, rateId: id, optionId: id, settingsVersion: 1 };
const recordedBy = { kind: "seller", userId: "u" };
const recipient = { name: "Ana", phone: "999", identity: { kind: "document", documentType: "national_id", document: "12345678" } };
const sender = { name: "Yoyos", phone: "977000111" };

const home = { method: "home", recipient: { ...recipient, identity: { kind: "absent" } }, pricing, recordedBy,
  destination: { address: "Calle 2", ...district, instructions: "Portón azul" } };
const agency = { method: "agency", recipient, destination: district, pricing, recordedBy, courier: { id, name: "Olva" },
  agency: { id, name: "Olva Centro", address: "Av. 1", location: { ...district, district: "Surco" } } };
const store = { method: "store", recipient, pickupPoint: {}, settingsVersion: 1, recordedBy };
const order = (patch) => ({ id, number: 1042, status: "active", cancelled: false, deliveryStatus: "pending", scheduledDispatchDate: "2026-10-20", delivery: home, ...patch });

test("builds a home label with sender, order number and scheduled date", () => {
  assert.deepEqual(classifyDispatchLabel(order({}), sender), { label: { sender, orderNumber: 1042, scheduledDate: "2026-10-20", method: "home", courier: null,
    recipient: { name: "Ana", phone: "999", document: null }, destination: { address: "Calle 2", location: { department: "Lima", province: "Lima", district: "Miraflores" }, reference: "Portón azul" } } });
});

test("builds an agency label with the order number and no date", () => {
  assert.deepEqual(classifyDispatchLabel(order({ delivery: agency, scheduledDispatchDate: null }), { name: "Yoyos", phone: null }), { label: { sender: { name: "Yoyos", phone: null }, orderNumber: 1042, scheduledDate: null, method: "agency", courier: "Olva",
    recipient: { name: "Ana", phone: "999", document: { type: "national_id", number: "12345678" } },
    destination: { agencyName: "Olva Centro", address: "Av. 1", location: { department: "Lima", province: "Lima", district: "Surco" } } } });
});

test("excludes store pickup, unassigned delivery and cancelled orders with their reason", () => {
  const codes = [order({ delivery: store }), order({ delivery: null }), order({ cancelled: true, status: "cancelled" })].map((value) => classifyDispatchLabel(value, sender).exclusion.code);
  assert.deepEqual(codes, ["METHOD_NOT_APPLICABLE", "DELIVERY_NOT_ASSIGNED", "CANCELLED"]);
});

test("names the missing fields of incomplete home and agency data", () => {
  assert.deepEqual(classifyDispatchLabel(order({ delivery: { ...home, recipient: { ...home.recipient, name: " " }, destination: { ...home.destination, address: "" } } }), sender).exclusion,
    { code: "MISSING_DATA", fields: ["recipientName", "address"] });
  assert.deepEqual(classifyDispatchLabel(order({ delivery: { ...agency, recipient: { ...recipient, identity: { kind: "absent" } }, courier: { id, name: "" } } }), sender).exclusion,
    { code: "MISSING_DATA", fields: ["recipientDocument", "courier"] });
});

test("a label that does not fit is excluded with LABEL_CONTENT_OVERFLOW", () => {
  assert.deepEqual(prepareOrderDispatchLabel(order({}), sender, () => false), { status: "excluded", exclusion: { code: "LABEL_CONTENT_OVERFLOW" } });
  assert.equal(prepareOrderDispatchLabel(order({}), sender, () => true).status, "ready");
});
