import type { Money } from "@shared/money";
import type { Result } from "@shared/result";
import type { TransportError } from "@mobile/shared/application/transport-error";

export type DeliveryQuotation = Readonly<{
  id: string;
  districtCode: string;
  rates: readonly Readonly<{ id: string; method: "home" | "agency"; price: Money }>[];
}>;
export type QuotationError = Readonly<{
  code: TransportError["code"] | "INVALID_INPUT" | "INVALID_DESTINATION" | "INVALID_DISTRICT"
    | "UNSUPPORTED_COUNTRY" | "INVALID_DELIVERY_SETTINGS" | "INVALID_DELIVERY_RATE" | "PAYLOAD_TOO_LARGE";
  message: string;
  field?: "destination" | "address" | "instructions";
  districtCode?: string;
}>;
export type CreateDeliveryQuotation = (districtCode: string) => Promise<Result<DeliveryQuotation, QuotationError>>;
