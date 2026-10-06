import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { initialDeliverySettings, parseDeliverySettings, parseCourierInputs, prepareCouriers, type CourierId, type CourierInput, type DeliverySettings, type DeliverySettingsError, type DeliverySettingsReadError } from "@core/src/features/delivery-settings/domain/delivery-settings";

export type DeliverySettingsAccess = Readonly<{ companyId: string; userId: string }>;
export type SaveDeliverySettingsInput = Readonly<{ expectedVersion: number; home: DeliverySettings["home"]; agency: DeliverySettings["agency"]; couriers: readonly CourierInput[]; store: DeliverySettings["store"] }>;
export type ReadDeliverySettings = (companyId: string) => Promise<Result<DeliverySettings | null, DeliverySettingsReadError>>;
export type SaveDeliverySettingsDependencies = Readonly<{
  generateCourierId: () => CourierId;
  transaction: <T>(companyId: string, work: () => Promise<Result<T, DeliverySettingsError>>) => Promise<Result<T, DeliverySettingsError>>;
  findForUpdate: ReadDeliverySettings;
  save: (companyId: string, settings: DeliverySettings) => Promise<Result<null, DeliverySettingsError>>;
}>;

export async function getDeliverySettings(context: DeliverySettingsAccess, read: ReadDeliverySettings): Promise<Result<DeliverySettings, DeliverySettingsReadError>> {
  const found = await read(context.companyId);
  return found.success ? ok(found.data ?? initialDeliverySettings()) : found;
}

export async function saveDeliverySettings(input: SaveDeliverySettingsInput, context: DeliverySettingsAccess, deps: SaveDeliverySettingsDependencies): Promise<Result<DeliverySettings, DeliverySettingsError>> {
  const courierInputs = parseCourierInputs(input.couriers);
  if (!courierInputs.success) return courierInputs;
  const validated = parseDeliverySettings({ version: input.expectedVersion, home: input.home, store: input.store, agency: { enabled: false }, couriers: [] });
  if (typeof input.agency?.enabled !== "boolean") return err({ code: "INVALID_DELIVERY_SETTINGS", message: "Invalid agency settings" });
  if (!validated.success) return validated;
  if (input.expectedVersion === 2147483647) return err({ code: "INVALID_DELIVERY_SETTINGS", message: "Settings version is exhausted" });
  return deps.transaction(context.companyId, async () => {
    const found = await deps.findForUpdate(context.companyId);
    if (!found.success) return found;
    const currentVersion = found.data?.version ?? 0;
    if (currentVersion !== input.expectedVersion) return err({ code: "DELIVERY_SETTINGS_CONFLICT", message: "Settings changed since they were loaded", currentVersion, reason: "stale_version" });
    const couriers = prepareCouriers({ agencyEnabled: input.agency.enabled, couriers: courierInputs.data }, found.data?.couriers ?? [], deps.generateCourierId);
    if (!couriers.success) return couriers;
    const next: DeliverySettings = { ...validated.data, agency: input.agency, couriers: couriers.data, version: currentVersion + 1 };
    const complete = parseDeliverySettings(next);
    if (!complete.success) return complete;
    const saved = await deps.save(context.companyId, complete.data);
    return saved.success ? ok(complete.data) : saved;
  });
}
