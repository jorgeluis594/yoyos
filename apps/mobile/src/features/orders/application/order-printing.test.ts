import type { OrderAggregateResponse } from "@shared/contracts/orders";
import { err, ok } from "@shared/functional";
import { prepareDispatchLabels } from "@mobile/features/orders/application/order-printing";

const id = "00000000-0000-4000-8000-000000000001";
const district = { country: "PE" as const, districtCode: "150122", district: "Miraflores", province: "Lima", department: "Lima" };
const pricing = { quotationId: id, rateId: id, optionId: id, settingsVersion: 1 };
const recordedBy = { kind: "seller" as const, userId: "u" };
const document = { kind: "document" as const, documentType: "national_id" as const, document: "12345678" };
const recipient = { name: "Ana", phone: "999", identity: document };

const home = { method: "home" as const, recipient: { ...recipient, identity: { kind: "absent" as const } }, pricing, recordedBy,
  destination: { address: "Calle 2", ...district, instructions: "Portón azul" } };
const agency = { method: "agency" as const, recipient, destination: district, pricing, recordedBy, courier: { id, name: "Olva" },
  agency: { id, name: "Olva Centro", address: "Av. 1", location: { ...district, district: "Surco" } } };
const store = { method: "store" as const, recipient, pickupPoint: {}, settingsVersion: 1, recordedBy };

const order = (patch: Record<string, unknown>) => ({ id, status: "active", cancelled: false, deliveryStatus: "pending", scheduledDispatchDate: "2026-10-20", delivery: home, ...patch }) as unknown as OrderAggregateResponse;
const prepare = (orders: Record<string, OrderAggregateResponse | "fail">, fits = () => true) => prepareDispatchLabels(Object.keys(orders), {
  sender: "Yoyos", fits,
  readOrder: async (orderId) => orders[orderId] === "fail" ? err({ message: "network" }) : ok(orders[orderId] as OrderAggregateResponse),
});

test("prepares home and agency labels from the stored snapshot, without payment as a condition", async () => {
  const [homeResult, agencyResult] = await prepare({ a: order({ paymentStatus: "pending", deliveryStatus: "shipped" }), b: order({ delivery: agency, scheduledDispatchDate: null, deliveryStatus: "delivered" }) });
  expect(homeResult).toEqual({ status: "ready", orderId: "a", label: { sender: "Yoyos", scheduledDate: "2026-10-20", method: "home", courier: null,
    recipient: { name: "Ana", phone: "999", document: null }, destination: { address: "Calle 2", location: { department: "Lima", province: "Lima", district: "Miraflores" }, reference: "Portón azul" } } });
  expect(agencyResult).toEqual({ status: "ready", orderId: "b", label: { sender: "Yoyos", scheduledDate: null, method: "agency", courier: "Olva",
    recipient: { name: "Ana", phone: "999", document: { type: "national_id", number: "12345678" } },
    destination: { agencyName: "Olva Centro", address: "Av. 1", location: { department: "Lima", province: "Lima", district: "Surco" } } } });
});

test("excludes store pickup, unassigned delivery and cancelled orders with their reason", async () => {
  const results = await prepare({ a: order({ delivery: store }), b: order({ delivery: null }), c: order({ cancelled: true, status: "cancelled" }) });
  expect(results.map((result) => result.status === "excluded" && result.exclusion.code)).toEqual(["METHOD_NOT_APPLICABLE", "DELIVERY_NOT_ASSIGNED", "CANCELLED"]);
});

test("names the missing fields of incomplete home and agency data", async () => {
  const [homeResult, agencyResult] = await prepare({
    a: order({ delivery: { ...home, recipient: { ...home.recipient, name: " " }, destination: { ...home.destination, address: "" } } }),
    b: order({ delivery: { ...agency, recipient: { ...recipient, identity: { kind: "absent" } }, courier: { id, name: "" } } }),
  });
  expect(homeResult).toMatchObject({ status: "excluded", exclusion: { code: "MISSING_DATA", fields: ["recipientName", "address"] } });
  expect(agencyResult).toMatchObject({ status: "excluded", exclusion: { code: "MISSING_DATA", fields: ["recipientDocument", "courier"] } });
});

test("excludes a label whose content does not fit", async () => {
  expect(await prepare({ a: order({}) }, () => false)).toEqual([{ status: "excluded", orderId: "a", exclusion: { code: "LABEL_CONTENT_OVERFLOW" } }]);
});

test("a failed read is a read error and does not stop the rest of a mixed selection", async () => {
  const results = await prepare({ a: "fail", b: order({}), c: order({ delivery: store }), d: order({ delivery: agency }) });
  expect(results.map((result) => result.status)).toEqual(["read-error", "ready", "excluded", "ready"]);
  expect(results[0]).toEqual({ status: "read-error", orderId: "a", error: { message: "network" } });
});

test("reads with bounded concurrency", async () => {
  let active = 0, peak = 0;
  const ids = Array.from({ length: 12 }, (_, index) => `o${index}`);
  await prepareDispatchLabels(ids, { sender: "Yoyos", fits: () => true, readOrder: async () => {
    peak = Math.max(peak, ++active); await new Promise((resolve) => setTimeout(resolve, 1)); active--; return ok(order({}));
  } });
  expect(peak).toBeLessThanOrEqual(4);
  expect(peak).toBeGreaterThan(1);
});
