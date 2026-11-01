import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, findNodeHandle, Modal, Platform, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SymbolView } from "expo-symbols";
import * as Crypto from "expo-crypto";
import { useTranslation } from "react-i18next";
import type { OrderAggregateResponse } from "@shared/contracts/orders";
import type { ConfirmOrderReviewResponse, OrderReviewResponse } from "@shared/contracts/order-review";
import { maxOrderLineQuantity } from "@shared/orders-edit";
import { ThemedText } from "@mobile/components/themed-text";
import { ThemedView } from "@mobile/components/themed-view";
import { Button } from "@mobile/components/ui/button";
import { showConfirmation } from "@mobile/components/ui/show-confirmation";
import { isLostAnswer } from "@mobile/features/orders/application/in-doubt";
import { DoubtBadge } from "@mobile/features/orders/presentation/doubt-badge";
import { confirmReview, type UndoOutcome } from "@mobile/features/orders/presentation/order-review-actions";
import { doubtsByItem, lineLabel, lowerFirst, reasonText, undoConfirmationLines, undoRefusalText } from "@mobile/features/orders/presentation/order-review-model";
import { typedQuantity } from "@mobile/features/orders/presentation/order-items-editor";
import { ReviewPoints } from "@mobile/features/orders/presentation/review-points";
import { correctionsToSend, hasCorrections, isRemoved, keepCorrections, quantityTextOf, remainingCount, type CorrectionDraft } from "@mobile/features/orders/presentation/review-corrections";
import { QuantityStepper } from "@mobile/features/products/presentation/quantity-stepper";
import { useTheme } from "@mobile/hooks/use-theme";

type Order = OrderAggregateResponse;
type Review = OrderReviewResponse;
type Money = Order["total"];
export type FreshOrderReview = Readonly<{ order: Order; review: Review }>;

type Props = Readonly<{
  origin: "link" | "detail";
  order: Order;
  review: Review;
  format: (value: Money) => string;
  onClose: () => void;
  onConfirmed: (result: ConfirmOrderReviewResponse) => void;
  /** Reloads the order and its review, or answers null when that failed. */
  onReload: () => Promise<FreshOrderReview | null>;
  onUndo: (messageId: string, onInDoubt: () => void) => Promise<UndoOutcome>;
}>;

type Notice = Readonly<{ text: string; tone: "alert" | "polite" }>;

/** Moves the screen reader's focus to a view, where the platform can. */
function focusOn(view: View | null) {
  const handle = view ? findNodeHandle(view) : null;
  if (handle !== null) try { AccessibilityInfo.setAccessibilityFocus(handle); } catch { /* Nothing to focus on this platform. */ }
}

const priceOf = (unit: Money, quantity: number): Money => ({ ...unit, amount: Math.round(unit.amount * quantity * 100) / 100 });

