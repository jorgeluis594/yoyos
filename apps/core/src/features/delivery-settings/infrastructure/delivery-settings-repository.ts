import { Prisma, type CompanyDeliverySettings } from "@prisma/client";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { log } from "@core/src/shared/infrastructure/logger";
import { prisma, requireActiveTransaction } from "@core/src/shared/infrastructure/persistance";
import { parseDeliverySettings, type DeliverySettings, type DeliverySettingsError, type DeliverySettingsReadError } from "@core/src/features/delivery-settings/domain/delivery-settings";

export function isSettingsPersistenceFailure(cause: unknown): boolean {
  return cause instanceof Prisma.PrismaClientKnownRequestError || cause instanceof Prisma.PrismaClientUnknownRequestError || cause instanceof Prisma.PrismaClientInitializationError;
}

export async function readDeliverySettings(companyId: string, lockMode: "shared" | "exclusive", expectedVersion?: number, operation = lockMode === "exclusive" ? "save_delivery_settings" : "get_delivery_settings"): Promise<Result<DeliverySettings | null, DeliverySettingsReadError>> {
  requireActiveTransaction(companyId);
  try {
    const started = performance.now();
    const rows = lockMode === "exclusive"
      ? await prisma.$queryRaw<CompanyDeliverySettings[]>`SELECT * FROM "CompanyDeliverySettings" WHERE "companyId" = ${companyId}::uuid FOR UPDATE`
      : await prisma.$queryRaw<CompanyDeliverySettings[]>`SELECT * FROM "CompanyDeliverySettings" WHERE "companyId" = ${companyId}::uuid FOR SHARE`;
    if (!rows[0]) return ok(null);
    log.debug({ event: "delivery_lock_acquired", operation, companyId, lockTarget: "delivery_settings", lockMode, lockWaitMs: Math.round(performance.now() - started) }, "Delivery settings lock acquired");
    const row = rows[0];
    const parsed = parseDeliverySettings({ version: row.version, home: { enabled: row.homeEnabled }, store: { enabled: row.storeEnabled,
      pickupPoint: row.pickupName === null && row.pickupAddress === null && row.pickupInstructions === null ? null
        : { name: row.pickupName, address: row.pickupAddress, instructions: row.pickupInstructions } } });
    if (!parsed.success || row.version <= 0) {
      log.error({ event: "delivery_settings_stored_data_invalid", operation, companyId,
        ...(row.version > 0 ? { currentVersion: row.version } : {}), reason: row.version <= 0 ? "invalid_version" : "incomplete_pickup_point" }, "Stored delivery settings are invalid");
      return err({ code: "INVALID_STORED_DATA", message: "Stored delivery settings are invalid" });
    }
    return parsed;
  } catch (cause) {
    if (!isSettingsPersistenceFailure(cause)) throw cause;
    log.error({ event: "delivery_settings_read_failed", operation, companyId, stage: "lock_settings", expectedVersion, errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "Unable to read delivery settings");
    return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to read delivery settings" });
  }
}

export async function writeDeliverySettings(companyId: string, settings: DeliverySettings): Promise<Result<null, DeliverySettingsError>> {
  requireActiveTransaction(companyId);
  const point = settings.store.pickupPoint;
  const expectedVersion = settings.version - 1;
  const data = { homeEnabled: settings.home.enabled, storeEnabled: settings.store.enabled, pickupName: point?.name ?? null,
    pickupAddress: point?.address ?? null, pickupInstructions: point?.instructions ?? null, version: settings.version };
  try {
    if (expectedVersion === 0) await prisma.companyDeliverySettings.create({ data: { companyId, ...data } });
    else {
      const updated = await prisma.companyDeliverySettings.updateMany({ where: { companyId, version: expectedVersion }, data });
      if (updated.count !== 1) return err({ code: "DELIVERY_SETTINGS_CONFLICT", reason: "stale_version", message: "Settings changed since they were loaded" });
    }
    return ok(null);
  } catch (cause) {
    if (!isSettingsPersistenceFailure(cause)) throw cause;
    if (expectedVersion === 0 && cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2002")
      return err({ code: "DELIVERY_SETTINGS_CONFLICT", reason: "concurrent_creation", message: "Settings were created concurrently" });
    log.error({ event: "delivery_settings_write_failed", operation: "save_delivery_settings", companyId, stage: "save_settings", expectedVersion, errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "Unable to save delivery settings");
    return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to save delivery settings" });
  }
}
