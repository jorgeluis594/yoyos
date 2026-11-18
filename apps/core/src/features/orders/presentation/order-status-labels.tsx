import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { CircleCheck, CircleX, CreditCard, Truck } from "lucide-react";
import { cn } from "cn";
import { formatCurrency } from "@core/app/format-currency";
import type { Money } from "@shared/money";
import { paymentProgress } from "@shared/orders-payment";

type OrderSource = "manual" | "catalog" | "whatsapp";
export type LabelledOrder = Readonly<{
  status: "active" | "completed" | "cancelled";
  paymentStatus: "pending" | "paid";
  deliveryStatus: "pending" | "shipped" | "delivered";
  total: Money;
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
  const progress = paymentProgress(order);
  const payment = progress.kind === "paid" ? t("orderView.labels.paid")
    : progress.kind === "partial" ? t("orderView.labels.paymentPartial", { amount: formatCurrency(progress.balanceDue.amount, progress.balanceDue.currency, language) })
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

/** The list's states as visible text, each with its icon: a seller reads paid, partial, shipped or pending without opening anything. */
export function OrderStatusText({ order }: { order: LabelledOrder }) {
  const { t, i18n } = useTranslation();
  return <ul className="flex flex-col gap-0.5 text-xs font-normal">{orderStatusLabels(order, t, i18n.language).map((label) =>
    <li key={label.kind} className="inline-flex items-center gap-1.5"><OrderStatusIcon label={label} /><span>{label.text}</span></li>)}</ul>;
}
