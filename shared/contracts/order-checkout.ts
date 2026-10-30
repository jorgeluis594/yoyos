import { z } from "zod";
import { internationalPhonePattern } from "@shared/phone";
import { agencyDeliverySnapshotSchema, homeDeliverySnapshotSchema, ratedDeliverySelectionSchema, storeDeliverySnapshotSchema } from "@shared/contracts/orders";
import { moneySchema } from "@shared/contracts/money";
import { storeDeliverySettingsSchema } from "@shared/contracts/delivery-settings";

export const checkoutPathSchema = z.strictObject({ orderId: z.uuid() });
export const checkoutBuyerSchema = z.strictObject({ name: z.string().trim().min(1), phone: z.string().regex(internationalPhonePattern) });
const checkoutMoneySchema = moneySchema.extend({ amount: z.number().finite().nonnegative().refine((value) => /^\d+(?:\.\d{1,2})?$/.test(String(value))) });
export const confirmCheckoutSchema = z.strictObject({ buyer: checkoutBuyerSchema, expectedTotal: checkoutMoneySchema });
export type ConfirmCheckoutRequest = z.infer<typeof confirmCheckoutSchema>;
export const checkoutDeliveryChangeSchema = z.discriminatedUnion("kind", [
  /** `recipient` only travels with the form, to say who receives the delivery that is kept; it is never stored as such. */
  z.strictObject({ kind: z.literal("keep"), recipient: z.strictObject({ name: z.string(), phone: z.string() }).optional() }),
  z.strictObject({ kind: z.literal("replace"), selection: ratedDeliverySelectionSchema, expectedPrice: checkoutMoneySchema }),
]);
/** `otherRecipient` only travels with the form: it is never stored. Without it the buyer is the recipient. */
export const confirmCheckoutDeliverySchema = confirmCheckoutSchema.extend({ delivery: checkoutDeliveryChangeSchema, otherRecipient: z.boolean().default(false) });
export type ConfirmCheckoutDeliveryRequest = z.infer<typeof confirmCheckoutDeliverySchema>;
export const checkoutLinkSchema = z.strictObject({ url: z.url() });
export const checkoutDeliveryOptionsSchema = z.strictObject({
  home: z.strictObject({ enabled: z.boolean() }), agency: z.strictObject({ enabled: z.boolean(), covered: z.boolean() }), store: storeDeliverySettingsSchema,
});
export type CheckoutDeliveryOptions = z.infer<typeof checkoutDeliveryOptionsSchema>;
export const publicCheckoutDeliverySchema = z.discriminatedUnion("method", [
  homeDeliverySnapshotSchema.omit({ recordedBy: true }),
  agencyDeliverySnapshotSchema.omit({ recordedBy: true }),
  storeDeliverySnapshotSchema.omit({ recordedBy: true }),
]);
export const publicCheckoutSchema = z.strictObject({
  companyName: z.string(), number: z.number().int().safe().min(1001),
  buyer: z.strictObject({ name: z.string().nullable(), phone: z.string().nullable() }).nullable(),
  items: z.array(z.strictObject({ productName: z.string(), variantAttributes: z.record(z.string(), z.string()), sku: z.string().nullable(),
    // `z.httpUrl()` rejects IP and localhost hosts, which local storage endpoints use.
    imageUrl: z.url({ protocol: /^https?$/ }).nullable(),
    quantity: z.number().int().positive().safe(), unitPrice: checkoutMoneySchema, subtotal: checkoutMoneySchema })).min(1),
  itemsTotal: checkoutMoneySchema, deliveryCharge: checkoutMoneySchema, total: checkoutMoneySchema,
  delivery: publicCheckoutDeliverySchema.nullable(),
  state: z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("pending") }),
    z.strictObject({ kind: z.literal("confirmed"), confirmedAt: z.iso.datetime() }), z.strictObject({ kind: z.literal("cancelled") })]),
}).refine((value) => value.state.kind !== "confirmed" || value.buyer === null || (value.buyer.name === null && value.buyer.phone === null) || checkoutBuyerSchema.safeParse(value.buyer).success,
  { message: "Confirmed checkout buyer data is empty or complete", path: ["buyer"] });
export type PublicCheckoutResponse = z.infer<typeof publicCheckoutSchema>;
