import { ok, err } from "@shared/functional";
import type { Result } from "@shared/result";
import { internationalPhonePattern } from "@shared/phone";

type Person = Readonly<{ name: string; phone: string }>;
type WithRecipient = Readonly<{ recipient: Person }>;

/**
 * The recipient that a checkout saves. Unless someone else receives the order the buyer is the recipient,
 * whatever the form sent; otherwise the recipient's phone must be international like the buyer's.
 */
export function recipientForCheckout<Selection extends WithRecipient>(selection: Selection, buyer: Person, otherRecipient: boolean):
  Result<Selection, { code: "INVALID_RECIPIENT"; message: string }> {
  if (!otherRecipient) return ok({ ...selection, recipient: { ...selection.recipient, name: buyer.name, phone: buyer.phone } });
  return internationalPhonePattern.test(selection.recipient.phone.trim())
    ? ok({ ...selection, recipient: { ...selection.recipient, phone: selection.recipient.phone.trim() } })
    : err({ code: "INVALID_RECIPIENT", message: "The recipient phone must be international" });
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The request as if the buyer were the recipient, unless the form says someone else receives: whatever recipient fields the client sent
 * are replaced before validation, so a hidden or stale field can never fail (or change) a delivery that goes to the buyer.
 */
export function withBuyerAsRecipient(body: unknown): unknown {
  if (!isRecord(body) || body.otherRecipient === true || !isRecord(body.buyer) || !isRecord(body.delivery)) return body;
  const { name, phone } = body.buyer;
  if (typeof name !== "string" || typeof phone !== "string") return body;
  const person = { name, phone };
  if (body.delivery.kind === "keep") return { ...body, delivery: { kind: "keep" } };
  if (body.delivery.kind !== "replace" || !isRecord(body.delivery.selection) || !isRecord(body.delivery.selection.recipient)) return body;
  return { ...body, delivery: { ...body.delivery, selection: { ...body.delivery.selection, recipient: { ...body.delivery.selection.recipient, ...person } } } };
}

/** Who receives a delivery that is kept: the buyer, or the person the form names when someone else receives. */
export function recipientForKeptDelivery(recipient: Person | undefined, buyer: Person, otherRecipient: boolean):
  Result<Person, { code: "INVALID_RECIPIENT"; message: string }> {
  if (!otherRecipient) return ok({ name: buyer.name, phone: buyer.phone });
  if (!recipient || !recipient.name.trim() || !internationalPhonePattern.test(recipient.phone.trim()))
    return err({ code: "INVALID_RECIPIENT", message: "The recipient needs a name and an international phone" });
  return ok({ name: recipient.name.trim(), phone: recipient.phone.trim() });
}
