import { Prisma } from "@prisma/client";
import { err, ok } from "@shared/functional";
import { log } from "@core/src/shared/infrastructure/logger";
import { prisma } from "@core/src/shared/infrastructure/persistance";
import type { ConfiguredDispatchSender } from "@core/src/features/dispatch-sender/domain/dispatch-sender";

function isDatabaseFailure(cause: unknown) {
  return cause instanceof Prisma.PrismaClientKnownRequestError || cause instanceof Prisma.PrismaClientUnknownRequestError
    || cause instanceof Prisma.PrismaClientInitializationError;
}

/** Reads the company's current name and its sender in one query, so the fallback is never out of step with the row. */
export async function loadDispatchSender(companyId: string) {
  try {
    const company = await prisma.company.findUnique({ where: { id: companyId },
      select: { name: true, dispatchSender: { select: { name: true, phone: true } } } });
    return ok(company ? { companyName: company.name, sender: company.dispatchSender } : null);
  } catch (cause) {
    if (!isDatabaseFailure(cause)) throw cause;
    log.error({ event: "unable_to_load_dispatch_sender", companyId, errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "unable_to_load_dispatch_sender");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to load dispatch sender" });
  }
}

export async function persistDispatchSender(companyId: string, sender: ConfiguredDispatchSender) {
  try {
    await prisma.companyDispatchSender.upsert({ where: { companyId },
      create: { companyId, name: sender.name, phone: sender.phone }, update: { name: sender.name, phone: sender.phone } });
    return ok<null>(null);
  } catch (cause) {
    if (!isDatabaseFailure(cause)) throw cause;
    log.error({ event: "unable_to_save_dispatch_sender", companyId, errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "unable_to_save_dispatch_sender");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to save dispatch sender" });
  }
}
