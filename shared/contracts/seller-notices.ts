import { z } from "zod";

/** The `data` of a seller notice push. It never carries an order id: the order is resolved on tap. */
export const sellerNoticeDataSchema = z.strictObject({
  v: z.literal(1),
  companyId: z.uuid(),
  messageId: z.uuid(),
  target: z.enum(["message", "order"]),
});
export type SellerNoticeData = z.infer<typeof sellerNoticeDataSchema>;

export const sellerNoticeTargetResponseSchema = z.strictObject({
  version: z.literal(1),
  target: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("message") }),
    z.strictObject({ kind: z.literal("order"), orderId: z.uuid() }),
  ]),
});
export type SellerNoticeTargetResponse = z.infer<typeof sellerNoticeTargetResponseSchema>;
