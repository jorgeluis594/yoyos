import { z } from "zod";
import { moneySchema } from "@shared/contracts/money";

export const createQuotationRequestSchema = z.strictObject({
  orderId: z.uuid().optional(),
  destination: z.strictObject({
    country: z.string(), districtCode: z.string(),
    address: z.string().nullable().optional(), instructions: z.string().nullable().optional(),
  }),
});
export const quotationDestinationSchema = z.strictObject({
  country: z.literal("PE"), districtCode: z.string().regex(/^\d{6}$/),
  address: z.string().min(1).max(500).nullable(), instructions: z.string().min(1).max(1000).nullable(),
});
const rateFields = { id: z.uuid(), price: moneySchema.extend({ amount: z.number().finite().min(0).max(9999999999999.99).multipleOf(0.01) }) };
export const deliveryRateSchema = z.discriminatedUnion("method", [
  z.strictObject({ ...rateFields, method: z.literal("home"), label: z.literal("Entrega a domicilio") }),
  z.strictObject({ ...rateFields, method: z.literal("agency"), label: z.literal("Retiro en agencia") }),
]);
export const quotationResponseSchema = z.strictObject({
  id: z.uuid(), destination: quotationDestinationSchema, createdAt: z.iso.datetime(), rates: z.array(deliveryRateSchema),
});
export const quotationApiErrorSchema = z.strictObject({
  code: z.enum(["INVALID_INPUT", "INVALID_DELIVERY_SETTINGS", "INVALID_DELIVERY_RATE", "INVALID_DESTINATION", "INVALID_DISTRICT",
    "UNSUPPORTED_COUNTRY", "CHECKOUT_UNAVAILABLE", "ORDER_CANCELLED", "SERVICE_UNAVAILABLE", "INTERNAL_ERROR"]),
  error: z.string(), field: z.enum(["destination", "address", "instructions"]).optional(), districtCode: z.string().optional(),
});
export type CreateQuotationRequest = z.infer<typeof createQuotationRequestSchema>;
export type QuotationDestinationContract = z.infer<typeof quotationDestinationSchema>;
export type DeliveryRateContract = z.infer<typeof deliveryRateSchema>;
export type QuotationResponse = z.infer<typeof quotationResponseSchema>;
