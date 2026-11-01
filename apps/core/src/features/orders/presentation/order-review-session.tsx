import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { OrderReviewResponse } from "@shared/contracts/order-review";
import type { OrderAggregateResponse } from "@shared/contracts/orders";
import { Button } from "@core/app/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@core/app/components/ui/card";
import type { OrderLinkReview } from "@core/app/components/order-link-card";
import { MessageChangesBlock, UndoConfirmDialog, type MessageRow, type UndoProgress } from "@core/src/features/orders/presentation/message-changes-block";
import { OrderReviewDialog, type ReviewDialogResult, type ReviewOrigin } from "@core/src/features/orders/presentation/order-review-dialog";
import { defaultRetryDelaysMs, untilAnswered, webOrderReviewApi, type OrderReviewApi } from "@core/src/features/orders/presentation/order-review-client";
import { countsText, meanwhileText, reasonText, rowTime, type ReviewMoney } from "@core/src/features/orders/presentation/order-review-texts";
import { ReviewPoints } from "@core/src/features/orders/presentation/review-points";

/** What the route gives the view for the seller's review of a chat order. */
export type ReviewViewProps = Readonly<{
  review: OrderReviewResponse;
  /** The page reads the order again: after a review was confirmed or a message undone. */
  onChanged: () => void;
  api?: OrderReviewApi;
  retryDelaysMs?: readonly number[];
  now?: () => Date;
}>;

type Opened = Readonly<{ origin: ReviewOrigin; opener: string }>;
type Focus = Readonly<{ id: string; nonce: number }>;
export const reviewButtonId = "order-review-open";
export const linkIconId = { copy: "order-link-copy", open: "order-link-open" } as const;

export type ReviewSession = Readonly<{
  /** The reasons of the doubtful changes still on the order, by item id: the marks of the products. */
  marks: ReadonlyMap<string, readonly string[]>;
  linkReview: OrderLinkReview | null;
  /** Under **Productos**: «Por resolver» and **Revisar pedido**. */
  panel: ReactNode;
  /** «Cambios por mensajes». */
  changes: ReactNode;
  /** The dialogs, rendered once at the end of the view. */
  dialogs: ReactNode;
}>;

/**
 * The seller's review on the web order view: the dialog, the marks, the points, the message rows with Deshacer and the state of the link card.
 * It lives above the link card and the panels because the copy and open icons open the dialog.
 */
