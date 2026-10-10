import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { parsePeruDistrictCode } from "@shared/peru-geography";
import { createQuotationRequestSchema, quotationApiErrorSchema, quotationResponseSchema, type QuotationResponse } from "@shared/contracts/quotations";

export type QuotationRequestError = Readonly<{
  code: "INVALID_INPUT" | "INVALID_DISTRICT" | "INVALID_DESTINATION" | "UNSUPPORTED_COUNTRY" | "INVALID_DELIVERY_SETTINGS" | "INVALID_DELIVERY_RATE"
    | "CHECKOUT_UNAVAILABLE" | "ORDER_CANCELLED" | "SERVICE_UNAVAILABLE" | "INTERNAL_ERROR" | "REQUEST_FAILED" | "INVALID_RESPONSE" | "CANCELLED";
  message: string;
}>;
const errorStatuses = { INVALID_INPUT: 400, INVALID_DISTRICT: 422, INVALID_DESTINATION: 422, UNSUPPORTED_COUNTRY: 422,
  INVALID_DELIVERY_SETTINGS: 422, INVALID_DELIVERY_RATE: 422, CHECKOUT_UNAVAILABLE: 404, ORDER_CANCELLED: 422,
  SERVICE_UNAVAILABLE: 503, INTERNAL_ERROR: 500 } as const;

export async function requestDeliveryQuotation(input: Readonly<{ districtCode: string; orderId?: string }>, signal?: AbortSignal,
  fetcher: typeof fetch = fetch): Promise<Result<QuotationResponse, QuotationRequestError>> {
  const district = parsePeruDistrictCode(input.districtCode);
  if (!district.success) return district;
  const request = createQuotationRequestSchema.safeParse({ ...(input.orderId === undefined ? {} : { orderId: input.orderId }),
    destination: { country: "PE", districtCode: district.data } });
  if (!request.success) return err({ code: "INVALID_INPUT", message: "Invalid quotation request" });
  const cancelled = () => err<QuotationRequestError>({ code: "CANCELLED", message: "Quotation request cancelled" });
  if (signal?.aborted) return cancelled();
  try {
    const response = await fetcher("/api/quotations", { method: "POST", headers: { "content-type": "application/json" },
      credentials: "same-origin", cache: "no-store", body: JSON.stringify(request.data), signal });
    if (signal?.aborted) return cancelled();
    let body: unknown;
    try { body = await response.json(); }
    catch { return signal?.aborted ? cancelled() : err({ code: "INVALID_RESPONSE", message: "Invalid quotation response" }); }
    if (signal?.aborted) return cancelled();
    if (response.status !== 201) {
      const failure = quotationApiErrorSchema.safeParse(body);
      return failure.success && errorStatuses[failure.data.code] === response.status
        ? err({ code: failure.data.code, message: "Unable to load delivery options" })
        : err({ code: "INVALID_RESPONSE", message: "Invalid quotation response" });
    }
    const parsed = quotationResponseSchema.safeParse(body);
    if (!parsed.success || parsed.data.destination.districtCode !== district.data ||
      parsed.data.rates.some(rate => rate.price.currency !== "PEN") || new Set(parsed.data.rates.map(rate => rate.id)).size !== parsed.data.rates.length)
      return err({ code: "INVALID_RESPONSE", message: "Invalid quotation response" });
    return ok(parsed.data);
  } catch {
    return signal?.aborted ? cancelled() : err({ code: "REQUEST_FAILED", message: "Unable to load delivery options" });
  }
}
