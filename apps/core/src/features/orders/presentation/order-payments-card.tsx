import { useEffect, useRef, useState } from "react";
import { Form, useNavigation } from "react-router";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Search } from "lucide-react";
import type { OrderAggregateResponse } from "@shared/contracts/orders";
import { Alert, AlertDescription } from "@core/app/components/ui/alert";
import { Button } from "@core/app/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@core/app/components/ui/card";
import { PaymentDialog, type PaymentDialogKind } from "@core/src/features/orders/presentation/receipt-dialog";
import { paymentErrorKey, type PaymentDecisionResult } from "@core/src/features/orders/presentation/payment-decision-form";
import { paymentDate, paymentRowId, type PaymentFormat } from "@core/src/features/orders/presentation/payment-row";

type Order = OrderAggregateResponse;
type Payment = Order["payments"][number];
type RowAction = "thumbnail" | "viewReceipt" | "approve" | "reject" | "void";

/** Which decisions a row offers: only a pending report of an open order can be reviewed; voiding stays as it is today. */
export function paymentRowActions(payment: Pick<Payment, "status">, order: Pick<Order, "cancelled">) {
  const reviewable = payment.status === "reported" && !order.cancelled;
  return { reject: reviewable, approve: reviewable, void: payment.status === "confirmed" };
}

/** After a lost response the decision is unknown: that row stays blocked until the card reloads, and no row is decided while a reload runs. */
export function paymentRowBlocked(paymentId: string, uncertain: Readonly<{ paymentId: string; order: unknown }> | null, order: unknown, idle: boolean) {
  return !idle || (uncertain !== null && uncertain.paymentId === paymentId && uncertain.order === order);
}

function RowThumbnail({ url, label, onOpen }: { url: string; label: string; onOpen: (element: HTMLElement) => void }) {
  const { t } = useTranslation();
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  if (failed) return <div role="alert" className="flex w-40 shrink-0 flex-col items-start gap-1 text-sm">{t("orders.receiptLoadFailed")}
    <Button type="button" variant="outline" size="sm" className="min-h-touch md:min-h-control" onClick={() => { setFailed(false); setAttempt(attempt + 1); }}>{t("orders.receiptRetry")}</Button></div>;
  return <button type="button" aria-label={label} onClick={event => onOpen(event.currentTarget)}
    className="relative flex min-h-touch shrink-0 items-center justify-center rounded-md focus-visible:ring-2 focus-visible:ring-ring">
    <img key={attempt} src={url} alt="" loading="lazy" decoding="async" width={56} height={80} onError={() => setFailed(true)} className="h-20 w-14 rounded-md border object-cover" />
    <span aria-hidden="true" className="absolute right-1 bottom-1 rounded bg-background/80 p-0.5"><Search className="size-icon-inline" /></span></button>;
}

export function paymentCardSummary(order: Readonly<{ cancelled: boolean; balanceDue: { amount: number }; deliveryCharge: { amount: number };
  payments: readonly Pick<Payment, "status">[] }>) {
  return {
    reviewPending: !order.cancelled && order.payments.some(payment => payment.status === "reported"),
    canRegisterPayment: !order.cancelled && order.balanceDue.amount > 0,
    includesDelivery: order.deliveryCharge.amount > 0,
  };
}

/** Accessible name of a row action; the row date and time keep several rows from sharing one name. */
export function paymentActionName(t: TFunction, action: RowAction, when: string) {
  return t(`orders.paymentActions.${action}`, { date: when });
}

type CardProps = Readonly<{ order: Order; receiptUrls: Record<string, string>; manualPaymentId: string; format: PaymentFormat;
  voidResult: PaymentDecisionResult | undefined }>;
type OpenDialog = Readonly<{ kind: PaymentDialogKind; paymentId: string }>;

