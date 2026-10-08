import { isPersistenceFailure } from "@core/src/shared/infrastructure/persistence-error";
import { randomUUID } from "node:crypto";
import { err } from "@shared/functional";
import type { AppError, Result } from "@shared/result";
import { afterTransactionCommit, getCompanyId, withinTransaction } from "@core/src/shared/infrastructure/persistance";
import { log } from "@core/src/shared/infrastructure/logger";
import { getDeliverySettings, saveDeliverySettings, type DeliverySettingsAccess, type SaveDeliverySettingsInput } from "@core/src/features/delivery-settings/application/delivery-settings";
import { readDeliverySettings, writeDeliverySettings } from "@core/src/features/delivery-settings/infrastructure/delivery-settings-repository";
import type { CourierId, DeliverySettingsReadError } from "@core/src/features/delivery-settings/domain/delivery-settings";
import { getDeliveryZones, saveDeliveryZones, type SaveDeliveryZonesInput } from "@core/src/features/delivery-settings/application/delivery-zones";
import { readDeliveryConfiguration, writeDeliveryZones } from "@core/src/features/delivery-settings/infrastructure/delivery-zones-repository";
import { createQuotation, type CreateQuotationInput, type QuotationStorageError } from "@core/src/features/delivery-settings/application/create-quotation";
import { findRateWithQuotation, insertQuotationWithRates } from "@core/src/features/delivery-settings/infrastructure/quotation-repository";

import { resolveSelectedDeliveryRate } from "@core/src/features/delivery-settings/application/resolve-selected-delivery-rate";
import type { ResolveSelectedRateInput } from "@core/src/features/delivery-settings/domain/selected-delivery-rate";

async function quotationTransaction<T, E extends AppError>(companyId: string, work: () => Promise<Result<T, E>>): Promise<Result<T, E | QuotationStorageError>> {
  if (getCompanyId() !== companyId) throw new Error("Quotation company differs from tenant context");
  try { return await withinTransaction(work); }
  catch (cause) {
    if (!isPersistenceFailure(cause)) throw cause;
    log.error({ event: "quotation_transaction_failed", companyId, err: cause }, "Unable to complete quotation transaction");
    return err({ code: "SERVICE_UNAVAILABLE", message: "Unable to complete quotation transaction" });
  }
}

async function settingsTransaction<T, E extends AppError>(context: DeliverySettingsAccess, operation: string, expectedVersion: number | undefined,
  work: () => Promise<Result<T, E>>): Promise<Result<T, E | DeliverySettingsReadError>> {
  if (getCompanyId() !== context.companyId) throw new Error("Settings company differs from tenant context");
  try { return await withinTransaction(work); }
  catch (cause) {
    if (!isPersistenceFailure(cause)) throw cause;
    log.error({ event: "delivery_settings_transaction_failed", operation, companyId: context.companyId, userId: context.userId,
      expectedVersion, transactionOutcome: "unknown", errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "Unable to complete delivery settings transaction");
    return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to complete delivery settings transaction" });
  }
}

export const deliverySettings = {
  getForCompany: (companyId: string) => quotationTransaction(companyId,
    () => getDeliverySettings({ companyId }, id => readDeliverySettings(id, "shared", undefined, "confirm_checkout"))),
  createQuotation: (input: CreateQuotationInput) => createQuotation(input, {
    generateId: randomUUID, now: () => new Date(), insertQuotationWithRates,
    readConfigurationForShare: companyId => readDeliveryConfiguration(companyId, "shared"),
    transaction: quotationTransaction,
  }),
  resolveSelectedDeliveryRate: (input: ResolveSelectedRateInput) => quotationTransaction(input.companyId,
    () => resolveSelectedDeliveryRate(input, { findRateWithQuotation,
      readConfigurationForShare: companyId => readDeliveryConfiguration(companyId, "shared") })),
  getZones: (context: DeliverySettingsAccess) => settingsTransaction(context, "get_delivery_zones", undefined,
    () => getDeliveryZones(context, companyId => readDeliveryConfiguration(companyId, "shared"))),
  saveZones: (input: SaveDeliveryZonesInput, context: DeliverySettingsAccess) => saveDeliveryZones(input, context, {
    transaction: (_companyId, work) => settingsTransaction(context, "save_delivery_zones", input.expectedVersion, work),
    readForUpdate: companyId => readDeliveryConfiguration(companyId, "exclusive"),
    saveSettings: writeDeliverySettings, saveZones: writeDeliveryZones, generateZoneId: randomUUID,
  }),
  get: (context: DeliverySettingsAccess, operation = "get_delivery_settings") => settingsTransaction(context, operation, undefined,
    () => getDeliverySettings(context, (companyId) => readDeliverySettings(companyId, "shared", undefined, operation))),
  async save(input: SaveDeliverySettingsInput, context: DeliverySettingsAccess) {
    const started = performance.now();
    const result = await saveDeliverySettings(input, context, {
      transaction: (_companyId, work) => settingsTransaction(context, "save_delivery_settings", input.expectedVersion, work),
      findForUpdate: (companyId) => readDeliverySettings(companyId, "exclusive", input.expectedVersion),
      save: writeDeliverySettings,
      generateCourierId: () => randomUUID() as CourierId,
    });
    const durationMs = Math.round(performance.now() - started);
    if (result.success) afterTransactionCommit(() => log.info({ event: "delivery_settings_saved", operation: "save_delivery_settings", companyId: context.companyId,
      userId: context.userId, expectedVersion: input.expectedVersion, savedVersion: result.data.version,
      agencyEnabled: result.data.agency.enabled, couriersCount: result.data.couriers.length, enabledCouriersCount: result.data.couriers.filter(courier => courier.enabled).length,
      homeEnabled: result.data.home.enabled, storeEnabled: result.data.store.enabled, pickupConfigured: result.data.store.pickupPoint !== null,
      transactionOutcome: "committed", durationMs }, "Delivery settings saved"));
    else if (result.error.code === "DELIVERY_SETTINGS_CONFLICT") log.debug({ event: "delivery_settings_conflict", operation: "save_delivery_settings", companyId: context.companyId,
      userId: context.userId, expectedVersion: input.expectedVersion, currentVersion: result.error.currentVersion,
      reason: result.error.reason, errorCode: result.error.code }, "Delivery settings conflict");
    return result;
  },
};
