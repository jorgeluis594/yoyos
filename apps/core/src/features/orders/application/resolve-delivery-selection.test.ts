import { expect, test } from "vitest";
import { parseRatedDeliverySelection, parseDeliverySnapshot } from "@core/src/features/orders/domain/order-state-machine";

const recipient = { name: "Ana", phone: "999", identity: { kind: "absent" as const } };
const selection = { method: "store" as const, recipient };
const point = { name: "Tienda", address: "Av. Lima 123", instructions: null };

test("rejects partial recipients, forged authority and obsolete snapshots while preserving document text", () => {
  for (const value of [{ ...selection, recipient: { ...recipient, name: " " } }, { ...selection, recordedBy: { kind: "buyer" } },
    { ...selection, pickupPoint: point }, { ...selection, cost: 0 }]) expect(parseRatedDeliverySelection(value).success).toBe(false);
  const documented = { ...selection, recipient: { ...recipient, identity: { kind: "document", documentType: "passport", document: "00-A-001" } } };
  expect(parseRatedDeliverySelection(documented)).toMatchObject({ success: true, data: { recipient: { identity: { document: "00-A-001" } } } });
  expect(parseRatedDeliverySelection({ ...documented, recipient: { ...recipient, identity: { kind: "document", documentType: "unknown", document: "001" } } }).success).toBe(false);
  expect(parseDeliverySnapshot({ ...selection, destination: { storeId: "old" } }).success).toBe(false);
  expect(parseDeliverySnapshot({ ...selection, pickupPoint: point, recordedBy: { kind: "seller" } }).success).toBe(false);
});