/** The review of an order: marked changes first, the points to resolve, the other products and the total. Confirming saves the corrections of marked items and records the review. */
export function OrderReviewModal({ origin, order, review, format, onClose, onConfirmed, onReload, onUndo }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [draft, setDraft] = useState<CorrectionDraft>({});
  const [busy, setBusy] = useState<"saving" | "undoing" | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const title = useRef<View>(null);
  const alertBox = useRef<View>(null);
  // The client id of the confirmation: kept while its answer is unknown, new when the corrections change.
  const reviewId = useRef<string | null>(null);
  useEffect(() => { focusOn(title.current); }, []);
  useEffect(() => { if (notice?.tone === "alert") focusOn(alertBox.current); }, [notice]);

  const readOnly = order.cancelled || order.deliveryStatus !== "pending";
  const lockText = readOnly ? t(order.cancelled ? "itemsEdit.saveCancelled" : order.deliveryStatus === "shipped" ? "itemsEdit.lockedShipped" : "itemsEdit.lockedDelivered") : null;
  const marks = doubtsByItem(review);
  const controlled = (item: Order["items"][number]) => !readOnly && marks.has(item.id);
  const corrected = hasCorrections(draft, order.items);
  const corrections = correctionsToSend(draft, order.items);
  const remaining = remainingCount(draft, order.items);
  const money = (amount: number) => format({ amount, currency: order.total.currency });
  const reasonContext = { t, money };
  const shownTotal = order.items.reduce((sum, item) => isRemoved(draft, item) ? sum : sum + priceOf(item.unitPrice, typedQuantity(quantityTextOf(draft, item)) ?? item.quantity).amount, order.deliveryCharge.amount);
  const edit = (itemId: string, change: { quantity?: string; removed?: boolean }, item: Order["items"][number]) => {
    reviewId.current = null;
    setDraft((current) => ({ ...current, [itemId]: { quantity: change.quantity ?? quantityTextOf(current, item), removed: change.removed ?? isRemoved(current, item) } }));
  };
  const allMarksCorrected = review.doubtful.length > 0 && review.doubtful.every(({ change }) => change.after && order.items.some((item) => item.id === change.after?.itemId && (isRemoved(draft, item) || quantityTextOf(draft, item) !== String(item.quantity))));

  async function reloadKeeping(affected: ReadonlySet<string>, message: string) {
    const fresh = await onReload();
    reviewId.current = null;
    if (!fresh) { setNotice({ text: t("orderReview.loadError"), tone: "alert" }); return; }
    setTouched(affected);
    setDraft((current) => keepCorrections(current, order, fresh.order, fresh.review, affected));
    setNotice({ text: message, tone: "alert" });
  }

  async function confirm() {
    if (busy || corrections === null) return;
    setBusy("saving"); setNotice(null);
    reviewId.current ??= Crypto.randomUUID();
    const result = await confirmReview(order.id, { id: reviewId.current, origin, linkAction: null, loaded: review.loaded, corrections }, () => setNotice({ text: t("orderReview.inDoubt"), tone: "polite" }));
    if (result.success) { setBusy(null); onConfirmed(result.data); return; }
    const { code } = result.error;
    if (code === "REVIEW_OUTDATED") await reloadKeeping(new Set(result.error.affectedItemIds ?? []), t("orderReview.messageArrived"));
    else if (code === "ORDER_CHANGED") await reloadKeeping(new Set(), t("orderReview.anotherSeller"));
    else if (code === "DELIVERY_LOCKED" || code === "ORDER_CANCELLED") {
      const fresh = await onReload();
      reviewId.current = null; setDraft({});
      setNotice({ text: t(!fresh || fresh.order.cancelled ? "itemsEdit.saveCancelled" : fresh.order.deliveryStatus === "shipped" ? "itemsEdit.saveShipped" : "itemsEdit.saveDelivered"), tone: "alert" });
    }
    else if (code === "LAST_ITEM") setNotice({ text: t("itemsEdit.lastItem"), tone: "alert" });
    else if (code === "VARIANT_NOT_FOUND") setNotice({ text: t("itemsEdit.deactivated"), tone: "alert" });
    else if (isLostAnswer(code) || code === "SERVICE_UNAVAILABLE" || code === "RATE_LIMITED") setNotice({ text: t("orderReview.notSent"), tone: "alert" });
    else setNotice({ text: t("orderReview.refused"), tone: "alert" });
    setBusy(null);
  }

  function askUndo(row: Review["messageRows"][number]) {
    if (busy || corrected) return;
    const messageId = row.messageId;
    showConfirmation({ title: t("orderReview.undoTitle"), description: undoConfirmationLines(row.changes, t, row.pendings).join("\n"), confirmLabel: t("orderReview.undoConfirm"), cancelLabel: t("orderReview.undoKeep"), destructive: true, onConfirm: () => void undo(messageId) });
  }
  async function undo(messageId: string) {
    setBusy("undoing"); setNotice(null);
    const outcome = await onUndo(messageId, () => setNotice({ text: t("orderReview.undoInDoubt"), tone: "polite" }));
    if (outcome.kind === "done") { setNotice({ text: t("orderReview.undoDone"), tone: "polite" }); AccessibilityInfo.announceForAccessibility(t("orderReview.undoDone")); }
    else if (outcome.kind === "refused") setNotice({ text: undoRefusalText(outcome.reason, review.messageRows.find((row) => row.messageId === messageId)?.changes ?? [], t), tone: "alert" });
    else setNotice({ text: t("orderReview.undoFailed"), tone: "alert" });
    setBusy(null);
  }

  const requestClose = () => {
    if (busy === "saving") return;
    if (corrected) showConfirmation({ title: t("orderReview.leaveTitle"), confirmLabel: t("orderReview.leaveDiscard"), cancelLabel: t("orderReview.leaveKeep"), destructive: true, onConfirm: onClose });
    else onClose();
  };

  const undoBlock = corrected ? t("orderReview.undoBlockedByCorrections") : null;
  /** Undo reverts the whole message, so it is offered only with the message's row loaded: its changes, its reason or its pendings are not known otherwise. */
  const undoControl = (messageId: string) => {
    const row = review.messageRows.find((candidate) => candidate.messageId === messageId);
    if (readOnly || order.status === "cancelled" || !row) return null;
    if (row.undo.kind === "refused") return <ThemedText type="small" themeColor="textSecondary">{undoRefusalText(row.undo.reason, row.changes, t)}</ThemedText>;
    if (row.undo.kind === "undone") return <ThemedText type="small" themeColor="textSecondary">{t("orderReview.undone")}</ThemedText>;
    return <>
      <Button variant="secondary" disabled={busy !== null || corrected} accessibilityHint={undoBlock ?? undefined} onPress={() => askUndo(row)}>{t("orderReview.undoMessage")}</Button>
      {undoBlock ? <ThemedText type="small" themeColor="textSecondary">{undoBlock}</ThemedText> : null}
    </>;
  };

  const otherItems = order.items.filter((item) => !marks.has(item.id));
  const changedIds = new Set(review.products.filter((product) => product.changedSinceLastReview).map((product) => product.itemId));
  const seenItems = new Set<string>();
  const cardStyle = { backgroundColor: theme.backgroundElement, borderColor: theme.border };

  return <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={requestClose}>
    <ThemedView style={styles.page} testID="order-review-modal"><SafeAreaView style={styles.page} edges={["top", "left", "right", "bottom"]}>
      <View style={styles.header}>
        <View ref={title} accessible style={styles.flex}>
          <ThemedText type="subtitle" accessibilityRole="header">{t("orderReview.title", { number: order.number })}</ThemedText>
          {origin === "link" ? <ThemedText type="small" themeColor="textSecondary">{t("orderReview.subtitle")}</ThemedText> : null}
        </View>
        <Button variant="ghost" disabled={busy === "saving"} onPress={requestClose}>{t("orderReview.close")}</Button>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        {lockText ? <ThemedText type="small" themeColor="textSecondary">{lockText}</ThemedText> : null}
        {notice ? <View ref={alertBox} accessible={notice.tone === "alert"}><ThemedText accessibilityRole={notice.tone === "alert" ? "alert" : undefined} accessibilityLiveRegion="polite" style={notice.tone === "alert" ? { color: theme.error } : undefined}>{notice.text}</ThemedText></View> : null}
        {review.doubtful.length > 0 ? <View style={styles.section}>
          <ThemedText type="subtitle" accessibilityRole="header">{t("orderReview.sectionDoubts")}</ThemedText>
          {allMarksCorrected ? <ThemedText type="small" themeColor="textSecondary">{t("orderReview.allReviewed")}</ThemedText> : null}
          {review.doubtful.map(({ change, quote }) => {
            const item = change.after ? order.items.find((candidate) => candidate.id === change.after?.itemId) : undefined;
            const reason = change.decision.kind === "doubtful" ? lowerFirst(reasonText(change.decision.reason, reasonContext)) : "";
            const firstOfItem = item ? !seenItems.has(item.id) : true;
            if (item) seenItems.add(item.id);
            if (!item || !change.after) {
              const gone = change.before ?? change.after;
              return <View key={change.id} style={[styles.card, cardStyle]}>
                <ThemedText style={styles.strong}>{t("orderReview.removedByMessage", { line: gone ? lineLabel(gone, t) : "" })}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">{reason}</ThemedText>
                {quote ? <ThemedText type="small" themeColor="textSecondary">{t("orderReview.quote", { quote })}</ThemedText> : null}
                {undoControl(change.messageId)}
              </View>;
            }
            const text = quantityTextOf(draft, item);
            const quantity = typedQuantity(text);
            const removed = isRemoved(draft, item);
            return <View key={change.id} style={[styles.card, cardStyle]}>
              <View accessible accessibilityLabel={t("orderReview.doubtOf", { item: lineLabel(change.after, t, item.quantity), reason }) + (quote ? `. ${t("orderReview.quote", { quote })}` : "")} style={styles.section}>
                <DoubtBadge />
                <ThemedText style={styles.strong}>{lineLabel(change.after, t, item.quantity)} · {format(item.subtotal)}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">{reason}</ThemedText>
                {quote ? <ThemedText type="small" themeColor="textSecondary">{t("orderReview.quote", { quote })}</ThemedText> : null}
                {touched.has(item.id) ? <ThemedText type="small" style={{ color: theme.warning }}>{t("orderReview.changedWhileReviewing")}</ThemedText> : null}
              </View>
              {controlled(item) && firstOfItem ? <>
                {removed ? <ThemedText type="small" themeColor="textSecondary">{t("orderReview.willRemove")}</ThemedText> : <>
                  <QuantityStepper value={text} min={1} max={maxOrderLineQuantity} disabled={busy !== null}
                    onChange={(next) => edit(item.id, { quantity: next }, item)} accessibilityLabel={t("itemsEdit.quantity", { name: item.productName })}
                    decreaseLabel={t("itemsEdit.decrease", { name: item.productName })} increaseLabel={t("itemsEdit.increase", { name: item.productName })} />
                  {quantity === null ? <ThemedText type="small" style={{ color: theme.error }} accessibilityRole="alert">{t("itemsEdit.quantityInvalid")}</ThemedText> : null}
                  <Button variant="ghost" accessibilityLabel={t("itemsEdit.removeLabel", { name: item.productName })} accessibilityHint={remaining === 1 ? t("itemsEdit.lastItem") : undefined}
                    disabled={busy !== null || remaining === 1} onPress={() => edit(item.id, { removed: true }, item)}>{t("itemsEdit.remove")}</Button>
                  {remaining === 1 ? <ThemedText type="small" themeColor="textSecondary">{t("itemsEdit.lastItem")}</ThemedText> : null}
                </>}
              </> : null}
              {undoControl(change.messageId)}
            </View>;
          })}
        </View> : null}
        <ReviewPoints points={review.points} money={money} />
        {otherItems.length > 0 || review.removedSinceLastReview.length > 0 ? <View style={styles.section}>
          <ThemedText type="subtitle" accessibilityRole="header">{t("orderReview.sectionProducts")}</ThemedText>
          {otherItems.map((item) => <View key={item.id} accessible style={[styles.card, cardStyle]}>
            <View style={styles.productRow}>
              <View style={styles.flex}>
                <ThemedText style={styles.strong}>{item.productName}</ThemedText>
                {Object.values(item.variantAttributes).length ? <ThemedText type="small" themeColor="textSecondary">{Object.values(item.variantAttributes).join(" · ")}</ThemedText> : null}
                <ThemedText type="small" themeColor="textSecondary">{item.quantity} × {format(item.unitPrice)}</ThemedText>
              </View>
              <ThemedText style={styles.strong}>{format(item.subtotal)}</ThemedText>
            </View>
            {changedIds.has(item.id) ? <View style={styles.inline}><SymbolView name={{ ios: "clock.arrow.circlepath", android: "history" }} size={16} tintColor={theme.textSecondary} />
              <ThemedText type="small" themeColor="textSecondary">{t("orderReview.changedSince")}</ThemedText></View> : null}
          </View>)}
          {review.removedSinceLastReview.map((line) => <ThemedText key={line.itemId} type="small" themeColor="textSecondary">{t("orderReview.removedSince", { line: lineLabel(line, t) })}</ThemedText>)}
        </View> : null}
      </ScrollView>
      <View style={[styles.bar, cardStyle]}>
        <View style={styles.totalRow}>
          <ThemedText style={styles.strong}>{t("orderReview.total")}</ThemedText>
          <ThemedText style={styles.strong}>{money(shownTotal)}</ThemedText>
        </View>
        {corrected ? <Button variant="secondary" disabled={busy !== null} onPress={() => { reviewId.current = null; setDraft({}); setNotice(null); setTouched(new Set()); }}>{t("orderReview.discardCorrections")}</Button> : null}
        <Button loading={busy === "saving"} disabled={busy !== null || corrections === null} onPress={() => void confirm()}>{t("orderReview.confirm")}</Button>
      </View>
    </SafeAreaView></ThemedView>
  </Modal>;
}

const styles = StyleSheet.create({
  page: { flex: 1 }, flex: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16 },
  content: { gap: 16, padding: 16, paddingTop: 4, paddingBottom: 32, maxWidth: 640, width: "100%", alignSelf: "center" },
  section: { gap: 10 },
  card: { gap: 8, padding: 12, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth },
  strong: { fontWeight: "600" },
  productRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  inline: { flexDirection: "row", alignItems: "center", gap: 6 },
  bar: { gap: 8, padding: 16, borderTopWidth: StyleSheet.hairlineWidth, paddingBottom: Platform.OS === "ios" ? 24 : 16 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
});
