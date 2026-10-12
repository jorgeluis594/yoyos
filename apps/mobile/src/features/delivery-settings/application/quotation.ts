import type { QuotedAgencyContract } from "@shared/contracts/quotations";
import type { Money } from "@shared/money";
import type { Result } from "@shared/result";
import type { TransportError } from "@mobile/shared/application/transport-error";

type RateFields = Readonly<{ id: string; name: string; zoneName: string; price: Money }>;
export type QuotedAgency = QuotedAgencyContract;
export type QuotedRate = (RateFields & Readonly<{ method: "home" }>) | (RateFields & Readonly<{ method: "agency"; agencies: readonly QuotedAgency[] }>);
export type DeliveryQuotation = Readonly<{ id: string; districtCode: string; rates: readonly QuotedRate[] }>;
export type QuotationError = Readonly<{
  code: TransportError["code"] | "INVALID_INPUT" | "INVALID_DESTINATION" | "INVALID_DISTRICT"
    | "UNSUPPORTED_COUNTRY" | "INVALID_DELIVERY_SETTINGS" | "INVALID_DELIVERY_RATE" | "PAYLOAD_TOO_LARGE";
  message: string;
  field?: "destination" | "address" | "instructions";
  districtCode?: string;
}>;
export type CreateDeliveryQuotation = (districtCode: string) => Promise<Result<DeliveryQuotation, QuotationError>>;
