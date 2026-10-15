import { err, ok } from "@shared/functional";
import type { Currency } from "@shared/money";
import type { Result } from "@shared/result";
import { syncCouriers, initialDeliverySettings, parseDeliverySettings, type CourierCatalogEntry, type CourierId, type DeliverySettings, type DeliverySettingsError, type DeliverySettingsReadError } from "@core/src/features/delivery-settings/domain/delivery-settings";
import { prepareDeliveryZones, type DeliveryZone, type DeliveryZoneInput, type DeliveryZoneError } from "@core/src/features/delivery-settings/domain/delivery-zone";
import type { DeliverySettingsAccess } from "@core/src/features/delivery-settings/application/delivery-settings";
import type { QuotationStorageError } from "@core/src/features/delivery-settings/application/create-quotation";
import type { DeliveryConfiguration } from "@core/src/features/delivery-settings/domain/quotation";
import type { DeliveryAgency } from "@core/src/features/delivery-settings/domain/delivery-agency";

export type DeliveryZonesState = Readonly<{
  home: DeliverySettings["home"]; agency: DeliverySettings["agency"]; version: number; currency: Currency; zones: readonly DeliveryZone[];
  agencies: readonly DeliveryAgency[]; // catalog agencies referenced by the zones' options, enabled or not
}>;
export type DeliveryZonesError = DeliveryZoneError | DeliverySettingsError | QuotationStorageError
  | Readonly<{ code: "UNSUPPORTED_COUNTRY"; message: string }>;
export type SaveDeliveryZonesInput = Readonly<{ expectedVersion: number; zones: readonly DeliveryZoneInput[] }>;
export type ReadDeliveryConfiguration = (companyId: string) => Promise<Result<DeliveryConfiguration, QuotationStorageError>>;
export type SaveDeliveryZonesDependencies = Readonly<{
  transaction: <T>(companyId: string, work: () => Promise<Result<T, DeliveryZonesError>>) => Promise<Result<T, DeliveryZonesError>>;
  readForUpdate: ReadDeliveryConfiguration;
  saveSettings: (companyId: string, settings: DeliverySettings) => Promise<Result<null, DeliverySettingsError>>;
  readAgencies: (ids: readonly string[]) => Promise<Result<readonly DeliveryAgency[], QuotationStorageError>>;
  readCourierCatalog: () => Promise<Result<readonly CourierCatalogEntry[], DeliverySettingsReadError>>; // every catalog courier, enabled or not: quotation gates on catalog availability
  saveZones: (companyId: string, zones: readonly DeliveryZone[]) => Promise<Result<null, QuotationStorageError>>;
  generateZoneId: () => string;
  generateOptionId: () => string;
  generateCourierId: () => CourierId;
}>;

function zonesState(configuration: DeliveryConfiguration): DeliveryZonesState {
  return { home: configuration.settings.home, agency: configuration.settings.agency, version: configuration.settings.version,
    currency: configuration.currency, zones: configuration.zones, agencies: configuration.agencies };
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
    const requested = [...new Set(input.zones.flatMap(zone => zone.options.flatMap(option => option.method === "agency" ? option.agencyIds : [])))];
    const agencies = await deps.readAgencies(requested);
    if (!agencies.success) return agencies;
    const catalog = requested.length > 0 ? await deps.readCourierCatalog() : ok([]); // with no agencies there is no courier to add, only to disable
    if (!catalog.success) return catalog;
    // Choosing a courier's agencies is how a company ships with it: its company courier follows the agencies of the enabled options in the same write.
    const shipping = new Set(input.zones.flatMap(zone => zone.enabled
      ? zone.options.flatMap(option => option.method === "agency" && option.enabled ? option.agencyIds : []) : []));
    const couriers = syncCouriers(configuration.settings.couriers, agencies.data.map(agency => agency.courierId),
      agencies.data.filter(agency => shipping.has(agency.id)).map(agency => agency.courierId), catalog.data, deps.generateCourierId);
    const zones = prepareDeliveryZones(input.zones, { current: configuration.zones, agencies: agencies.data,
      currency: configuration.currency, generateZoneId: deps.generateZoneId, generateOptionId: deps.generateOptionId });
    if (!zones.success) return zones;
    const settings: DeliverySettings = { ...configuration.settings, couriers, version: input.expectedVersion + 1 };
    const savedSettings = await deps.saveSettings(context.companyId, settings);
    if (!savedSettings.success) return savedSettings;
    const savedZones = await deps.saveZones(context.companyId, zones.data);
    return savedZones.success ? ok(zonesState({ ...configuration, settings, zones: zones.data, agencies: agencies.data })) : savedZones;
  });
}