export function useOrderReviewSession(given: ReviewViewProps | undefined, savedOrder: OrderAggregateResponse | null, blocks: Readonly<{ unsavedItems: boolean; unsavedAny: boolean }>, money: ReviewMoney): ReviewSession {
  const { t, i18n } = useTranslation();
  // A new sale has no order and no review: nothing below runs without both.
  const props = savedOrder ? given : undefined;
  const order = savedOrder as OrderAggregateResponse;
  const currency = savedOrder?.total.currency ?? "PEN";
  const [shown, setShown] = useState<OrderReviewResponse | undefined>(props?.review);
  const [seen, setSeen] = useState(props?.review);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [revealed, setRevealed] = useState<OrderReviewResponse | null>(null);
  const [statusLine, setStatusLine] = useState<string | null>(null);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [more, setMore] = useState<"idle" | "loading" | "failed">("idle");
  const [undoing, setUndoing] = useState<Readonly<{ row: MessageRow; progress: UndoProgress }> | null>(null);
  const [undoDone, setUndoDone] = useState(false);
  const nonce = useRef(0);
  const delays = props?.retryDelaysMs ?? defaultRetryDelaysMs;
  const api = props?.api ?? webOrderReviewApi;

  // The route reads the order again after a confirmation or an undo: its review replaces the one shown.
  if (props?.review !== seen) { setSeen(props?.review); setShown(props?.review); }
  useEffect(() => {
    if (!focus) return;
    const timer = setTimeout(() => document.getElementById(focus.id)?.focus(), 0);
    return () => clearTimeout(timer);
  }, [focus]);
  const focusOn = (id: string) => { nonce.current += 1; setFocus({ id, nonce: nonce.current }); };

  const review = shown;
  const entry = review?.status.entry ?? "none";
  const active = review !== undefined && entry !== "none";
  const gated = review !== undefined && entry === "link" && review.status.toReview && revealed !== review;
  const counts = review ? countsText(review.status, t) : null;
  const time = (at: string) => rowTime(at, props?.now?.() ?? new Date(), i18n.language === "pt" ? "pt-BR" : "es-PE");

  const marks = useMemo(() => {
    const byItem = new Map<string, string[]>();
    if (!review || !active) return byItem;
    for (const { change } of review.doubtful) {
      if (change.after === null || change.decision.kind !== "doubtful") continue;
      byItem.set(change.after.itemId, [...(byItem.get(change.after.itemId) ?? []), reasonText(change.decision.reason, t, money, currency)]);
    }
    return byItem;
  }, [review, active, t, money, currency]);

  function open(next: Opened) { setStatusLine(null); setUndoDone(false); setOpened(next); }

  function closed(result: ReviewDialogResult) {
    const current = opened;
    setOpened(null);
    if (!current) return;
    if (result.kind === "confirmed") {
      setRevealed(review ?? null);
      const total = money(result.total.amount, result.total.currency);
      setStatusLine(result.changedMeanwhile.length > 0 ? meanwhileText(result.changedMeanwhile, total, t) : null);
      props?.onChanged();
    }
    focusOn(current.opener);
  }

  async function undo(row: MessageRow) {
    setUndoing({ row, progress: "working" });
    if (typeof navigator !== "undefined" && navigator.onLine === false) { setUndoing({ row, progress: "failed" }); return; }
    const result = await untilAnswered(() => api.undo(order.id, row.messageId), delays, () => setUndoing({ row, progress: "in_doubt" }));
    if (result.success) { setShown(result.data.review); setUndoing(null); setUndoDone(true); props?.onChanged(); return; }
    if (result.error.code === "refused") { setUndoing(null); props?.onChanged(); return; }
    setUndoing({ row, progress: "failed" });
  }

  async function loadMore() {
    setMore("loading");
    const loaded = await api.load(order.id);
    if (loaded.success) { setShown(loaded.data.review); setMore("idle"); } else setMore("failed");
  }

  const linkReview: OrderLinkReview | null = review === undefined ? null : {
    gated, counts, blocked: gated && blocks.unsavedItems, statusLine,
    onRequest: (action) => open({ origin: "link", opener: linkIconId[action] }),
    onTaken: (action) => { if (order.source === "whatsapp") void api.recordLinkAction(order.id, { id: crypto.randomUUID(), action }); },
  };

  const showReviewButton = active && entry === "detail" && review.status.toReview;
  const panel = review && active && (review.points.length > 0 || showReviewButton) ? <>
    {review.points.length > 0 && <Card aria-labelledby="review-points-title">
      <CardHeader><CardTitle id="review-points-title">{t("orderReview.sections.points")}</CardTitle></CardHeader>
      <CardContent><ReviewPoints points={review.points} money={money} currency={currency} /></CardContent>
    </Card>}
    {showReviewButton && <Card><CardContent className="flex flex-wrap items-center justify-between gap-3 pt-4">
      {counts && <p className="text-sm">{counts}</p>}
      <Button id={reviewButtonId} type="button" variant="outline" className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50" aria-disabled={blocks.unsavedAny || undefined}
        aria-describedby={blocks.unsavedAny ? "order-review-blocked" : undefined} onClick={() => { if (!blocks.unsavedAny) open({ origin: "detail", opener: reviewButtonId }); }}>{t("orderReview.card.review")}</Button>
      <span id="order-review-blocked" className="sr-only">{blocks.unsavedAny ? t("orderReview.card.blocked") : ""}</span>
    </CardContent></Card>}
  </> : null;

  const changes = review && (review.messageRows.length > 0 || undoDone) ? <>
    <MessageChangesBlock rows={review.messageRows} moreRows={review.moreRows} moreLoading={more === "loading"} moreFailed={more === "failed"} blocked={blocks.unsavedAny}
      time={time} onUndo={(row) => { setUndoDone(false); setUndoing({ row, progress: "idle" }); }} onMore={() => void loadMore()} />
    <p role="status" aria-live="polite" className="text-sm text-muted-foreground empty:hidden">{undoDone ? t("orderReview.changes.done") : ""}</p>
  </> : null;

  const dialogs = <>
    {opened && review && <OrderReviewDialog key={opened.opener} origin={opened.origin} orderId={order.id} orderNumber={order.number} initial={{ review, order }} api={api} money={money}
      retryDelaysMs={delays} onClose={closed} onOrderChanged={() => props?.onChanged()} />}
    {undoing && <UndoConfirmDialog changes={undoing.row.changes} progress={undoing.progress} onApply={() => void undo(undoing.row)} onKeep={() => setUndoing(null)} />}
  </>;

  return { marks, linkReview, panel, changes, dialogs };
}
