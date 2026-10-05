import { err } from "@shared/functional";
import type { Result } from "@shared/result";
import { afterTransactionCommit, getCompanyId, withinTransaction } from "@core/src/shared/infrastructure/persistance";
import { log } from "@core/src/shared/infrastructure/logger";
import { getDeliverySettings, saveDeliverySettings, type DeliverySettingsAccess, type SaveDeliverySettingsInput } from "@core/src/features/delivery-settings/application/delivery-settings";
import { isSettingsPersistenceFailure, readDeliverySettings, writeDeliverySettings } from "@core/src/features/delivery-settings/infrastructure/delivery-settings-repository";
import type { DeliverySettingsError, DeliverySettingsReadError } from "@core/src/features/delivery-settings/domain/delivery-settings";

async function settingsTransaction<T, E extends DeliverySettingsError>(context: DeliverySettingsAccess, operation: string, expectedVersion: number | undefined,
  work: () => Promise<Result<T, E>>): Promise<Result<T, E | DeliverySettingsReadError>> {
  if (getCompanyId() !== context.companyId) throw new Error("Settings company differs from tenant context");
  try { return await withinTransaction(work); }
  catch (cause) {
    if (!isSettingsPersistenceFailure(cause)) throw cause;
    log.error({ event: "delivery_settings_transaction_failed", operation, companyId: context.companyId, userId: context.userId,
      expectedVersion, transactionOutcome: "unknown", errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "Unable to complete delivery settings transaction");
    return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to complete delivery settings transaction" });
  }
}

export const deliverySettings = {
  get: (context: DeliverySettingsAccess, operation = "get_delivery_settings") => settingsTransaction(context, operation, undefined,
    () => getDeliverySettings(context, (companyId) => readDeliverySettings(companyId, "shared", undefined, operation))),
  async save(input: SaveDeliverySettingsInput, context: DeliverySettingsAccess) {
    const started = performance.now();
    const result = await saveDeliverySettings(input, context, {
      transaction: (_companyId, work) => settingsTransaction(context, "save_delivery_settings", input.expectedVersion, work),
      findForUpdate: (companyId) => readDeliverySettings(companyId, "exclusive", input.expectedVersion),
      save: writeDeliverySettings,
    });
    const durationMs = Math.round(performance.now() - started);
    if (result.success) afterTransactionCommit(() => log.info({ event: "delivery_settings_saved", operation: "save_delivery_settings", companyId: context.companyId,
      userId: context.userId, expectedVersion: input.expectedVersion, savedVersion: result.data.version,
      storeEnabled: result.data.store.enabled, pickupConfigured: result.data.store.pickupPoint !== null,
      transactionOutcome: "committed", durationMs }, "Delivery settings saved"));
    else if (result.error.code === "DELIVERY_SETTINGS_CONFLICT") log.debug({ event: "delivery_settings_conflict", operation: "save_delivery_settings", companyId: context.companyId,
      userId: context.userId, expectedVersion: input.expectedVersion, currentVersion: result.error.currentVersion,
      reason: result.error.reason, errorCode: result.error.code }, "Delivery settings conflict");
    return result;
  },
};
