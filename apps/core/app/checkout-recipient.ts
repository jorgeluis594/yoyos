import { z } from "zod";
import { internationalPhonePattern, savedPhoneForForm } from "@shared/phone";
import { checkoutBuyerSchema } from "@shared/contracts/order-checkout";

type Person = Readonly<{ name: string | null; phone: string | null }>;

/** Whether a saved delivery opens with «Otra persona recibe el pedido» checked: its recipient is not the buyer. */
export function otherPersonReceives(recipient: Readonly<{ name: string; phone: string }> | null | undefined, buyer: Person | null): boolean {
  if (!recipient) return false;
  return recipient.name.trim() !== (buyer?.name ?? "").trim() || savedPhoneForForm(recipient.phone) !== savedPhoneForForm(buyer?.phone ?? "");
}

/** The buyer form: the buyer's data plus, when someone else receives, who receives; all its errors come out of one validation. */
export const checkoutFormSchema = checkoutBuyerSchema.extend({ otherRecipient: z.boolean(), recipientName: z.string(), recipientPhone: z.string() })
  .superRefine((form, context) => {
    if (!form.otherRecipient) return;
    if (!form.recipientName.trim()) context.addIssue({ code: "custom", path: ["recipientName"], message: "name" });
    if (!internationalPhonePattern.test(form.recipientPhone.trim())) context.addIssue({ code: "custom", path: ["recipientPhone"], message: "phone" });
  });
export type CheckoutForm = z.infer<typeof checkoutFormSchema>;
