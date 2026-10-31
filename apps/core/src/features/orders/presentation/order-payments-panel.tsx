import { useEffect, useId, useRef, useState } from "react";
import { Form, useNavigation } from "react-router";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Search } from "lucide-react";
import type { OrderAggregateResponse } from "@shared/contracts/orders";
import { subtract, type Money } from "@shared/money";
import { offersPartialStockDeduction } from "@shared/orders-payment";
import { paymentChoices, paymentFromChoice, walletProviderLabel, type PaymentChoice } from "@shared/wallet-providers";
import { Alert, AlertDescription } from "@core/app/components/ui/alert";
import { Button } from "@core/app/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@core/app/components/ui/card";
import { paymentErrorKey, type PaymentDecisionResult } from "@core/src/features/orders/presentation/payment-decision-form";
import { isValidPaymentAmount, PaymentFields, type PaymentDraft } from "@core/src/features/orders/presentation/payment-fields";
import { paymentDate, paymentRowId, type PaymentFormat } from "@core/src/features/orders/presentation/payment-row";
import { PaymentDialog, type PaymentDialogKind } from "@core/src/features/orders/presentation/receipt-dialog";
import type { Estimate, PaymentRow } from "@core/src/features/orders/presentation/order-view-state";
import { paymentRecordedKey } from "@core/src/features/orders/presentation/stock-due";

type Order = OrderAggregateResponse;
type Payment = Order["payments"][number];
type RowAction = "thumbnail" | "viewReceipt" | "approve" | "reject" | "void";
type Totals = Pick<Estimate, "total" | "paid" | "balance" | "excess">;

export const draftPaymentRowId = (paymentId: string) => `payment-draft-${paymentId}`;

export type PaymentsSummary =
  | Readonly<{ key: "none" | "paid" }>
  | Readonly<{ key: "partial" | "paidExcess"; amount: Money }>;

/** The one line under the title: nothing paid, a balance left, paid, or paid with an excess. */
export function paymentsSummary(totals: Totals): PaymentsSummary {
  if (totals.paid.amount === 0) return { key: "none" };
  if (totals.balance.amount > 0) return { key: "partial", amount: totals.balance };
  return totals.excess.amount > 0 ? { key: "paidExcess", amount: totals.excess } : { key: "paid" };
}

