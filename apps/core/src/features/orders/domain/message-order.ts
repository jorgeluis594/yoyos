import type { ConfirmationData } from "@core/src/features/orders/domain/payment";
import type { OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import type { CustomerId } from "@core/src/features/contacts/domain/contact";

export type ChatId = string & { readonly __brand: "ChatId" };

/** Where a chat order comes from: its chat and the customer of the chat's contact. */
export type OrderChatSource = Readonly<{ chatId: ChatId; customerId: CustomerId }>;

export function isOpenForMessageItems(order: OrderAggregate, chatId: ChatId): boolean {
  return order.chatId === chatId && !order.cancelled && order.completedAt === null
    && order.payments.every((payment) => payment.status === "voided")
    && order.checkoutConfirmedAt === null && order.deliveryStatus === "pending" && !order.stockDeducted;
}

/** A span during which the order was open for messages; `until` null means it still is. */
export type MessageOpenInterval = Readonly<{ from: Date; until: Date | null }>;

type PaymentEvent = Readonly<{ at: Date; change: 1 | -1 }>;

/** The open-for-messages history of an order, derived only from its stored times, ordered by `from`. Flags that revert (`completedAt`, `deliveryStatus`, `stockDeducted`) are never read. */
export function messageOpenIntervals(order: OrderAggregate, chatId: ChatId): readonly MessageOpenInterval[] {
  if (!order.chatId || order.chatId !== chatId) return [];
  const closing = closingTime(order);
  const intervals: MessageOpenInterval[] = [];
  let active = 0;
  let from: Date | null = order.createdAt;
  const close = (until: Date | null) => {
    if (from && (!until || until.getTime() > from.getTime())) intervals.push({ from, until });
    from = null;
  };
  for (const event of paymentEvents(order)) {
    if (closing && event.at.getTime() >= closing.getTime()) break;
    active += event.change;
    if (event.change === 1) close(event.at);
    else if (active === 0 && !from) from = event.at;
  }
  if (closing && from && closing.getTime() <= from.getTime()) return intervals;
  if (from) close(closing);
  return intervals;
}

/** The first of the times that end the order for good; each is set once and never cleared. */
function closingTime(order: OrderAggregate): Date | null {
  const times = [order.cancelledAt, order.checkoutConfirmedAt, order.shippedAt, order.deliveredAt, order.stockDeductedAt]
    .filter((time): time is Date => time !== null);
  return times.length === 0 ? null : times.reduce((first, time) => (time.getTime() < first.getTime() ? time : first));
}

/** A payment exists from its report, or from its confirmation when it was recorded without one; only a voided payment stops counting. */
function paymentEvents(order: OrderAggregate): readonly PaymentEvent[] {
  const events = order.payments.flatMap((payment): PaymentEvent[] => {
    switch (payment.status) {
      case "reported": return [{ at: payment.data.reportedAt, change: 1 }];
      case "rejected": return [{ at: payment.data.report.reportedAt, change: 1 }];
      case "confirmed": return [{ at: existsFrom(payment.data), change: 1 }];
      case "voided": return [{ at: existsFrom(payment.data), change: 1 }, { at: payment.data.voidedAt, change: -1 }];
    }
  });
  return events.sort((left, right) => left.at.getTime() - right.at.getTime() || right.change - left.change);
}

const existsFrom = (data: ConfirmationData): Date => (data.evidence.kind === "buyer_report" ? data.evidence.report.reportedAt : data.confirmedAt);