export function OrderPaymentsCard({ order, receiptUrls, manualPaymentId, format, voidResult }: CardProps) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const summary = paymentCardSummary(order);
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const [saved, setSaved] = useState(false);
  // A void answer belongs to the moment it arrived: opening a dialog dismisses it so it never sits next to a later result.
  const [dismissedVoid, setDismissedVoid] = useState<unknown>(null);
  const visibleVoid = voidResult !== dismissedVoid ? voidResult : undefined;
  const pendingFocus = useRef<string | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const decided = useRef(false);
  const history = [...order.payments].sort((a, b) => paymentDate(b).localeCompare(paymentDate(a)));
  const open = (kind: PaymentDialogKind, paymentId: string, element: HTMLElement) => {
    opener.current = element; decided.current = false; setSaved(false); setDismissedVoid(voidResult); setDialog({ kind, paymentId });
  };
  // The decided row may only exist after the card reloads, so the focus waits for the next render that finds it.
  useEffect(() => {
    if (!pendingFocus.current) return;
    const row = document.getElementById(paymentRowId(pendingFocus.current));
    if (!row) return;
    row.focus(); pendingFocus.current = null;
  }, [dialog, order.payments]);
  const dialogPayment = dialog ? order.payments.find(payment => payment.id === dialog.paymentId) ?? null : null;
  const idle = navigation.state === "idle";
  const [uncertain, setUncertain] = useState<{ paymentId: string; order: Order } | null>(null);
  return <Card role="region" aria-labelledby="order-payments-title" className="min-w-0 max-xl:order-2">
    <CardHeader><CardTitle id="order-payments-title">{t("orders.payments")}</CardTitle></CardHeader>
    <CardContent className="flex flex-col gap-6">
      <dl className="grid divide-y rounded-lg border text-sm tabular-nums sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <div className="flex flex-col gap-1 p-4"><dt className="text-muted-foreground">{t("orders.total")}</dt><dd className="text-xl font-semibold">{format.amount(order.total)}</dd>
          {summary.includesDelivery && <dd className="text-muted-foreground">{t("orders.includesDelivery", { amount: format.amount(order.deliveryCharge) })}</dd>}</div>
        <div className="flex flex-col gap-1 p-4"><dt className="text-muted-foreground">{t("orderDetail.receivedShort")}</dt><dd className="text-xl font-semibold">{format.amount(order.paidAmount)}</dd></div>
        <div className="flex flex-col gap-1 p-4"><dt className="text-muted-foreground">{t("orderDetail.pendingPayment")}</dt><dd className="text-xl font-semibold">{format.amount(order.balanceDue)}</dd>
          {summary.reviewPending && <dd className="font-medium text-warning-foreground">{t("orders.paymentReviewPending")}</dd>}</div>
      </dl>
      {order.overpaidAmount.amount > 0 && <Alert variant="warning"><AlertDescription>{t("orders.overpaid", { amount: format.amount(order.overpaidAmount) })}</AlertDescription></Alert>}
      {visibleVoid?.error && <Alert variant="destructive"><AlertDescription>{t(paymentErrorKey(visibleVoid.error))}</AlertDescription></Alert>}
      {((saved && !visibleVoid?.error) || visibleVoid?.success) && <Alert variant="success"><AlertDescription role="status">{t("orders.paymentSaved")}</AlertDescription></Alert>}
      <section className="flex flex-col gap-3 border-t pt-4" aria-labelledby="payment-history-title">
        <h3 id="payment-history-title" className="text-sm font-semibold">{t("orderDetail.paymentHistory")}</h3>
        {history.length === 0 ? <p className="text-sm text-muted-foreground">{t("orderDetail.noPayments")}</p> : <ul className="flex flex-col gap-3">{history.map(payment => {
          const when = format.date(paymentDate(payment));
          const actions = paymentRowActions(payment, order);
          const receipt = receiptUrls[payment.id];
          const blocked = paymentRowBlocked(payment.id, uncertain, order, idle);
          const method = payment.method ? t(payment.method === "digital_wallet" ? "orders.wallet" : "orders.bankTransfer") : null;
          const title = payment.status === "reported" ? t("orders.paymentReported")
            : payment.status === "rejected" ? t("orders.paymentRowRejected", { date: when }) : `${format.amount(payment.amount)} · ${method}`;
          const detail = payment.status === "reported" ? t("orders.reportedByBuyer", { date: when })
            : payment.status === "confirmed" ? t("orders.paymentRowConfirmed", { date: when })
            : payment.status === "voided" ? t("orders.paymentRowVoided", { date: when }) : null;
          return <li key={payment.id} id={paymentRowId(payment.id)} tabIndex={-1} className="flex flex-wrap items-center gap-3 rounded-lg border p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {receipt && <RowThumbnail url={receipt} label={paymentActionName(t, "thumbnail", when)} onOpen={element => open("receipt", payment.id, element)} />}
            <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
              <p className="font-medium">{title}</p>
              {detail && <p className="text-muted-foreground">{detail}</p>}
              {payment.status === "rejected" && payment.data.reason && <p className="break-words text-muted-foreground">{t("orders.rejectionReason", { reason: payment.data.reason })}</p>}
              {receipt && <button type="button" aria-label={paymentActionName(t, "viewReceipt", when)} onClick={event => open("receipt", payment.id, event.currentTarget)}
                className="inline-flex min-h-control w-fit items-center text-link underline underline-offset-4 max-md:min-h-touch">{t("orders.viewReceipt")}</button>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {actions.reject && <Button type="button" variant="outline" className="min-h-touch text-destructive md:min-h-control" aria-label={paymentActionName(t, "reject", when)} disabled={blocked}
                onClick={event => open("reject", payment.id, event.currentTarget)}>{t("orders.reject")}</Button>}
              {actions.approve && <Button type="button" className="min-h-touch md:min-h-control" aria-label={paymentActionName(t, "approve", when)} disabled={blocked}
                onClick={event => open("approve", payment.id, event.currentTarget)}>{t("orders.approve")}</Button>}
              {actions.void && <Form method="post"><input type="hidden" name="operation" value="void" /><input type="hidden" name="paymentId" value={payment.id} />
                <Button type="submit" variant="outline" className="min-h-touch md:min-h-control" aria-label={paymentActionName(t, "void", when)} disabled={!idle}>{t("orders.voidPayment")}</Button></Form>}
            </div>
          </li>;
        })}</ul>}
      </section>
      {summary.canRegisterPayment && <section className="flex flex-col gap-1 border-t pt-4">
        <button type="button" onClick={event => open("register", manualPaymentId, event.currentTarget)}
          className="inline-flex min-h-control w-fit items-center text-left text-sm text-link underline underline-offset-4 max-md:min-h-touch">{t("orders.registerPayment")}</button>
        <p className="text-sm text-muted-foreground">{t("orders.registerPaymentHint")}</p>
      </section>}
    </CardContent>
    {dialog && <PaymentDialog key={`${dialog.kind}-${dialog.paymentId}`} kind={dialog.kind} paymentId={dialog.paymentId} payment={dialogPayment} order={order}
      receiptUrl={receiptUrls[dialog.paymentId] ?? null} format={format} onClose={() => setDialog(null)} onUncertain={paymentId => setUncertain({ paymentId, order })}
      onDone={paymentId => { decided.current = true; pendingFocus.current = paymentId; setDialog(null); setSaved(true); }}
      onCloseAutoFocus={event => { event.preventDefault(); if (!decided.current) opener.current?.focus(); }} />}
  </Card>;
}
