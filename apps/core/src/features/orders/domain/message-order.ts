import { z } from "zod";
import type { OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";

export type VariantQrCode = string & { readonly __brand: "VariantQrCode" };
export type ChatId = string & { readonly __brand: "ChatId" };

export type MessageOrderSkipReason =
  | "not_image"
  | "outgoing_message"
  | "no_qr_code"
  | "unrecognized_qr_code"
  | "product_not_found";

export type ScanSelection =
  | Readonly<{ kind: "codes"; codes: readonly [VariantQrCode, ...VariantQrCode[]] }>
  | Readonly<{ kind: "skip"; reason: "no_qr_code" | "unrecognized_qr_code" }>;

const productCodeSchema = z.uuid(); // QR de pago (Yape/Plin) o URLs no son productos

export function selectProductCode(decoded: readonly string[]): ScanSelection {
  if (!decoded.length) return { kind: "skip", reason: "no_qr_code" };
  const codes = [...new Set(decoded.filter((value) => productCodeSchema.safeParse(value).success))];
  const [first, ...rest] = codes as VariantQrCode[];
  return first ? { kind: "codes", codes: [first, ...rest] } : { kind: "skip", reason: "unrecognized_qr_code" };
}

export function isOpenForMessageItems(order: OrderAggregate, chatId: ChatId): boolean {
  return order.chatId === chatId && !order.cancelled && order.completedAt === null
    && order.payments.every((payment) => payment.status === "voided")
    && order.checkoutConfirmedAt === null && order.deliveryStatus === "pending" && !order.stockDeducted;
}
