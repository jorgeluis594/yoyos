import { err, ok } from "@shared/functional";
import type { CompanyId } from "@shared/identity";
import type { Currency } from "@shared/money";
import type { Result } from "@shared/result";
import type { DeliverySettings } from "@core/src/features/delivery-settings/domain/delivery-settings";
import type { DeliveryZone } from "@core/src/features/delivery-settings/domain/delivery-zone";
import { applicableDeliveryZones, buildQuotationWithRates, parseQuotationCompanyId, parseQuotationDestination,
  type QuotationError, type QuotationWithRates } from "@core/src/features/delivery-settings/domain/quotation";

export type CreateQuotationInput = Readonly<{
  companyId: string; country: string; districtCode: string; address: string | null; instructions: string | null;
}>;
export type QuotationStorageError = Readonly<{ code: "SERVICE_UNAVAILABLE" | "INTERNAL_ERROR"; message: string }>;
export type CreateQuotationError = QuotationError | QuotationStorageError;
export type DeliveryConfiguration = Readonly<{
  country: string; currency: Currency; settings: DeliverySettings; zones: readonly DeliveryZone[];
}>;
export type CreateQuotationDependencies = Readonly<{
  transaction: <T>(companyId: CompanyId, work: () => Promise<Result<T, CreateQuotationError>>) => Promise<Result<T, CreateQuotationError>>;
  readConfigurationForShare: (companyId: CompanyId) => Promise<Result<DeliveryConfiguration, QuotationStorageError>>;
  insertQuotationWithRates: (value: QuotationWithRates) => Promise<Result<null, QuotationStorageError>>;
  generateId: () => string;
  now: () => Date;
}>;

export async function createQuotation(input: CreateQuotationInput, deps: CreateQuotationDependencies): Promise<Result<QuotationWithRates, CreateQuotationError>> {
  const company = parseQuotationCompanyId(input.companyId);
  if (!company.success) return company;
  const destination = parseQuotationDestination({ country: input.country, districtCode: input.districtCode, address: input.address, instructions: input.instructions });
  if (!destination.success) return destination;
  return deps.transaction(company.data, async () => {
    const loaded = await deps.readConfigurationForShare(company.data);
    if (!loaded.success) return loaded;
    const configuration = loaded.data;
    if (configuration.country !== "PE") return err({ code: "UNSUPPORTED_COUNTRY", message: "Delivery zones are available only for Peru businesses" });
    if (configuration.currency !== "PEN") return err({ code: "INVALID_DELIVERY_SETTINGS", message: "Peru delivery settings must use PEN" });
    const applicable = applicableDeliveryZones(configuration.settings, configuration.zones, destination.data.districtCode);
    const quotation = buildQuotationWithRates({ id: deps.generateId(), companyId: company.data, createdAt: deps.now(), destination: destination.data,
      settings: configuration.settings, zones: configuration.zones, rateIds: applicable.map(() => deps.generateId()) }, configuration.currency);
    if (!quotation.success) return quotation;
    const inserted = await deps.insertQuotationWithRates(quotation.data);
    return inserted.success ? ok(quotation.data) : inserted;
  });
}
