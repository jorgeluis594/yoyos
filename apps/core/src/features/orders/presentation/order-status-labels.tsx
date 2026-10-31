import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { CircleCheck, CircleX, CreditCard, Truck } from "lucide-react";
import { cn } from "cn";
import { formatCurrency } from "@core/app/format-currency";
import type { Money } from "@shared/money";

type OrderSource = "manual" | "catalog" | "whatsapp";
export type LabelledOrder = Readonly<{
  status: "active" | "completed" | "cancelled";
  paymentStatus: "pending" | "paid";
  deliveryStatus: "pending" | "shipped" | "delivered";
  balanceDue: Money;
}>;
export type OrderStatusLabel = Readonly<{
  kind: "order" | "payment" | "delivery";
  state: "pending" | "paid" | "shipped" | "delivered" | "completed" | "cancelled";
  text: string;
  name: string;
}>;

const originKeys = { manual: "orderView.header.origin.manual", catalog: "orderView.header.origin.catalog", whatsapp: "orderView.header.origin.whatsapp" } as const;

export function orderOriginKey(source: OrderSource) {
  return originKeys[source];
}

/** A completed or cancelled order shows one label; an active one shows its payment and its delivery. */
export function orderStatusLabels(order: LabelledOrder, t: TFunction, language: string): OrderStatusLabel[] {
  if (order.status === "completed") return [{ kind: "order", state: "completed", text: t("orderView.labels.completed"), name: t("orderView.labels.completedName", { label: t("orderView.labels.completed") }) }];
  if (order.status === "cancelled") return [{ kind: "order", state: "cancelled", text: t("orderView.labels.cancelled"), name: t("orderView.labels.cancelledName", { label: t("orderView.labels.cancelled") }) }];
  const payment = order.paymentStatus === "paid" ? t("orderView.labels.paid")
    : order.balanceDue.amount > 0 ? t("orderView.labels.paymentPendingBalance", { amount: formatCurrency(order.balanceDue.amount, order.balanceDue.currency, language) })
    : t("orderView.labels.paymentPending");
  const delivery = t(`orderView.labels.${order.deliveryStatus === "pending" ? "deliveryPending" : order.deliveryStatus}`);
  return [
    { kind: "payment", state: order.paymentStatus, text: payment, name: t("orderView.labels.paymentName", { label: payment }) },
    { kind: "delivery", state: order.deliveryStatus, text: delivery, name: t("orderView.labels.deliveryName", { label: delivery }) },
  ];
}

const tone = (state: OrderStatusLabel["state"]) =>
  state === "pending" ? "text-[var(--warning)]" : state === "shipped" ? "text-[var(--info)]" : state === "cancelled" ? "text-muted-foreground" : "text-[var(--success)]";

export function OrderStatusIcon({ label }: { label: OrderStatusLabel }) {
  const Icon = label.kind === "payment" ? CreditCard : label.kind === "delivery" ? Truck : label.state === "cancelled" ? CircleX : CircleCheck;
  return <Icon className={cn("size-4", tone(label.state))} aria-hidden="true" />;
}

/** The list's compact control: icons that open to show the text, with the text as accessible name and tooltip. */
export function OrderStatusIndicators({ order }: { order: LabelledOrder }) {
  const { t, i18n } = useTranslation();
  const labels = orderStatusLabels(order, t, i18n.language);
  const name = labels.map((label) => label.name).join(" · ");
  const text = labels.map((label) => label.text).join(" · ");
  return <details className="order-state-indicator max-w-32">
    <summary aria-label={name} title={name} className="flex cursor-pointer list-none items-center justify-center gap-1 rounded-[var(--radius-control)] transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
      {labels.map((label) => <OrderStatusIcon key={label.kind} label={label} />)}
    </summary>
    <span className="block pt-1 text-xs font-normal text-muted-foreground">{text}</span>
  </details>;
}
