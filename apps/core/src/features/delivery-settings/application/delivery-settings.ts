import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { initialDeliverySettings, parseDeliverySettings, type DeliverySettings, type DeliverySettingsError, type DeliverySettingsReadError } from "@core/src/features/delivery-settings/domain/delivery-settings";

export type DeliverySettingsAccess = Readonly<{ companyId: string; userId: string }>;
export type SaveDeliverySettingsInput = Readonly<{ expectedVersion: number; store: DeliverySettings["store"] }>;
export type ReadDeliverySettings = (companyId: string) => Promise<Result<DeliverySettings | null, DeliverySettingsReadError>>;
export type SaveDeliverySettingsDependencies = Readonly<{
  transaction: <T>(companyId: string, work: () => Promise<Result<T, DeliverySettingsError>>) => Promise<Result<T, DeliverySettingsError>>;
  findForUpdate: ReadDeliverySettings;
  save: (companyId: string, settings: DeliverySettings) => Promise<Result<null, DeliverySettingsError>>;
}>;

export async function getDeliverySettings(context: DeliverySettingsAccess, read: ReadDeliverySettings): Promise<Result<DeliverySettings, DeliverySettingsReadError>> {
  const found = await read(context.companyId);
  return found.success ? ok(found.data ?? initialDeliverySettings()) : found;
}

export async function saveDeliverySettings(input: SaveDeliverySettingsInput, context: DeliverySettingsAccess, deps: SaveDeliverySettingsDependencies): Promise<Result<DeliverySettings, DeliverySettingsError>> {
  const validated = parseDeliverySettings({ version: input.expectedVersion, store: input.store });
  if (!validated.success) return validated;
  if (input.expectedVersion === 2147483647) return err({ code: "INVALID_DELIVERY_SETTINGS", message: "Settings version is exhausted" });
  return deps.transaction(context.companyId, async () => {
    const found = await deps.findForUpdate(context.companyId);
    if (!found.success) return found;
    const currentVersion = found.data?.version ?? 0;
    if (currentVersion !== input.expectedVersion) return err({ code: "DELIVERY_SETTINGS_CONFLICT", message: "Settings changed since they were loaded", currentVersion, reason: "stale_version" });
    const next: DeliverySettings = { ...validated.data, version: currentVersion + 1 };
    const saved = await deps.save(context.companyId, next);
    return saved.success ? ok(next) : saved;
  });
}
