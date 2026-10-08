import { createQuotationRequestSchema, quotationApiErrorSchema, quotationResponseSchema } from "@shared/contracts/quotations";
import { z } from "zod";
import { err, ok } from "@shared/functional";
import { getPeruDistrict } from "@shared/peru-geography";
import type { Result } from "@shared/result";
import type { TransportError } from "@mobile/shared/application/transport-error";
import type { CreateDeliveryQuotation, QuotationError } from "@mobile/features/delivery-settings/application/quotation";

type Request = (path: string, init?: RequestInit) => Promise<Result<unknown, TransportError>>;
const statusByCode = { INVALID_INPUT: 400, UNSUPPORTED_MEDIA_TYPE: 415, PAYLOAD_TOO_LARGE: 413, INVALID_DESTINATION: 422, INVALID_DISTRICT: 422,
  UNSUPPORTED_COUNTRY: 422, INVALID_DELIVERY_SETTINGS: 422, INVALID_DELIVERY_RATE: 422,
  SERVICE_UNAVAILABLE: 503, INTERNAL_ERROR: 500, CHECKOUT_UNAVAILABLE: 404, ORDER_CANCELLED: 422 };
const errorSchema = quotationApiErrorSchema.or(z.strictObject({ code: z.enum(["UNSUPPORTED_MEDIA_TYPE", "PAYLOAD_TOO_LARGE"]), error: z.string() }));

export function createQuotationApi(request: Request): CreateDeliveryQuotation {
  return async districtCode => {
    const input = createQuotationRequestSchema.safeParse({ destination: { country: "PE", districtCode } });
    if (!input.success || !getPeruDistrict(districtCode)) return err({ code: "INVALID_INPUT", message: "Select a valid district" });
    const result = await request("/api/quotations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input.data) });
    if (result.success) {
      const parsed = quotationResponseSchema.safeParse(result.data);
      if (!parsed.success || parsed.data.destination.districtCode !== districtCode ||
        new Set(parsed.data.rates.map(rate => rate.id)).size !== parsed.data.rates.length ||
        parsed.data.rates.some(rate => rate.price.currency !== "PEN"))
        return err({ code: "INVALID_RESPONSE", message: "Invalid delivery quotation response" });
      return ok({ id: parsed.data.id, districtCode: parsed.data.destination.districtCode,
        rates: parsed.data.rates.map(({ id, method, price }) => ({ id, method, price })) });
    }
    const error = result.error;
    if (!error.http || ["UNAUTHENTICATED", "COMPANY_REQUIRED", "RATE_LIMITED"].includes(error.code))
      return err({ code: error.code, message: error.message });
    const parsed = errorSchema.safeParse(error.http.body);
    // Seller quotations never use the public checkout access branch.
    if (!parsed.success || statusByCode[parsed.data.code] !== error.http.status ||
      parsed.data.code === "CHECKOUT_UNAVAILABLE" || parsed.data.code === "ORDER_CANCELLED")
      return err({ code: "INVALID_RESPONSE", message: "Unexpected quotation error" });
    const { code, error: message, ...details } = parsed.data;
    return err<QuotationError>({ code: code === "INTERNAL_ERROR" ? "SERVER_ERROR" : code, message, ...details });
  };
}
