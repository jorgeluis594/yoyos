import { err, ok } from "@shared/functional";
import type { Currency } from "@shared/money";
import type { Result } from "@shared/result";
import { initialDeliverySettings, parseDeliverySettings, type DeliverySettings, type DeliverySettingsError } from "@core/src/features/delivery-settings/domain/delivery-settings";
import { prepareDeliveryZones, type DeliveryZone, type DeliveryZoneInput, type DeliveryZoneError, type ZonedDeliveryMethod } from "@core/src/features/delivery-settings/domain/delivery-zone";
import type { DeliverySettingsAccess } from "@core/src/features/delivery-settings/application/delivery-settings";
import type { DeliveryConfiguration, QuotationStorageError } from "@core/src/features/delivery-settings/application/create-quotation";

export type DeliveryZonesState = Readonly<{
  home: DeliverySettings["home"]; agency: DeliverySettings["agency"]; version: number; currency: Currency; zones: readonly DeliveryZone[];
}>;
export type DeliveryZonesError = DeliveryZoneError | DeliverySettingsError | QuotationStorageError
  | Readonly<{ code: "UNSUPPORTED_COUNTRY"; message: string }>;
export type SaveDeliveryZonesInput = Readonly<{ method: ZonedDeliveryMethod; expectedVersion: number; zones: readonly DeliveryZoneInput[] }>;
export type ReadDeliveryConfiguration = (companyId: string) => Promise<Result<DeliveryConfiguration, QuotationStorageError>>;
export type SaveDeliveryZonesDependencies = Readonly<{
  transaction: <T>(companyId: string, work: () => Promise<Result<T, DeliveryZonesError>>) => Promise<Result<T, DeliveryZonesError>>;
  readForUpdate: ReadDeliveryConfiguration;
  saveSettings: (companyId: string, settings: DeliverySettings) => Promise<Result<null, DeliverySettingsError>>;
  saveZones: (companyId: string, method: ZonedDeliveryMethod, zones: readonly DeliveryZone[]) => Promise<Result<null, QuotationStorageError>>;
  generateZoneId: () => string;
}>;

function zonesState(configuration: DeliveryConfiguration): DeliveryZonesState {
  return { home: configuration.settings.home, agency: configuration.settings.agency, version: configuration.settings.version,
    currency: configuration.currency, zones: configuration.zones };
}

export async function getDeliveryZones(context: DeliverySettingsAccess, read: ReadDeliveryConfiguration): Promise<Result<DeliveryZonesState, DeliveryZonesError>> {
  const loaded = await read(context.companyId);
  if (!loaded.success) return loaded;
  if (loaded.data.country !== "PE") return err({ code: "UNSUPPORTED_COUNTRY", message: "Delivery zones are available only for Peru businesses" });
  if (loaded.data.currency !== "PEN") return err({ code: "INVALID_DELIVERY_SETTINGS", message: "Peru delivery settings must use PEN" });
  return ok(zonesState(loaded.data));
}

export async function saveDeliveryZones(input: SaveDeliveryZonesInput, context: DeliverySettingsAccess, deps: SaveDeliveryZonesDependencies): Promise<Result<DeliveryZonesState, DeliveryZonesError>> {
  const version = parseDeliverySettings({ ...initialDeliverySettings(), version: input.expectedVersion });
  if (!version.success) return version;
  if (input.expectedVersion === 2147483647) return err({ code: "INVALID_DELIVERY_SETTINGS", message: "Settings version is exhausted" });
  return deps.transaction(context.companyId, async () => {
    const loaded = await deps.readForUpdate(context.companyId);
    if (!loaded.success) return loaded;
    const configuration = loaded.data;
    if (configuration.country !== "PE") return err({ code: "UNSUPPORTED_COUNTRY", message: "Delivery zones are available only for Peru businesses" });
    if (configuration.currency !== "PEN") return err({ code: "INVALID_DELIVERY_SETTINGS", message: "Peru delivery settings must use PEN" });
    if (configuration.settings.version !== input.expectedVersion)
      return err({ code: "DELIVERY_SETTINGS_CONFLICT", reason: "stale_version", currentVersion: configuration.settings.version, message: "Settings changed since they were loaded" });
    const zones = prepareDeliveryZones({ method: input.method, zones: input.zones }, configuration.zones, configuration.currency, deps.generateZoneId);
    if (!zones.success) return zones;
    const settings: DeliverySettings = { ...configuration.settings, version: input.expectedVersion + 1 };
    const savedSettings = await deps.saveSettings(context.companyId, settings);
    if (!savedSettings.success) return savedSettings;
    const savedZones = await deps.saveZones(context.companyId, input.method, zones.data.filter(zone => zone.method === input.method));
    return savedZones.success ? ok(zonesState({ ...configuration, settings, zones: zones.data })) : savedZones;
  });
}
