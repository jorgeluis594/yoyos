import { z } from "zod";
import type { DispatchLabelExclusion, DispatchLabelSize as SharedDispatchLabelSize } from "@shared/dispatch-label/types";

export const dispatchLabelMaxOrders = 100;
export const dispatchLabelSizes = ["label_62x100", "a4"] as const satisfies readonly SharedDispatchLabelSize[];

const missingFieldSchema = z.enum([
  "recipientName", "recipientPhone", "recipientDocument", "department", "province", "district", "address", "courier", "agency",
]);

export const dispatchLabelExclusionSchema = z.discriminatedUnion("code", [
  z.strictObject({ code: z.literal("METHOD_NOT_APPLICABLE") }),
  z.strictObject({ code: z.literal("DELIVERY_NOT_ASSIGNED") }),
  z.strictObject({ code: z.literal("CANCELLED") }),
  z.strictObject({ code: z.literal("MISSING_DATA"), fields: z.tuple([missingFieldSchema], missingFieldSchema) }),
  z.strictObject({ code: z.literal("LABEL_CONTENT_OVERFLOW") }),
]) satisfies z.ZodType<DispatchLabelExclusion>;

export const dispatchLabelSizeSchema = z.enum(dispatchLabelSizes);

export const createDispatchLabelsRequestSchema = z.strictObject({
  orderIds: z.array(z.uuid()).min(1).max(dispatchLabelMaxOrders)
    .refine((ids) => new Set(ids).size === ids.length, "Duplicate order ids"),
  size: dispatchLabelSizeSchema.default("label_62x100"),
});

const orderRefSchema = z.strictObject({ orderId: z.uuid(), orderNumber: z.number().int().positive().safe() });

/** One request gives the PDF and the exclusions together; `pdf` is base64 and null when no order is ready. */
export const createDispatchLabelsResponseSchema = z.strictObject({
  pdf: z.string().min(1).nullable(),
  size: dispatchLabelSizeSchema,
  printed: z.array(orderRefSchema),
  excluded: z.array(orderRefSchema.extend({ exclusion: dispatchLabelExclusionSchema })),
  notFound: z.array(z.uuid()),
});

export type DispatchLabelSize = z.infer<typeof dispatchLabelSizeSchema>;
export type CreateDispatchLabelsRequest = z.input<typeof createDispatchLabelsRequestSchema>;
export type CreateDispatchLabelsResponse = z.infer<typeof createDispatchLabelsResponseSchema>;
