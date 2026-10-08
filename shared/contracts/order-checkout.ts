import { z } from "zod";
import { internationalPhonePattern } from "@shared/phone";
import { deliverySnapshotSchemas, ratedDeliverySelectionSchema } from "@shared/contracts/orders";
import { moneySchema } from "@shared/contracts/money";

export const checkoutPathSchema = z.strictObject({ companyId: z.uuid(), orderId: z.uuid() });
export const checkoutBuyerSchema = z.strictObject({ name: z.string().trim().min(1), phone: z.string().regex(internationalPhonePattern) });
const checkoutMoneySchema = moneySchema.extend({ amount: z.number().finite().nonnegative().refine((value) => /^\d+(?:\.\d{1,2})?$/.test(String(value))) });
export const confirmCheckoutSchema = z.strictObject({ buyer: checkoutBuyerSchema, expectedTotal: checkoutMoneySchema });
export type ConfirmCheckoutRequest = z.infer<typeof confirmCheckoutSchema>;
export const checkoutDeliveryChangeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("keep") }),
  z.strictObject({ kind: z.literal("replace"), selection: ratedDeliverySelectionSchema, expectedPrice: checkoutMoneySchema }),
]);
export const confirmCheckoutDeliverySchema = confirmCheckoutSchema.extend({ delivery: checkoutDeliveryChangeSchema });
export type ConfirmCheckoutDeliveryRequest = z.infer<typeof confirmCheckoutDeliverySchema>;
export const checkoutLinkSchema = z.strictObject({ url: z.url() });
export const publicCheckoutDeliverySchema = z.union([
  deliverySnapshotSchemas[0].omit({ recordedBy: true }),
  deliverySnapshotSchemas[1].omit({ recordedBy: true }),
  deliverySnapshotSchemas[2].omit({ recordedBy: true }),
  deliverySnapshotSchemas[3].omit({ recordedBy: true }),
  deliverySnapshotSchemas[4].omit({ recordedBy: true }),
  deliverySnapshotSchemas[5].omit({ recordedBy: true }),
  deliverySnapshotSchemas[6].omit({ recordedBy: true })
]);
export const publicCheckoutSchema = z.strictObject({
  companyName: z.string(), number: z.number().int().safe().min(1001),
  buyer: z.strictObject({ name: z.string().nullable(), phone: z.string() }).nullable(),
  items: z.array(z.strictObject({ productName: z.string(), variantAttributes: z.record(z.string(), z.string()), sku: z.string().nullable(),
    quantity: z.number().int().positive().safe(), unitPrice: checkoutMoneySchema, subtotal: checkoutMoneySchema })).min(1),
  itemsTotal: checkoutMoneySchema, deliveryCharge: checkoutMoneySchema, total: checkoutMoneySchema,
  delivery: publicCheckoutDeliverySchema.nullable(),
  state: z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("pending") }),
    z.strictObject({ kind: z.literal("confirmed"), confirmedAt: z.iso.datetime() }), z.strictObject({ kind: z.literal("cancelled") })]),
}).refine((value) => value.state.kind !== "confirmed" || checkoutBuyerSchema.safeParse(value.buyer).success,
  { message: "Confirmed checkout requires complete buyer data", path: ["buyer"] });
export type PublicCheckoutResponse = z.infer<typeof publicCheckoutSchema>;
