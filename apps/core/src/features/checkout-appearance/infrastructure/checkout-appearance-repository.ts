import { Prisma } from "@prisma/client";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { log } from "@core/src/shared/infrastructure/logger";
import { prisma } from "@core/src/shared/infrastructure/persistance";
import {
  parseCheckoutAppearance, type CheckoutAppearance, type CompanyId,
} from "@core/src/features/checkout-appearance/domain/checkout-appearance";

type RepositoryFailure = Readonly<{ code: "INVALID_IMAGE" | "INVALID_STORED_DATA" | "PERSISTENCE_UNAVAILABLE"; message: string }>;

function isDatabaseFailure(cause: unknown): cause is Prisma.PrismaClientKnownRequestError | Prisma.PrismaClientUnknownRequestError | Prisma.PrismaClientInitializationError {
  return cause instanceof Prisma.PrismaClientKnownRequestError || cause instanceof Prisma.PrismaClientUnknownRequestError
    || cause instanceof Prisma.PrismaClientInitializationError;
}

const unavailable = (message: string) => err({ code: "PERSISTENCE_UNAVAILABLE" as const, message });

export async function loadCheckoutAppearance(companyId: CompanyId): Promise<Result<CheckoutAppearance | null, RepositoryFailure>> {
  try {
    const row = await prisma.companyCheckoutAppearance.findUnique({ where: { companyId },
      select: { logoImageId: true, brandColor: true, background: true } });
    if (!row) return ok(null);
    const parsed = parseCheckoutAppearance(row);
    if (!parsed.success) {
      log.error({ event: "invalid_stored_checkout_appearance", companyId, errorCode: "INVALID_STORED_DATA",
        invalidFields: parsed.error.invalidFields }, "invalid_stored_checkout_appearance");
      return err({ code: "INVALID_STORED_DATA", message: "Invalid stored checkout appearance" });
    }
    return ok(parsed.data);
  } catch (cause) {
    if (!isDatabaseFailure(cause)) throw cause;
    log.error({ event: "unable_to_load_checkout_appearance", companyId, operation: "get_checkout", errorCode: "PERSISTENCE_UNAVAILABLE", err: cause },
      "unable_to_load_checkout_appearance");
    return unavailable("Unable to load checkout appearance");
  }
}

export async function persistCheckoutAppearance(companyId: CompanyId, appearance: CheckoutAppearance): Promise<Result<null, RepositoryFailure>> {
  try {
    await prisma.companyCheckoutAppearance.upsert({ where: { companyId },
      create: { companyId, ...appearance }, update: { ...appearance } });
    return ok(null);
  } catch (cause) {
    if (!isDatabaseFailure(cause)) throw cause;
    // The composite foreign key rejects a logo that is not an image of this company.
    if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2003")
      return err({ code: "INVALID_IMAGE", message: "Logo image does not belong to the company" });
    log.error({ event: "unable_to_save_checkout_appearance", companyId, ...(appearance.logoImageId ? { logoImageId: appearance.logoImageId } : {}),
      errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "unable_to_save_checkout_appearance");
    return unavailable("Unable to save checkout appearance");
  }
}

export async function loadCompanyName(companyId: CompanyId): Promise<Result<string, RepositoryFailure>> {
  try {
    const company = await prisma.company.findUnique({ where: { id: companyId }, select: { name: true } });
    if (company) return ok(company.name);
    return unavailable("Company not found");
  } catch (cause) {
    if (!isDatabaseFailure(cause)) throw cause;
    log.error({ event: "unable_to_load_checkout_appearance", companyId, operation: "get_company_name", errorCode: "PERSISTENCE_UNAVAILABLE", err: cause },
      "unable_to_load_checkout_appearance");
    return unavailable("Unable to load company");
  }
}
