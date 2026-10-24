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
