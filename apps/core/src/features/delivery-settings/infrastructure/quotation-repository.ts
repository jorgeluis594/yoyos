import { err, ok } from "@shared/functional";
import { isCurrency } from "@shared/money";
import type { Result } from "@shared/result";
import { parseRateWithQuotation, type DeliveryRateId, type QuotationWithRates, type RateWithQuotation } from "@core/src/features/delivery-settings/domain/quotation";
import type { QuotationStorageError } from "@core/src/features/delivery-settings/application/create-quotation";
import { prisma, requireActiveTransaction } from "@core/src/shared/infrastructure/persistance";
import { isPersistenceFailure } from "@core/src/shared/infrastructure/persistence-error";
import { log } from "@core/src/shared/infrastructure/logger";

export async function insertQuotationWithRates(value: QuotationWithRates): Promise<Result<null, QuotationStorageError>> {
  requireActiveTransaction(value.quotation.companyId);
  try {
    const quotation = value.quotation;
    await prisma.quotation.create({ data: { id: quotation.id, companyId: quotation.companyId, destination: { ...quotation.destination }, createdAt: quotation.createdAt } });
    await prisma.deliveryRate.createMany({ data: value.rates.map(rate => ({ id: rate.id, companyId: rate.companyId, quotationId: rate.quotationId,
      method: rate.method, zoneId: rate.zoneId, districtCode: rate.districtCode, priceAmount: rate.price.amount, priceCurrency: rate.price.currency,
      settingsVersion: rate.settingsVersion, createdAt: rate.createdAt })) });
    return ok(null);
  } catch (cause) {
    if (!isPersistenceFailure(cause)) throw cause;
    log.error({ event: "quotation_write_failed", companyId: value.quotation.companyId, err: cause }, "Unable to persist quotation");
    return err({ code: "SERVICE_UNAVAILABLE", message: "Unable to persist quotation" });
  }
}

export async function findRateWithQuotation(companyId: string, rateId: DeliveryRateId): Promise<Result<RateWithQuotation | null, QuotationStorageError>> {
  requireActiveTransaction(companyId);
  try {
    const row = await prisma.deliveryRate.findFirst({ where: { companyId, id: rateId }, include: { quotation: true } });
    if (!row) return ok(null);
    if (!isCurrency(row.priceCurrency)) return err({ code: "INTERNAL_ERROR", message: "Invalid stored delivery rate currency" });
    const parsed = parseRateWithQuotation({ quotation: { id: row.quotation.id, companyId: row.quotation.companyId,
      destination: row.quotation.destination, createdAt: row.quotation.createdAt }, rate: { id: row.id, companyId: row.companyId, quotationId: row.quotationId,
      method: row.method, zoneId: row.zoneId, districtCode: row.districtCode, price: { amount: row.priceAmount.toNumber(), currency: row.priceCurrency },
      settingsVersion: row.settingsVersion, createdAt: row.createdAt } }, row.priceCurrency);
    if (!parsed.success) {
      log.error({ event: "quotation_stored_data_invalid", companyId, rateId }, "Invalid stored quotation or delivery rate");
      return err({ code: "INTERNAL_ERROR", message: "Invalid stored quotation or delivery rate" });
    }
    return parsed;
  } catch (cause) {
    if (!isPersistenceFailure(cause)) throw cause;
    log.error({ event: "quotation_read_failed", companyId, rateId, err: cause }, "Unable to read delivery rate");
    return err({ code: "SERVICE_UNAVAILABLE", message: "Unable to read delivery rate" });
  }
}
