import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Minus, Plus, Trash2 } from "lucide-react";
import type { ConfirmOrderReviewResponse, OrderReviewResponse } from "@shared/contracts/order-review";
import type { OrderAggregateResponse } from "@shared/contracts/orders";
import { Button } from "@core/app/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@core/app/components/ui/dialog";
import { cn } from "@core/app/lib/utils";
import { DoubtMark } from "@core/src/features/orders/presentation/doubt-mark";
import { UndoConfirmDialog, refusalText, type MessageRow, type UndoProgress } from "@core/src/features/orders/presentation/message-changes-block";
import { untilAnswered, type LoadedReview, type OrderReviewApi } from "@core/src/features/orders/presentation/order-review-client";
import {
  hasCorrections, invalidItems, isRemoved, itemsLeft, keepItem, parseQuantity, quantityTextOf, reconcile, removeItem, toRequest, typeQuantity,
  type Corrections,
} from "@core/src/features/orders/presentation/order-review-corrections";
import { lineLabel, lineName, lineVariant, messageSummary, reasonText, type ReviewChange, type ReviewMoney } from "@core/src/features/orders/presentation/order-review-texts";
import { ReviewPoints } from "@core/src/features/orders/presentation/review-points";

export type ReviewOrigin = "link" | "detail";
/** What the dialog tells the page when it closes: the confirmation with what arrived meanwhile, or nothing was recorded. */
export type ReviewDialogResult =
  | Readonly<{ kind: "confirmed"; changedMeanwhile: ConfirmOrderReviewResponse["changedMeanwhile"]; total: ConfirmOrderReviewResponse["total"] }>
  | Readonly<{ kind: "closed" }>;

type Item = OrderAggregateResponse["items"][number];
type Alert = Readonly<{ text: string; focus: boolean }>;
type Marked = Readonly<{ itemId: string; item: Item | null; changes: readonly ReviewChange[]; quote: string | null; messageIds: readonly string[] }>;

const itemIdOf = (change: ReviewChange) => (change.after ?? change.before)?.itemId ?? change.id;

function groupMarks(review: OrderReviewResponse, items: readonly Item[]): readonly Marked[] {
  const groups = new Map<string, { changes: ReviewChange[]; quote: string | null }>();
  for (const { change, quote } of review.doubtful) {
    const group = groups.get(itemIdOf(change)) ?? { changes: [], quote: null };
    group.changes.push(change);
    group.quote ??= quote;
    groups.set(itemIdOf(change), group);
  }
  return [...groups].map(([itemId, group]) => ({ itemId, item: group.changes.some((change) => change.after === null) ? null : items.find((item) => item.id === itemId) ?? null,
    changes: group.changes, quote: group.quote, messageIds: [...new Set(group.changes.map((change) => change.messageId))] }));
}

const lockKeyOf = (order: OrderAggregateResponse) => order.cancelled ? "orderView.failure.cancelled" : order.deliveryStatus === "delivered" ? "orderView.products.lockedDelivered"
  : order.deliveryStatus === "shipped" ? "orderView.products.lockedShipped" : null;

type Props = Readonly<{
  origin: ReviewOrigin; orderId: string; orderNumber: number;
  /** The review and the order as the page loaded them: shown at once while the dialog reads them again. */
  initial: LoadedReview;
  api: OrderReviewApi; money: ReviewMoney; /** The clock time of a message, as the rows show it. */ time: (at: string) => string; retryDelaysMs: readonly number[];
  onClose: (result: ReviewDialogResult) => void;
  /** An undo changed the saved order: the page reads it again. */
  onOrderChanged: () => void;
}>;

