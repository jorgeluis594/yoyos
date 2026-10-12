import { z } from "zod";
import { err, ok } from "@shared/functional";
import { parsePeruDistrictCode, type PeruDistrictCode } from "@shared/peru-geography";
import type { Result } from "@shared/result";
import type { CourierCatalogId, DeliverySettingsReadError } from "@core/src/features/delivery-settings/domain/delivery-settings";

export type DeliveryAgencyId = string & { readonly __brand: "DeliveryAgencyId" };
// System catalog row, maintained by SQL (D5): the app only reads it.
export type DeliveryAgency = Readonly<{
  id: DeliveryAgencyId; courierId: CourierCatalogId; name: string; address: string; districtCode: PeruDistrictCode;
  enabled: boolean; courierEnabled: boolean;
}>;

const districtCode = z.string().transform((value, context) => {
  const parsed = parsePeruDistrictCode(value);
  if (parsed.success) return parsed.data;
  context.addIssue({ code: "custom", message: parsed.error.message });
  return z.NEVER;
});
const agencySchema = z.strictObject({
  id: z.uuid().transform(value => value as DeliveryAgencyId), courierId: z.uuid().transform(value => value as CourierCatalogId),
  name: z.string().trim().min(1).max(120), address: z.string().trim().min(1).max(500), districtCode,
  enabled: z.boolean(), courierEnabled: z.boolean(),
});

export function parseDeliveryAgency(value: unknown): Result<DeliveryAgency, DeliverySettingsReadError> {
  const parsed = agencySchema.safeParse(value);
  return parsed.success ? ok(parsed.data) : err({ code: "INVALID_STORED_DATA", message: "Stored delivery agency is invalid" });
}
