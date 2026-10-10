import { Prisma } from "@prisma/client";
import { ok, err } from "@shared/functional";
import type { Result } from "@shared/result";
import { prisma, requireActiveTransaction } from "@core/src/shared/infrastructure/persistance";
import { bindCompanyToRequest, bindRequestOperation, log } from "@core/src/shared/infrastructure/logger";
import { findOrderAggregate, findOrderForUpdate } from "@core/src/features/orders/infrastructure/order-repository";
import type { CheckoutAccess, CheckoutError, CheckoutOrder, OrderBuyer } from "@core/src/features/orders/domain/checkout";
import type { OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";

const failure = (cause: unknown, event: string): Result<never, CheckoutError> => {
  if (!(cause instanceof Prisma.PrismaClientKnownRequestError || cause instanceof Prisma.PrismaClientUnknownRequestError || cause instanceof Prisma.PrismaClientInitializationError)) throw cause;
  log.error({ event, errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "Checkout persistence failed");
  return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Checkout persistence is unavailable" });
};

async function readCheckout(access: CheckoutAccess, lock: boolean): Promise<Result<(CheckoutOrder & OrderAggregate) | null, CheckoutError>> {
  const result = await (lock ? findOrderForUpdate : findOrderAggregate)(access.orderId, access.companyId);
  if (!result.success) return err({ code: result.error.code === "INVALID_ORDER" ? "INVALID_CHECKOUT" : "PERSISTENCE_UNAVAILABLE", message: "Unable to read checkout" });
  if (!result.data) return ok(null);
  const order = result.data;
  if (order.checkoutEnabledAt) {
    bindCompanyToRequest(order.companyId);
    bindRequestOperation({ orderNumber: order.number });
  }
  try {
    const company = await prisma.company.findUniqueOrThrow({ where: { id: order.companyId }, select: { name: true } });
    return ok({ ...order, companyName: company.name });
  } catch (cause) { return failure(cause, "unable_to_load_order_aggregate"); }
}

export const findCheckoutOrder = (access: CheckoutAccess) => readCheckout(access, false);
export const findCheckoutOrderForUpdate = (access: CheckoutAccess) => readCheckout(access, true);

export async function saveCheckoutEnabled(access: CheckoutAccess, at: Date): Promise<Result<null, CheckoutError>> {
  requireActiveTransaction(access.companyId);
  try {
    await prisma.order.update({ where: { companyId_id: { companyId: access.companyId, id: access.orderId } }, data: { checkoutEnabledAt: at } });
    return ok(null);
  } catch (cause) { return failure(cause, "unable_to_save_checkout_enabled"); }
}

export async function saveCheckoutBuyer(access: CheckoutAccess, buyer: OrderBuyer): Promise<Result<null, CheckoutError>> {
  requireActiveTransaction(access.companyId);
  try {
    await prisma.orderBuyer.upsert({ where: { companyId_orderId: access },
      create: { ...access, ...buyer }, update: { name: buyer.name, phone: buyer.phone, contactId: buyer.contactId } });
    return ok(null);
  } catch (cause) { return failure(cause, "unable_to_save_order_buyer"); }
}

export async function saveCheckoutConfirmed(access: CheckoutAccess, at: Date): Promise<Result<null, CheckoutError>> {
  requireActiveTransaction(access.companyId);
  try {
    await prisma.order.update({ where: { companyId_id: { companyId: access.companyId, id: access.orderId } }, data: { checkoutConfirmedAt: at } });
    return ok(null);
  } catch (cause) { return failure(cause, "unable_to_save_checkout_confirmation"); }
}
