import { expect, test } from "vitest";
import { recipientForCheckout, recipientForKeptDelivery, withBuyerAsRecipient } from "@core/src/features/orders/domain/checkout-recipient";

const buyer = { name: "Ana", phone: "+51977909427" };
const selection = { method: "agency", recipient: { name: "Luis", phone: " +14155552671 ", identity: { kind: "document", document: "1" } } };

test("the buyer is the recipient unless someone else receives, keeping the rest of the recipient", () => {
  expect(recipientForCheckout(selection, buyer, false)).toEqual({ success: true, data: { method: "agency", recipient: { ...buyer, identity: selection.recipient.identity } } });
});

test("another recipient is kept with a trimmed international phone", () => {
  expect(recipientForCheckout(selection, buyer, true)).toMatchObject({ success: true, data: { recipient: { name: "Luis", phone: "+14155552671" } } });
});

test("another recipient needs an international phone", () => {
  expect(recipientForCheckout({ ...selection, recipient: { ...selection.recipient, phone: "999" } }, buyer, true)).toMatchObject({ success: false, error: { code: "INVALID_RECIPIENT" } });
});

test("a kept delivery goes to the buyer unless the form names another recipient with a valid phone", () => {
  expect(recipientForKeptDelivery({ name: "Luis", phone: "+14155552671" }, buyer, false)).toEqual({ success: true, data: buyer });
  expect(recipientForKeptDelivery(undefined, buyer, false)).toEqual({ success: true, data: buyer });
  expect(recipientForKeptDelivery({ name: " Luis ", phone: " +14155552671 " }, buyer, true)).toEqual({ success: true, data: { name: "Luis", phone: "+14155552671" } });
  expect(recipientForKeptDelivery({ name: "Luis", phone: "999" }, buyer, true)).toMatchObject({ success: false, error: { code: "INVALID_RECIPIENT" } });
  expect(recipientForKeptDelivery(undefined, buyer, true)).toMatchObject({ success: false });
});

test("the client's recipient fields are replaced by the buyer's before validation unless someone else receives", () => {
  const body = { buyer, otherRecipient: false, delivery: { kind: "replace", selection: { method: "store", recipient: { name: "", phone: "", identity: { kind: "absent" } } } } };
  expect(withBuyerAsRecipient(body)).toMatchObject({ delivery: { selection: { recipient: { ...buyer, identity: { kind: "absent" } } } } });
  const other = { ...body, otherRecipient: true };
  expect(withBuyerAsRecipient(other)).toBe(other);
  expect(withBuyerAsRecipient({ buyer, delivery: { kind: "keep", recipient: { name: "x", phone: "y" } } })).toEqual({ buyer, delivery: { kind: "keep" } });
  expect(withBuyerAsRecipient(null)).toBeNull();
});
