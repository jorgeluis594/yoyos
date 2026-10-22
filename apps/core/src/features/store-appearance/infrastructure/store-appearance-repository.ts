import { Prisma } from "@prisma/client";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { log } from "@core/src/shared/infrastructure/logger";
import { prisma } from "@core/src/shared/infrastructure/persistance";
import { storeThemeIds } from "@shared/store-themes";
import {
  parseStoreAppearance, type StoreAppearance, type CompanyId,
} from "@core/src/features/store-appearance/domain/store-appearance";

type RepositoryFailure = Readonly<{ code: "INVALID_IMAGE" | "INVALID_STORED_DATA" | "UNKNOWN_STORED_THEME" | "PERSISTENCE_UNAVAILABLE"; message: string }>;

function isDatabaseFailure(cause: unknown): cause is Prisma.PrismaClientKnownRequestError | Prisma.PrismaClientUnknownRequestError | Prisma.PrismaClientInitializationError {
  return cause instanceof Prisma.PrismaClientKnownRequestError || cause instanceof Prisma.PrismaClientUnknownRequestError
    || cause instanceof Prisma.PrismaClientInitializationError;
}

const unavailable = (message: string) => err({ code: "PERSISTENCE_UNAVAILABLE" as const, message });

export async function loadStoreAppearance(companyId: CompanyId): Promise<Result<StoreAppearance | null, RepositoryFailure>> {
  try {
    const row = await prisma.companyCheckoutAppearance.findUnique({ where: { companyId },
      select: { logoImageId: true, theme: true } });
    if (!row) return ok(null);
    if (!(storeThemeIds as readonly string[]).includes(row.theme)) {
      log.error({ event: "invalid_stored_store_appearance", companyId, errorCode: "UNKNOWN_STORED_THEME", invalidFields: ["theme"] },
        "invalid_stored_store_appearance");
      return err({ code: "UNKNOWN_STORED_THEME", message: "Stored store theme is not one of the known themes" });
    }
    const parsed = parseStoreAppearance(row);
    if (!parsed.success) {
      log.error({ event: "invalid_stored_store_appearance", companyId, errorCode: "INVALID_STORED_DATA",
        invalidFields: parsed.error.invalidFields }, "invalid_stored_store_appearance");
      return err({ code: "INVALID_STORED_DATA", message: "Invalid stored store appearance" });
    }
    return ok(parsed.data);
  } catch (cause) {
    if (!isDatabaseFailure(cause)) throw cause;
    log.error({ event: "unable_to_load_store_appearance", companyId, operation: "get_store_appearance", errorCode: "PERSISTENCE_UNAVAILABLE", err: cause },
      "unable_to_load_store_appearance");
    return unavailable("Unable to load store appearance");
  }
}

export async function persistStoreAppearance(companyId: CompanyId, appearance: StoreAppearance): Promise<Result<null, RepositoryFailure>> {
  try {
    await prisma.companyCheckoutAppearance.upsert({ where: { companyId },
      create: { companyId, ...appearance }, update: { ...appearance } });
    return ok(null);
  } catch (cause) {
    if (!isDatabaseFailure(cause)) throw cause;
    // The composite foreign key rejects a logo that is not an image of this company.
    if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2003")
      return err({ code: "INVALID_IMAGE", message: "Logo image does not belong to the company" });
    log.error({ event: "unable_to_save_store_appearance", companyId, ...(appearance.logoImageId ? { logoImageId: appearance.logoImageId } : {}),
      errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "unable_to_save_store_appearance");
    return unavailable("Unable to save store appearance");
  }
}

export async function loadCompanyName(companyId: CompanyId): Promise<Result<string, RepositoryFailure>> {
  try {
    const company = await prisma.company.findUnique({ where: { id: companyId }, select: { name: true } });
    if (company) return ok(company.name);
    return unavailable("Company not found");
  } catch (cause) {
    if (!isDatabaseFailure(cause)) throw cause;
    log.error({ event: "unable_to_load_store_appearance", companyId, operation: "get_company_name", errorCode: "PERSISTENCE_UNAVAILABLE", err: cause },
      "unable_to_load_store_appearance");
    return unavailable("Unable to load company");
  }
}
