import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Check, CircleAlert, Truck, X } from "lucide-react";
import type { OrderAggregateResponse } from "@shared/contracts/orders";
import { orderFulfillmentBlock } from "@shared/orders-fulfillment";
import { cn } from "cn";
import { Badge } from "@core/app/components/ui/badge";
import { Button } from "@core/app/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@core/app/components/ui/card";
import { textLinkClass } from "@core/app/components/ui/text-link";
import { fulfillmentReason } from "@core/src/features/orders/presentation/stock-due";

const timeZone = "America/Lima";
type Operation = "ship" | "deliver";
type Modality = "home" | "agency" | "store" | "none";
type StepKey = "pending" | "shipped" | "delivered" | "cancelled";

export type StatusStep = Readonly<{ key: StepKey; at: string | null; reached: boolean; current: boolean; tone: "done" | "current" | "todo" | "cancelled" | "muted" }>;

/** The steps of the stepper: pickup skips «Enviado»; a cancelled order shows only where it started and where it ended. */
export function statusSteps(order: OrderAggregateResponse): readonly StatusStep[] {
  if (order.cancelled) return [
    { key: "pending", at: order.createdAt, reached: true, current: false, tone: "muted" },
    { key: "cancelled", at: order.cancelledAt, reached: true, current: true, tone: "cancelled" },
  ];
  const keys: readonly StepKey[] = order.delivery?.method === "store" ? ["pending", "delivered"] : ["pending", "shipped", "delivered"];
  const currentIndex = keys.indexOf(order.deliveryStatus);
  const dates = { pending: order.createdAt, shipped: order.shippedAt, delivered: order.deliveredAt, cancelled: null } as const;
  return keys.map((key, index) => {
    const delivered = order.deliveryStatus === "delivered";
    const done = index < currentIndex || delivered;
    return { key, at: dates[key], reached: index <= currentIndex, current: index === currentIndex, tone: done ? "done" : index === currentIndex ? "current" : "todo" };
  });
}

const modalityOf = (order: OrderAggregateResponse): Modality => order.delivery?.method ?? "none";

/** The operation of the primary button, or null when the order cannot move on any more. */
export function primaryOperation(order: OrderAggregateResponse): Operation | null {
  if (order.cancelled || order.deliveryStatus === "delivered") return null;
  return order.deliveryStatus === "shipped" || order.delivery?.method === "store" ? "deliver" : "ship";
}

const dayKey = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(date);

function useStatusDates(now: Date) {
  const { i18n, t } = useTranslation();
  const locale = i18n.language === "pt" ? "pt-BR" : "es-PE";
  const day = (date: Date) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone }).format(date).replace(".", "");
  const time = (date: Date) => new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(date);
  return {
    /** «Hoy 09:10» for today, «29 oct» otherwise. */
    step: (iso: string) => { const date = new Date(iso); return dayKey(date) === dayKey(now) ? `${t("orderStatus.today")} ${time(date)}` : day(date); },
    /** «30 oct, 16:40». */
    full: (iso: string) => { const date = new Date(iso); return `${day(date)}, ${time(date)}`; },
  };
}

const badgeVariant = { pending: "warning", shipped: "info", delivered: "success", cancelled: "destructive" } as const;
const toneClass: Record<StatusStep["tone"], string> = {
  done: "border-[var(--success)] bg-[var(--success-surface)] text-[var(--success)]",
  current: "border-[var(--warning)] bg-[var(--warning-surface)] text-[var(--warning)]",
  todo: "border-border text-muted-foreground",
  muted: "border-border bg-muted text-muted-foreground",
  cancelled: "border-destructive bg-destructive/10 text-destructive",
};

type Props = Readonly<{
  order: OrderAggregateResponse;
  /** Unsaved edits: the transitions wait for the saved order. */
  unsaved: boolean;
  /** A save, payment or fulfillment action is in flight or in doubt. */
  busy: boolean;
  onFulfill: (operation: Operation) => void;
  onCancel: () => void;
  onAddPayment: () => void;
  /** Success or error of the last ship or deliver. */
  feedback?: ReactNode;
  now?: Date;
}>;

function Stepper({ order, now }: Readonly<{ order: OrderAggregateResponse; now: Date }>) {
  const { t } = useTranslation();
  const dates = useStatusDates(now);
  const steps = statusSteps(order);
  const skippedShipment = order.deliveryStatus === "delivered" && order.shippedAt === null;
  return <ol className="flex items-start" aria-label={t("orderStatus.title")}>
    {steps.map((step, index) => {
      const previous = steps[index - 1];
      const connector = step.tone === "cancelled" ? "bg-destructive" : previous && previous.tone === "done" ? "bg-[var(--success)]" : "bg-border";
      return <li key={step.key} className={cn("flex min-w-0 items-start", index > 0 && "flex-1")} aria-current={step.current ? "step" : undefined}>
        {index > 0 && <span aria-hidden="true" className={cn("mx-1 mt-4 h-0.5 flex-1", connector)} />}
        <div className="flex w-20 shrink-0 flex-col items-center gap-1 text-center">
          <span aria-hidden="true" className={cn("flex size-8 items-center justify-center rounded-full border-2 text-sm font-medium", toneClass[step.tone])}>
            {step.tone === "done" || step.tone === "muted" ? <Check className="size-4" /> : step.tone === "cancelled" ? <X className="size-4" /> : index + 1}</span>
          <span className={cn("text-sm", step.reached ? "font-medium text-foreground" : "text-muted-foreground")}>{t(`orderStatus.step.${step.key}`)}</span>
          <span className="min-h-4 text-xs text-muted-foreground">{step.at && step.reached ? dates.step(step.at) : null}</span>
          {step.key === "shipped" && skippedShipment && <span className="sr-only">{t("orderStatus.skipped")}</span>}
        </div>
      </li>;
    })}
  </ol>;
}