/** «Revisa el pedido #N»: the doubtful changes with their controls, the points to resolve, the products and the total. Confirming saves the corrections and records the review. */
export function OrderReviewDialog({ origin, orderId, orderNumber, initial, api, money, time, retryDelaysMs, onClose, onOrderChanged }: Props) {
  const { t } = useTranslation();
  const [data, setData] = useState<LoadedReview>(initial);
  const [load, setLoad] = useState<"loading" | "ready" | "failed">("loading");
  const [corrections, setCorrections] = useState<Corrections>({});
  const [affected, setAffected] = useState<readonly string[]>([]);
  const [alert, setAlert] = useState<Alert | null>(null);
  const [phase, setPhase] = useState<"idle" | "saving" | "in_doubt">("idle");
  const [leaving, setLeaving] = useState(false);
  const [undoing, setUndoing] = useState<Readonly<{ row: MessageRow; progress: UndoProgress }> | null>(null);
  const [undoDone, setUndoDone] = useState(false);
  const reviewId = useRef(crypto.randomUUID());
  const titleRef = useRef<HTMLHeadingElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const correctionsRef = useRef(corrections);
  const dataRef = useRef(data);
  useEffect(() => { correctionsRef.current = corrections; dataRef.current = data; });

  const { review, order } = data;
  const currency = order.total.currency;
  const marks = useMemo(() => groupMarks(review, order.items), [review, order.items]);
  const markedIds = new Set(marks.flatMap((mark) => mark.item ? [mark.itemId] : []));
  const products = order.items.filter((item) => !markedIds.has(item.id));
  const lockKey = lockKeyOf(order);
  const editable = lockKey === null;
  const corrected = hasCorrections(corrections);
  const busy = phase !== "idle";
  const changedSince = new Map(review.products.map((product) => [product.itemId, product.changedSinceLastReview]));
  const rowOf = (messageId: string) => review.messageRows.find((row) => row.messageId === messageId);

  // The review reads again as it opens, so what it shows is what core holds now. The corrections stay on the items nothing touched.
  async function refresh(touched: readonly string[] = []) {
    setLoad("loading");
    const loaded = await api.load(orderId);
    if (!loaded.success) { setLoad("failed"); return; }
    const previous = dataRef.current.order.items;
    setCorrections(reconcile(correctionsRef.current, previous, loaded.data.order.items, touched));
    setData(loaded.data);
    setLoad("ready");
  }
  useEffect(() => { void refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (alert?.focus) alertRef.current?.focus(); }, [alert]);

  const closeRequest = () => { if (corrected) setLeaving(true); else onClose({ kind: "closed" }); };

  async function confirm() {
    const request = toRequest(corrections);
    if (!request) { document.querySelector<HTMLElement>(`[data-quantity-item="${invalidItems(corrections)[0]}"]`)?.focus(); return; }
    setAlert(null);
    setPhase("saving");
    if (typeof navigator !== "undefined" && navigator.onLine === false) { setAlert({ text: t("orderReview.saveFailed"), focus: false }); setPhase("idle"); return; }
    const result = await untilAnswered(() => api.confirm(orderId, { version: 1, id: reviewId.current, origin, linkAction: null, loaded: review.loaded, corrections: [...request] }), retryDelaysMs, () => setPhase("in_doubt"));
    setPhase("idle");
    if (result.success) { onClose({ kind: "confirmed", changedMeanwhile: result.data.changedMeanwhile, total: result.data.total }); return; }
    const error = result.error;
    if (error.code !== "refused") { setAlert({ text: t("orderReview.saveFailed"), focus: false }); return; }
    // A definite refusal ends this attempt: the next one is a new review.
    reviewId.current = crypto.randomUUID();
    const refusal = error.error;
    switch (refusal.code) {
      case "REVIEW_OUTDATED": setAffected(refusal.affectedItemIds); setAlert({ text: t("orderReview.outdated"), focus: true }); void refresh(refusal.affectedItemIds); return;
      case "ORDER_CHANGED": setAffected([]); setAlert({ text: t("orderReview.orderChanged"), focus: true }); void refresh(); return;
      case "DELIVERY_LOCKED": setAlert({ text: t(order.deliveryStatus === "delivered" ? "orderView.products.lockedDelivered" : "orderView.products.lockedShipped"), focus: false }); return;
      case "ORDER_CANCELLED": setAlert({ text: t("orderView.failure.cancelled"), focus: false }); return;
      case "LAST_ITEM": setAlert({ text: t("orderReview.lastItem"), focus: false }); return;
      case "VARIANT_NOT_FOUND": setAlert({ text: t("orderReview.variantGone"), focus: false }); return;
      default: setAlert({ text: t("orderReview.saveFailed"), focus: false });
    }
  }

  async function undo(row: MessageRow) {
    setUndoing({ row, progress: "working" });
    if (typeof navigator !== "undefined" && navigator.onLine === false) { setUndoing({ row, progress: "failed" }); return; }
    const result = await untilAnswered(() => api.undo(orderId, row.messageId), retryDelaysMs, () => setUndoing({ row, progress: "in_doubt" }));
    if (result.success) {
      setData(result.data); setUndoing(null); setUndoDone(true); setAlert(null); setAffected([]);
      reviewId.current = crypto.randomUUID();
      onOrderChanged();
      return;
    }
    if (result.error.code === "refused") { setUndoing(null); void refresh(); return; }
    setUndoing({ row, progress: "failed" });
  }

  const estimate = order.items.reduce((sum, item) => {
    const correction = corrections[item.id];
    if (!correction) return sum;
    const quantity = correction.kind === "remove" ? 0 : parseQuantity(correction.text);
    return quantity === null ? sum : sum + (quantity - item.quantity) * item.unitPrice.amount;
  }, order.total.amount);

  const allCorrected = marks.some((mark) => mark.item) && marks.every((mark) => !mark.item || corrections[mark.itemId] !== undefined);
  const undoButton = (mark: Marked) => mark.messageIds.map((messageId) => {
    const row = rowOf(messageId);
    if (!row || row.undo.kind === "undone") return null;
    if (row.undo.kind === "refused") return <p key={messageId} className="text-sm text-muted-foreground">{refusalText(row, t)}</p>;
    // Undo reverts the reader's changes while the order is open for messages and its items can still change.
    if (!editable || !review.status.openForMessages) return null;
    return <Button key={messageId} type="button" variant="outline" size="sm" className="w-fit min-h-control max-md:min-h-touch aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
      aria-label={t("orderReview.changes.undoRow", { time: time(row.at), summary: messageSummary(row.changes, t) })} aria-disabled={corrected || busy || undefined} aria-describedby={corrected ? "review-undo-blocked" : undefined}
      onClick={() => { if (!corrected && !busy) { setUndoDone(false); setUndoing({ row, progress: "idle" }); } }}>{t("orderReview.undoMessage")}</Button>;
  });

  const markedRow = (mark: Marked): ReactNode => {
    const { item } = mark;
    const reasons = mark.changes.flatMap((change) => change.decision.kind === "doubtful" ? [reasonText(change.decision.reason, t, money, currency)] : []);
    if (!item) {
      const line = mark.changes.find((change) => change.before)?.before;
      return <li key={mark.itemId} className="grid gap-2 py-3">
        <p className="font-medium">{line ? t("orderReview.removedByMessage", { line: lineLabel(line, t) }) : reasons[0]}</p>
        {mark.quote && <p className="text-sm italic text-muted-foreground">{t("orderReview.quote", { quote: `“${mark.quote}”` })}</p>}
        {undoButton(mark)}
      </li>;
    }
    const name = lineName({ productName: item.productName, variantAttributes: item.variantAttributes });
    const text = quantityTextOf(corrections, item);
    const invalid = parseQuantity(text) === null;
    const removed = isRemoved(corrections, item.id);
    const lastItem = itemsLeft(order.items, corrections) <= 1 && !removed;
    const quantity = parseQuantity(text);
    const set = (value: string) => setCorrections(typeQuantity(corrections, item, value.replace(/\D/g, "").slice(0, 7)));
    return <li key={mark.itemId} className="grid gap-2 py-3" data-item={item.id}>
      <div className="min-w-0">
        <p className="font-medium">{item.productName}</p>
        <p className="text-sm text-muted-foreground">{t("orderReview.lineDetail", { variant: lineVariant({ variantAttributes: item.variantAttributes }) || t("orderView.products.uniqueVariant"),
          price: money(item.unitPrice.amount, currency), subtotal: money(item.subtotal.amount, currency) })}</p>
      </div>
      <DoubtMark reasons={reasons} quote={mark.quote} />
      {affected.includes(item.id) && <p className="text-sm font-medium">{t("orderReview.changedMeanwhile")}</p>}
      {editable && !removed && <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button type="button" variant="outline" size="icon" aria-label={t("orderReview.decrease", { name })} disabled={busy || quantity === null || quantity <= 1} onClick={() => set(String((quantity ?? 1) - 1))}><Minus aria-hidden="true" /></Button>
          <input type="text" inputMode="numeric" autoComplete="off" data-quantity-item={item.id} aria-label={t("orderReview.quantity", { name })} aria-invalid={invalid || undefined}
            aria-describedby={invalid ? `review-quantity-${item.id}` : undefined} disabled={busy} value={text} onChange={(event) => set(event.target.value)}
            onBlur={() => { if (text.trim() === "") set(String(item.quantity)); }}
            className="h-control min-h-touch w-16 rounded-[var(--radius-control)] border bg-background px-2 text-center tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-destructive disabled:opacity-50" />
          <Button type="button" variant="outline" size="icon" aria-label={t("orderReview.increase", { name })} disabled={busy || (quantity !== null && quantity >= 9999)} onClick={() => set(String((quantity ?? 0) + 1))}><Plus aria-hidden="true" /></Button>
        </div>
        <Button type="button" variant="ghost" size="sm" className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50" aria-label={t("orderReview.remove", { name })} disabled={busy}
          aria-disabled={lastItem || undefined} aria-describedby={lastItem ? "review-last-item" : undefined} onClick={() => { if (!lastItem) setCorrections(removeItem(corrections, item.id)); }}><Trash2 data-icon="inline-start" aria-hidden="true" />{t("orderReview.remove", { name: "" }).trim()}</Button>
        {undoButton(mark)}
      </div>}
      {invalid && <p id={`review-quantity-${item.id}`} role="alert" className="text-sm text-destructive">{t("orderReview.quantityInvalid")}</p>}
      {editable && removed && <div className="flex flex-wrap items-center gap-2"><p className="text-sm">{t("orderReview.willRemove")}</p>
        <Button type="button" variant="outline" size="sm" aria-label={t("orderReview.keep", { name })} disabled={busy} onClick={() => setCorrections(keepItem(corrections, item.id))}>{t("orderReview.keep", { name: "" }).trim()}</Button></div>}
      {!editable && <div className="flex flex-wrap items-center gap-2">{undoButton(mark)}</div>}
    </li>;
  };

  const section = (id: string, title: string, children: ReactNode) => <section aria-labelledby={id} className="grid gap-2"><h3 id={id} className="text-base font-semibold">{title}</h3>{children}</section>;
  const lastItemNote = itemsLeft(order.items, corrections) <= 1 && editable && marks.some((mark) => mark.item);

  return <>
    <Dialog open onOpenChange={(open) => { if (!open) closeRequest(); }}>
      <DialogContent aria-describedby="review-subtitle" className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 p-0 max-sm:h-dvh max-sm:max-h-dvh max-sm:max-w-none max-sm:rounded-none sm:max-w-2xl"
        onOpenAutoFocus={(event) => { event.preventDefault(); titleRef.current?.focus(); }} onCloseAutoFocus={(event) => event.preventDefault()}>
        <DialogHeader className="border-b p-4 sm:p-6">
          <DialogTitle ref={titleRef} tabIndex={-1} className="text-lg font-semibold outline-none">{t("orderReview.title", { number: orderNumber })}</DialogTitle>
          <DialogDescription id="review-subtitle" className={cn(origin !== "link" && "sr-only")}>{origin === "link" ? t("orderReview.subtitle") : t("orderReview.title", { number: orderNumber })}</DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 content-start gap-5 overflow-y-auto p-4 sm:p-6" data-testid="review-content">
          <div role="status" aria-live="polite" className="text-sm text-muted-foreground empty:hidden">{load === "loading" ? t("orderReview.loading") : undoDone ? t("orderReview.changes.done") : ""}</div>
          {load === "failed" && <div className="flex flex-wrap items-center gap-3"><p role="alert" className="text-sm text-destructive">{t("orderReview.loadError")}</p>
            <Button type="button" variant="outline" onClick={() => void refresh()}>{t("orderReview.retry")}</Button></div>}
          {alert && <div ref={alertRef} role="alert" tabIndex={-1} className="rounded-md border border-destructive/40 p-3 text-sm text-destructive outline-none">{alert.text}</div>}
          {phase === "in_doubt" && <p role="status" className="text-sm">{t("orderReview.inDoubt")}</p>}
          {lockKey && <p role="note" className="text-sm text-muted-foreground">{t(lockKey)}</p>}
          {marks.length > 0 && section("review-doubtful", t("orderReview.sections.doubtful"), <>
            {allCorrected && <p className="text-sm">{t("orderReview.allReviewed")}</p>}
            <ul className="divide-y">{marks.map(markedRow)}</ul>
            {lastItemNote && <p id="review-last-item" className="text-sm text-muted-foreground">{t("orderReview.lastItem")}</p>}
            <span id="review-undo-blocked" className="sr-only">{corrected ? t("orderReview.correctionsBlockUndo") : ""}</span>
            {corrected && <p className="text-sm text-muted-foreground">{t("orderReview.correctionsBlockUndo")}</p>}
          </>)}
          {review.points.length > 0 && section("review-points", t("orderReview.sections.points"), <ReviewPoints points={review.points} money={money} currency={currency} />)}
          {section("review-products", t("orderReview.sections.products"), <>
            <ul className="divide-y">{products.map((item) => <li key={item.id} className="grid gap-0.5 py-2">
              <p className="font-medium">{item.productName} <span className="font-normal text-muted-foreground">×{item.quantity}</span></p>
              <p className="text-sm text-muted-foreground">{t("orderReview.lineDetail", { variant: lineVariant({ variantAttributes: item.variantAttributes }) || t("orderView.products.uniqueVariant"),
                price: money(item.unitPrice.amount, currency), subtotal: money(item.subtotal.amount, currency) })}</p>
              {review.status.hasPreviousReview && changedSince.get(item.id) && <p className="text-sm font-medium">{t("orderReview.changedSince")}</p>}
            </li>)}
            {review.removedSinceLastReview.map((line) => <li key={line.itemId} className="py-2 text-sm text-muted-foreground">{t("orderReview.removedSince", { line: lineLabel(line, t) })}</li>)}</ul>
          </>)}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t p-4 sm:p-6">
          <p className="font-semibold tabular-nums">{t("orderReview.total")}: {money(estimate, currency)}</p>
          <div className="flex flex-wrap items-center gap-2">
            {corrected && <Button type="button" variant="outline" disabled={busy} onClick={() => { setCorrections({}); setAlert(null); }}>{t("orderReview.discardCorrections")}</Button>}
            <Button type="button" variant="outline" onClick={closeRequest}>{t("orderReview.close")}</Button>
            <Button type="button" disabled={busy || load === "loading"} aria-busy={phase === "saving" || undefined} onClick={() => void confirm()}>{t(phase === "idle" ? "orderReview.confirm" : "orderReview.confirming")}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
    <Dialog open={leaving} onOpenChange={(open) => { if (!open) setLeaving(false); }}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader><DialogTitle>{t("orderReview.leaveTitle")}</DialogTitle></DialogHeader>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setLeaving(false)}>{t("orderReview.leaveKeep")}</Button>
          <Button type="button" onClick={() => { setLeaving(false); onClose({ kind: "closed" }); }}>{t("orderReview.leaveConfirm")}</Button>
        </div>
      </DialogContent>
    </Dialog>
    {undoing && <UndoConfirmDialog changes={undoing.row.changes} progress={undoing.progress} onApply={() => void undo(undoing.row)} onKeep={() => setUndoing(null)} />}
  </>;
}
