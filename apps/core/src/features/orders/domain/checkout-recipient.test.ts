import { expect, test } from "vitest";
import { recipientForCheckout } from "@core/src/features/orders/domain/checkout-recipient";

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