export function OrderStatusCard({ order, unsaved, busy, onFulfill, onCancel, onAddPayment, feedback, now = new Date() }: Props) {
  const { t, i18n } = useTranslation();
  const dates = useStatusDates(now);
  const modality = modalityOf(order);
  const status = order.cancelled ? "cancelled" : order.deliveryStatus;
  const primary = primaryOperation(order);
  const block = primary ? orderFulfillmentBlock(order, primary) : null;
  const reason = block && fulfillmentReason(block, primary!, order, i18n.language);
  const noPayment = block?.code === "PAYMENT_REQUIRED";
  const waiting = unsaved || busy;
  const fulfillDisabled = reason !== null && reason !== undefined || waiting;
  const canCancel = !order.cancelled && order.status === "active" && order.deliveryStatus === "pending";
  const noteText = unsaved || !reason || !primary ? null : noPayment ? t(`orderStatus.paymentNote.${primary}`) : t(reason.key, { items: reason.items });
  const run = (operation: Operation) => { if (!fulfillDisabled) onFulfill(operation); };
  const recipient = order.delivery?.recipient.name;
  const link = cn(textLinkClass, "min-h-touch inline-flex items-center aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:no-underline");

  return <Card id="order-status" role="region" aria-labelledby="order-status-title" className="min-w-0">
    <CardHeader className="flex-row items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <CardTitle id="order-status-title">{t("orderStatus.title")}</CardTitle>
        {(modality !== "none" || status === "pending") && <p className="text-sm text-muted-foreground">{t(`orderStatus.modality.${modality}`)}</p>}
      </div>
      <Badge variant={badgeVariant[status]} data-testid="order-status-badge">{t(`orderStatus.badge.${status}`)}</Badge>
    </CardHeader>
    <CardContent className="flex flex-col gap-4">
      <Stepper order={order} now={now} />
      {primary && <div className="flex flex-col gap-3">
        <Button type="button" size="lg" variant="outline" className="w-full" aria-disabled={fulfillDisabled || undefined}
          aria-describedby={noteText || unsaved ? "order-status-note" : undefined} onClick={() => run(primary)}>
          {primary === "ship" ? <Truck data-icon="inline-start" /> : <Check data-icon="inline-start" />}{t(`orderFulfillment.${primary}`)}</Button>
        {unsaved && <p id="order-status-note" className="sr-only">{t("orderView.status.saveFirst")}</p>}
        {noteText && <div id="order-status-note" className="flex items-start gap-2 rounded-lg border border-[var(--warning)]/40 bg-[var(--warning-surface)] p-3 text-sm text-[var(--warning)]">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <p>{noteText}{noPayment && <> <button type="button" className={cn(textLinkClass, "text-inherit")} onClick={onAddPayment}>{t("orderStatus.addPayment")}</button></>}</p>
        </div>}
        <div className="flex flex-wrap items-center justify-between gap-x-4">
          {canCancel ? <button type="button" className={link} aria-disabled={waiting || undefined} onClick={() => { if (!waiting) onCancel(); }}>{t("orderCancellation.cancel")}</button> : <span />}
          {primary === "ship" ? <button type="button" className={link} aria-disabled={fulfillDisabled || undefined} onClick={() => run("deliver")}>{t("orderStatus.deliverDirectly")}</button>
            : modality === "store" && order.deliveryStatus === "pending" && <span className="text-sm text-muted-foreground">{t("orderStatus.pickupNoShipping")}</span>}
        </div>
      </div>}
      {order.deliveryStatus === "delivered" && !order.cancelled && order.deliveredAt
        && <p className="text-sm">{recipient ? t("orderStatus.deliveredTo", { name: recipient, date: dates.full(order.deliveredAt) }) : t("orderStatus.delivered", { date: dates.full(order.deliveredAt) })}</p>}
      {order.cancelled && <p className="text-sm">{order.cancelledAt ? t("orderStatus.cancelledOn", { date: dates.full(order.cancelledAt) }) : t("orderStatus.cancelled")}{order.stockDeducted && ` ${t("orderStatus.stockReturned")}`}</p>}
      {feedback}
    </CardContent>
  </Card>;
}
