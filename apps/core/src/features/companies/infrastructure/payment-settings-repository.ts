import { Prisma } from "@prisma/client";
import { err, ok } from "@shared/functional";
import { log } from "@core/src/shared/infrastructure/logger";
import { prisma } from "@core/src/shared/infrastructure/persistance";
import { parsePaymentSettings, type CompanyPaymentSettings } from "@core/src/features/companies/domain/payment-settings";

export async function loadPaymentSettings(companyId: string) {
  try {
    const row = await prisma.companyPaymentSettings.findUnique({ where: { companyId }, select: { settings: true } });
    if (!row) return ok<readonly CompanyPaymentSettings[]>([]);
    const parsed = parsePaymentSettings(row.settings);
    if (!parsed.success) {
      log.error({ event: "invalid_stored_company_payment_settings", companyId, errorCode: "INVALID_STORED_DATA" }, "invalid_stored_company_payment_settings");
      return err({ code: "INVALID_STORED_DATA" as const, message: "Invalid stored payment settings" });
    }
    return ok<readonly CompanyPaymentSettings[]>(parsed.data);
  } catch (cause) {
    if (!(cause instanceof Prisma.PrismaClientKnownRequestError || cause instanceof Prisma.PrismaClientUnknownRequestError || cause instanceof Prisma.PrismaClientInitializationError)) throw cause;
    log.error({ event: "unable_to_load_company_payment_settings", companyId, err: cause }, "unable_to_load_company_payment_settings");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to load payment settings" });
  }
}

export async function persistPaymentSettings(companyId: string, settings: readonly CompanyPaymentSettings[]) {
  try {
    await prisma.companyPaymentSettings.upsert({ where: { companyId },
      create: { companyId, settings: settings as Prisma.InputJsonArray },
      update: { settings: settings as Prisma.InputJsonArray } });
    return ok<null>(null);
  } catch (cause) {
    if (!(cause instanceof Prisma.PrismaClientKnownRequestError || cause instanceof Prisma.PrismaClientUnknownRequestError || cause instanceof Prisma.PrismaClientInitializationError)) throw cause;
    log.error({ event: "unable_to_save_company_payment_settings", companyId, err: cause }, "unable_to_save_company_payment_settings");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to save payment settings" });
  }
}