/** Only a pending report of an open order can be reviewed; only a confirmed payment can be voided, also on a cancelled order. */
function rowActions(payment: Pick<Payment, "status">, order: Pick<Order, "cancelled">) {
  const reviewable = payment.status === "reported" && !order.cancelled;
  return { reject: reviewable, approve: reviewable, void: payment.status === "confirmed" };
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

type Common = Readonly<{
  format: PaymentFormat;
  /** Payments need at least one product: without it the card only says so. */
  hasProducts: boolean;
  /** A save, a payment action or a fulfillment action is in flight or in doubt. */
  busy?: boolean;
}>;
type SavedProps = Readonly<{
  mode: "saved"; order: Order; receiptUrls: Record<string, string>; manualPaymentId: string; voidResult: PaymentDecisionResult | undefined;
  /** Edits of products, customer or delivery not saved yet: they block the actions that need the saved balance. */
  unsavedChanges: boolean;
}>;
type NewProps = Readonly<{
  mode: "new"; payments: readonly PaymentRow[]; onChange: (payments: readonly PaymentRow[]) => void; estimate: Totals;
  newPaymentId: () => string; invalidPaymentIds?: readonly string[];
}>;
export type PaymentsPanelProps = Common & (SavedProps | NewProps);

function ActionButtons({ choices, blockedNote, disabled, onPick }: { choices: readonly PaymentChoice[]; blockedNote: string | null; disabled: boolean; onPick: (choice: PaymentChoice, element: HTMLElement) => void }) {
  const { t } = useTranslation();
  const noteId = useId();
  return <div id="payment-actions" className="flex flex-col gap-2 border-t pt-4">
    <div className="flex flex-wrap gap-2">{choices.map(choice => {
      const blocked = blockedNote !== null;
      const label = choice === "bank_transfer" ? t("orderView.payments.bankTransfer") : t("orderView.payments.addWallet", { wallet: walletProviderLabel(choice) });
      return <Button key={choice} type="button" variant="outline" className="min-h-touch md:min-h-control" disabled={disabled}
        aria-disabled={blocked ? true : undefined} aria-describedby={blocked ? noteId : undefined}
        onClick={event => { if (!blocked) onPick(choice, event.currentTarget); }}>{label}</Button>;
    })}</div>
    {blockedNote && <p id={noteId} className="sr-only">{blockedNote}</p>}
  </div>;
}

function methodLabel(t: TFunction, row: Pick<PaymentRow, "method" | "walletProvider">) {
  return row.walletProvider ? walletProviderLabel(row.walletProvider) : t(row.method === "digital_wallet" ? "orders.wallet" : "orders.bankTransfer");
}

function Summary({ totals, reviewPending, format }: { totals: Totals; reviewPending: boolean; format: PaymentFormat }) {
  const { t } = useTranslation();
  const summary = paymentsSummary(totals);
  const text = summary.key === "partial" || summary.key === "paidExcess" ? t(`orderView.payments.${summary.key}`, { amount: format.amount(summary.amount) }) : t(`orderView.payments.${summary.key}`);
  return <div className="flex flex-col gap-1 text-sm tabular-nums"><p className="font-medium">{text}</p>
    {reviewPending && <p className="font-medium text-warning-foreground">{t("orderView.payments.review")}</p>}</div>;
}

export function OrderPaymentsPanel(props: PaymentsPanelProps) {
  return props.mode === "saved" ? <SavedPanel {...props} /> : <NewPanel {...props} />;
}

// ---------------------------------------------------------------------------------------------------------------------
// New sale: draft rows

/** Balance for a draft row: the total minus the other rows, so the partial stock box follows what this row would leave. */
function balanceWithout(totals: Totals, row: PaymentRow): Money {
  const others = isValidPaymentAmount(row.amount) ? subtract({ amount: Number(row.amount), currency: totals.total.currency })(totals.paid) : { success: true as const, data: totals.paid };
  const left = others.success ? subtract(others.data)(totals.total) : null;
  return left?.success && left.data.amount > 0 ? left.data : left?.success ? { amount: 0, currency: totals.total.currency } : totals.balance;
}

/** Whether the partial stock box shows for a draft row: only when the row leaves a balance. */
function offersStockBox(totals: Totals, row: PaymentRow) {
  const typed = isValidPaymentAmount(row.amount) ? { amount: Number(row.amount), currency: totals.total.currency } : null;
  return offersPartialStockDeduction({ stockDeducted: false, balanceDue: balanceWithout(totals, row) }, typed);
}

function DraftRow({ row, index, totals, invalid, autoFocus, busy, onChange, onRemove }: { row: PaymentRow; index: number; totals: Totals; invalid: boolean; autoFocus: boolean; busy: boolean;
  onChange: (row: PaymentRow) => void; onRemove: () => void }) {
  const { t } = useTranslation();
  const stockBox = offersStockBox(totals, row);
  const value: PaymentDraft = { amount: row.amount, method: row.method, walletProvider: row.walletProvider, deductStockIfPartial: row.deductStockIfPartial && stockBox };
  const label = methodLabel(t, row);
  return <li id={draftPaymentRowId(row.paymentId)} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-start">
    <PaymentFields value={value} showStockBox={stockBox} autoFocusAmount={autoFocus} invalid={invalid}
      onChange={next => onChange({ paymentId: row.paymentId, amount: next.amount, method: next.method, walletProvider: next.walletProvider, deductStockIfPartial: next.deductStockIfPartial })} />
    {invalid && row.amount === "" && <p role="alert" className="col-span-full text-sm text-destructive">{t("orders.paymentInvalidAmount")}</p>}
    <Button type="button" variant="outline" className="min-h-touch self-end sm:col-start-3 sm:row-start-1 md:min-h-control" disabled={busy} aria-label={`${t("orderView.payments.remove")} ${index + 1}: ${label}`}
      onClick={onRemove}>{t("orderView.payments.remove")}</Button>
  </li>;
}

function NewPanel({ payments, onChange, estimate, newPaymentId, invalidPaymentIds = [], hasProducts, busy = false, format }: Common & NewProps) {
  const { t } = useTranslation();
  const [lastAdded, setLastAdded] = useState<string | null>(null);
  const removed = useRef(false);
  const content = useRef<HTMLDivElement>(null);
  const canAdd = hasProducts && estimate.balance.amount > 0;
  // A removed row takes the focus with it: it goes back to the first payment button.
  useEffect(() => {
    if (!removed.current) return;
    removed.current = false;
    const button = content.current?.querySelector<HTMLElement>("#payment-actions button:not(:disabled)");
    if (button) return button.focus();
    const title = document.getElementById("order-payments-title");
    title?.setAttribute("tabindex", "-1");
    title?.focus();
  }, [payments]);
  // A hidden partial stock box never keeps a ticked flag: the request would make the order due on a payment the seller did not choose.
  useEffect(() => {
    if (!payments.some(row => row.deductStockIfPartial && !offersStockBox(estimate, row))) return;
    onChange(payments.map(row => row.deductStockIfPartial && !offersStockBox(estimate, row) ? { ...row, deductStockIfPartial: false } : row));
  }, [payments, estimate, onChange]);
  const add = (choice: PaymentChoice) => {
    const row: PaymentRow = { paymentId: newPaymentId(), amount: estimate.balance.amount.toFixed(2), deductStockIfPartial: false, ...paymentFromChoice(choice) };
    setLastAdded(row.paymentId);
    onChange([...payments, row]);
  };
  return <Card id="order-payments" role="region" aria-labelledby="order-payments-title" tabIndex={-1} className="min-w-0 outline-none">
    <CardHeader><CardTitle id="order-payments-title">{t("orderView.payments.title")}</CardTitle></CardHeader>
    <CardContent ref={content} className="flex flex-col gap-4">
      {hasProducts && <Summary totals={estimate} reviewPending={false} format={format} />}
      {!hasProducts && payments.length === 0 ? <p className="text-sm text-muted-foreground">{t("orderView.payments.needProducts")}</p>
        : payments.length === 0 ? <p className="text-sm text-muted-foreground">{t("orderView.payments.empty")}</p>
        : <ul className="flex flex-col gap-3">{payments.map((row, index) => <DraftRow key={row.paymentId} row={row} index={index} totals={estimate} busy={busy}
            invalid={invalidPaymentIds.includes(row.paymentId)} autoFocus={row.paymentId === lastAdded}
            onChange={next => onChange(payments.map(item => item.paymentId === row.paymentId ? next : item))}
            onRemove={() => { removed.current = true; onChange(payments.filter(item => item.paymentId !== row.paymentId)); }} />)}</ul>}
      {canAdd && <ActionButtons choices={paymentChoices} blockedNote={null} disabled={busy} onPick={add} />}
    </CardContent>
  </Card>;
}

// ---------------------------------------------------------------------------------------------------------------------
// Saved order: payments are recorded at once

type OpenDialog = Readonly<{ kind: PaymentDialogKind; paymentId: string; choice?: PaymentChoice }>;

function SavedPanel({ order, receiptUrls, manualPaymentId, voidResult, unsavedChanges, hasProducts, busy = false, format }: Common & SavedProps) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const idle = navigation.state === "idle" && !busy;
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const [saved, setSaved] = useState<"orders.paymentSaved" | ReturnType<typeof paymentRecordedKey> | null>(null);
  // A void answer belongs to the moment it arrived: opening a dialog dismisses it so it never sits next to a later result.
  const [dismissedVoid, setDismissedVoid] = useState<unknown>(null);
  const visibleVoid = voidResult !== dismissedVoid ? voidResult : undefined;
  const pendingFocus = useRef<string | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const decided = useRef(false);
  const [uncertain, setUncertain] = useState<{ paymentId: string; order: Order } | null>(null);
  // The order seen when the decision was sent: a lost answer blocks its row only until the panel shows a newer order.
  const submitted = useRef<{ paymentId: string; order: Order } | null>(null);
  const approveNoteId = useId();
  const blockedNote = unsavedChanges ? t("orderView.status.saveFirst") : null;
  const history = [...order.payments].sort((a, b) => paymentDate(b).localeCompare(paymentDate(a)));
  const totals = { total: order.total, paid: order.paidAmount, balance: order.balanceDue, excess: order.overpaidAmount };
  const reviewPending = !order.cancelled && order.payments.some(payment => payment.status === "reported");
  const canAdd = !order.cancelled && hasProducts && order.balanceDue.amount > 0;
  const open = (kind: PaymentDialogKind, paymentId: string, element: HTMLElement, choice?: PaymentChoice) => {
    opener.current = element; decided.current = false; setSaved(null); setDismissedVoid(voidResult); setDialog({ kind, paymentId, choice });
  };
  // The decided row may only exist after the order reloads, so the focus waits for the next render that finds it.
  useEffect(() => {
    if (!pendingFocus.current) return;
    const row = document.getElementById(paymentRowId(pendingFocus.current));
    if (!row) return;
    row.focus(); pendingFocus.current = null;
  }, [dialog, order.payments]);
  const dialogPayment = dialog ? order.payments.find(payment => payment.id === dialog.paymentId) ?? null : null;
  const rowBlocked = (paymentId: string) => !idle || (uncertain !== null && uncertain.paymentId === paymentId && uncertain.order === order);
  return <Card id="order-payments" role="region" aria-labelledby="order-payments-title" tabIndex={-1} className="min-w-0 outline-none">
    <CardHeader><CardTitle id="order-payments-title">{t("orderView.payments.title")}</CardTitle></CardHeader>
    <CardContent className="flex flex-col gap-4">
      {!order.cancelled && <Summary totals={totals} reviewPending={reviewPending} format={format} />}
      {visibleVoid?.error && <Alert variant="destructive"><AlertDescription>{t(paymentErrorKey(visibleVoid.error))}</AlertDescription></Alert>}
      {((saved && !visibleVoid?.error) || visibleVoid?.success) && <Alert variant="success"><AlertDescription role="status">{t(visibleVoid?.success ? "orders.paymentSaved" : saved ?? "orders.paymentSaved")}</AlertDescription></Alert>}
      {history.length === 0 ? <p className="text-sm text-muted-foreground">{t(hasProducts ? "orderView.payments.empty" : "orderView.payments.needProducts")}</p>
        : <ul className="flex flex-col gap-3">{history.map(payment => {
          const when = format.date(paymentDate(payment));
          const actions = rowActions(payment, order);
          const receipt = receiptUrls[payment.id];
          const blocked = rowBlocked(payment.id);
          const name = (action: RowAction) => t(`orders.paymentActions.${action}`, { date: when });
          const method = payment.method ? methodLabel(t, { method: payment.method, walletProvider: payment.walletProvider ?? undefined }) : null;
          const title = payment.status === "reported" ? t("orders.paymentReported")
            : payment.status === "rejected" ? t("orders.paymentRowRejected", { date: when }) : `${format.amount(payment.amount)} · ${method}`;
          const detail = payment.status === "reported" ? t("orders.reportedByBuyer", { date: when })
            : payment.status === "confirmed" ? t("orders.paymentRowConfirmed", { date: when })
            : payment.status === "voided" ? t("orders.paymentRowVoided", { date: when }) : null;
          return <li key={payment.id} id={paymentRowId(payment.id)} tabIndex={-1} className="flex flex-wrap items-center gap-3 rounded-lg border p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {receipt && <RowThumbnail url={receipt} label={name("thumbnail")} onOpen={element => open("receipt", payment.id, element)} />}
            <div className="flex min-w-0 flex-1 basis-40 flex-col gap-1 text-sm">
              <p className="flex flex-wrap items-center gap-2 font-medium">{title}
                <span className="rounded-full border px-2 py-0.5 text-xs font-medium">{t(`orderView.payments.${payment.status}`)}</span></p>
              {detail && <p className="text-muted-foreground">{detail}</p>}
              {payment.status === "rejected" && payment.data.reason && <p className="break-words text-muted-foreground">{t("orderView.payments.rejectedReason", { reason: payment.data.reason })}</p>}
              {receipt && <button type="button" aria-label={name("viewReceipt")} onClick={event => open("receipt", payment.id, event.currentTarget)}
                className="inline-flex min-h-control w-fit items-center text-link underline underline-offset-4 max-md:min-h-touch">{t("orderView.payments.viewReceipt")}</button>}
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {actions.reject && <Button type="button" variant="outline" className="min-h-touch text-destructive md:min-h-control" aria-label={name("reject")} disabled={blocked}
                onClick={event => open("reject", payment.id, event.currentTarget)}>{t("orderView.payments.reject")}</Button>}
              {actions.approve && <Button type="button" className="min-h-touch md:min-h-control" aria-label={name("approve")} disabled={blocked}
                aria-disabled={blockedNote ? true : undefined} aria-describedby={blockedNote ? approveNoteId : undefined}
                onClick={event => { if (!blockedNote) open("approve", payment.id, event.currentTarget); }}>{t("orderView.payments.approve")}</Button>}
              {actions.void && <Form method="post"><input type="hidden" name="operation" value="void" /><input type="hidden" name="paymentId" value={payment.id} />
                <Button type="submit" variant="outline" className="min-h-touch md:min-h-control" aria-label={name("void")} disabled={!idle}>{t("orderView.payments.void")}</Button></Form>}
            </div>
          </li>;
        })}</ul>}
      {blockedNote && history.some(payment => rowActions(payment, order).approve) && <p id={approveNoteId} className="sr-only">{blockedNote}</p>}
      {canAdd && <ActionButtons choices={paymentChoices} blockedNote={blockedNote} disabled={!idle}
        onPick={(choice, element) => open("register", manualPaymentId, element, choice)} />}
    </CardContent>
    {dialog && <PaymentDialog key={`${dialog.kind}-${dialog.paymentId}`} kind={dialog.kind} paymentId={dialog.paymentId} payment={dialogPayment} order={order}
      receiptUrl={receiptUrls[dialog.paymentId] ?? null} format={format} initialChoice={dialog.choice} approveBlockedNote={blockedNote ?? undefined}
      onClose={() => setDialog(null)} onSubmitted={paymentId => { submitted.current = { paymentId, order }; }}
      onUncertain={paymentId => setUncertain(submitted.current?.paymentId === paymentId ? submitted.current : null)}
      onDone={(paymentId, result) => { decided.current = true; pendingFocus.current = paymentId; setDialog(null); setSaved(result.recorded && result.order ? paymentRecordedKey(result.order) : "orders.paymentSaved"); }}
      onCloseAutoFocus={event => { event.preventDefault(); if (!decided.current) opener.current?.focus(); }} />}
  </Card>;
}
