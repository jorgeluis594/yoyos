/** @jsxImportSource react */
// THESIS: understand the sale, then act on delivery beside its data; approved order-detail A.
// OWN-WORLD: Caramelo sobrio, Inter, flat token surfaces, discreet borders and native symbols.
// STORY: inspect products and payments, consult and fulfill delivery, disclose technical details.
// FIRST VIEWPORT: compact header, buyer, receipt notice, products then payment; actions stay contextual.
// FORM: user-approved round2-a-resumen-conectado.png; grouped summary and compact contextual rows.
// FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
import { showConfirmation } from "@mobile/components/ui/show-confirmation";
import { choiceOfPayment, defaultPaymentChoice, paymentFromChoice, type PaymentMethodAndProvider } from "@shared/wallet-providers";
import type { CancellationRequestError, CancellationRecoveryError } from "@mobile/features/orders/application/cancel-order";
import { orderFulfillmentBlock } from "@shared/orders-fulfillment";
import { mentionedPriceNote } from "@shared/mentioned-price";
import { PaymentFields, type PaymentFieldsValue } from "@mobile/features/orders/presentation/payment-fields";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, View } from "react-native";
import { SymbolView } from "expo-symbols";
import * as Crypto from "expo-crypto";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { useTranslation } from "react-i18next";
import { subtract } from "@shared/money";
import { ok } from "@shared/functional";
import { offersPartialStockDeduction } from "@shared/orders-payment";
import type { OrderAggregateResponse } from "@shared/contracts/orders";
import type { ConfirmOrderReviewResponse, OrderReviewResponse } from "@shared/contracts/order-review";
import { orders } from "@mobile/features/orders/composition";
import { confirmPaymentFailure } from "@mobile/features/orders/application/order-operations";
import { ThemedText } from "@mobile/components/themed-text";
import { ThemedView } from "@mobile/components/themed-view";
import { Button } from "@mobile/components/ui/button";
import { Field, FieldLabel } from "@mobile/components/ui/field";
import { Input } from "@mobile/components/ui/input";
import { ScreenState } from "@mobile/components/ui/screen-state";
import { useNotices } from "@mobile/features/notifications/composition";
import { useAccess } from "@mobile/features/users/presentation/access-provider";
import { useOrderResult } from "@mobile/features/orders/presentation/order-result";
import { documentTypeLabel, orderLanguage, orderStatusLabel } from "@mobile/features/orders/presentation/order-labels";
import { PaymentBadge, PaymentRegisterSheet, PaymentRow, PaymentSummary, paymentBadgeStatus, paymentMethodLabel } from "@mobile/features/orders/presentation/order-payment-parts";
import { DeliveryBadge, DeliveryRow, deliveryRowSymbols, useShippingSummary } from "@mobile/features/orders/presentation/order-delivery-parts";
import { useDispatchPrint } from "@mobile/features/orders/presentation/dispatch-print-review";
import { OrderDayField } from "@mobile/features/orders/presentation/order-day-field";
import { useCopyLink } from "@mobile/features/catalog/presentation/use-copy-link";
import { OrderBuyerName } from "@mobile/features/orders/presentation/order-buyer";
import { OrderItemsEditor, draftLines, isDraftDirty, reconcileLostSave, startItemsDraft, type ItemsDraft, type ItemsLine } from "@mobile/features/orders/presentation/order-items-editor";
import { isWaitingDue, joinLabels, shortStockLines } from "@mobile/features/orders/presentation/order-stock";
import { DoubtBadge } from "@mobile/features/orders/presentation/doubt-badge";
import { MessageChangesBlock } from "@mobile/features/orders/presentation/message-changes-block";
import { OrderReviewModal } from "@mobile/features/orders/presentation/order-review-modal";
import { recordLinkAction, undoMessage, type LinkActionKind, type UndoOutcome } from "@mobile/features/orders/presentation/order-review-actions";
import { countsText, doubtsByItem, lowerFirst, meanwhileText, reasonText, undoConfirmationLines, undoRefusalText } from "@mobile/features/orders/presentation/order-review-model";
import { ReviewPoints } from "@mobile/features/orders/presentation/review-points";
import { useTheme } from "@mobile/hooks/use-theme";
import translations from "@mobile/i18n";
import { normalizeDecimalInput } from "@mobile/shared/decimal-input";

const money = (amount: number, currency: string, locale: string) => new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
const date = (value: string, locale: string) => new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short", timeZone: "America/Lima" }).format(new Date(value));

/** Notices that arrive in a burst refresh the open order once, this long after the first. */
const noticeReloadWindowMs = 2000;

export type CancellationUiState =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "submitting" | "verifying"; orderId: string }>
  | Readonly<{ kind: "failed"; error: CancellationRequestError }>
  | Readonly<{ kind: "uncertain"; orderId: string; cause: CancellationRecoveryError }>;

type CheckoutLinkState =
  | Readonly<{ kind: "loading" }>
  | Readonly<{ kind: "ready"; url: string }>
  | Readonly<{ kind: "subdomain_required" }>
  | Readonly<{ kind: "error" }>;

/** Both need one confirmed payment and both deduct stock, but the reason names the operation. */
const fulfillmentKey = (operation: "ship" | "deliver" | null, code: string) => operation === "ship" && code === "PAYMENT_REQUIRED" ? "SHIP_PAYMENT_REQUIRED"
  : operation === "deliver" && code === "INSUFFICIENT_STOCK" ? "DELIVER_INSUFFICIENT_STOCK" : code;

/** What the item edit tells the seller: the bar shows the failures while editing, the products card shows how an edit ended. */
type ItemsNotice = "saved" | "savedWaiting" | "saveShipped" | "saveDelivered" | "saveCancelled" | "conflict" | "offline" | "notFound" | "failed" | "doubt" | "checkFailed" | "deactivated";
/** Answers that may have been lost after the request left: the order is read to know whether the edit went through. */
const lostAnswerCodes = new Set<string>(["NETWORK_ERROR", "SERVER_ERROR", "INTERNAL_ERROR", "INVALID_RESPONSE"]);

export default function OrderDetailScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const theme = useTheme();
  const { t, i18n } = useTranslation();
  const shippingSummary = useShippingSummary();
  const locale = i18n.language === 'pt-BR' ? 'pt-BR' : 'es-PE';
  const { id, noticeAt } = useLocalSearchParams<{ id: string; noticeAt?: string }>();
  const { state } = useAccess();
  const { notice, clear } = useOrderResult();
  const [order, setOrder] = useState<OrderAggregateResponse | null>(null);
  const [orderReview, setOrderReview] = useState<OrderReviewResponse | null>(null);
  // The review modal, with the link action that opened it (null from the detail).
  const [reviewFlow, setReviewFlow] = useState<Readonly<{ origin: "link" | "detail"; action: LinkActionKind | null }> | null>(null);
  // «Mientras revisabas…» stays in the link card until the seller leaves the screen.
  const [meanwhile, setMeanwhile] = useState<string | null>(null);
  const [undoNotice, setUndoNotice] = useState<Readonly<{ text: string; tone: "alert" | "polite" }> | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [loadingRows, setLoadingRows] = useState(false);
  const allRows = useRef(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [linkResult, setLinkResult] = useState<Readonly<{ orderId: string; link: Exclude<CheckoutLinkState, { kind: "loading" }> }> | null>(null);
  const [linkRefresh, setLinkRefresh] = useState(0);
  const linkRequest = useRef(0);
  const checkoutGeneration = useRef(0);
  const [paymentError, setPaymentError] = useState("");
  // What the last recorded payment left behind; it stays until the seller starts another payment, delivery or fulfillment action.
  const [paymentLine, setPaymentLine] = useState<"recorded" | "waiting" | null>(null);
  const [savingPayment, setSavingPayment] = useState<string | null>(null);
  const [fulfilling, setFulfilling] = useState<"ship" | "deliver" | null>(null);
  const [rescheduling, setRescheduling] = useState(false);
  const [fulfillmentMessage, setFulfillmentMessage] = useState("");
  const [fulfillmentError, setFulfillmentError] = useState("");
  const manualPaymentId = useRef<string | null>(null);
  const loaded = useRef(false);
  const scroll = useRef<ScrollView>(null);
  const paymentPosition = useRef(0);
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [internalOpen, setInternalOpen] = useState(false);
  const [editor, setEditor] = useState<"manual" | { paymentId: string; receiptImageId: string } | null>(null);
  const [rejection, setRejection] = useState<{ reason: string } | null>(null);
  const companyId = state.status === "ready" ? state.company.id : "";
  const [cancellation, setCancellation] = useState<CancellationUiState>({ kind: "idle" });
  const [detailRefreshFailed, setDetailRefreshFailed] = useState(false);
  const cancellationLock = useRef(false);
  const [itemsDraft, setItemsDraft] = useState<ItemsDraft | null>(null);
  const [itemsNotice, setItemsNotice] = useState<ItemsNotice | null>(null);
  const [savingItems, setSavingItems] = useState(false);
  const sentLines = useRef<ItemsLine[]>([]);
  const itemsDirty = itemsDraft !== null && isDraftDirty(itemsDraft);
  const scope = `${state.status === "ready" ? state.user.id : ""}:${companyId}:${id}`;
  const currentScope = useRef(scope);
  useLayoutEffect(() => { currentScope.current = scope; }, [scope]);
  const cancellationBusy = cancellation.kind === "submitting" || cancellation.kind === "verifying";
  const cancellationBlocked = cancellationBusy || cancellation.kind === "uncertain" || detailRefreshFailed;
  // A result belongs to the order it was read for, so another order never shows this one's link while its own loads.
  const checkoutLink: CheckoutLinkState = linkResult && linkResult.orderId === order?.id ? linkResult.link : { kind: "loading" };
  const { copied, copy: copyLink, open: openLink } = useCopyLink(checkoutLink.kind === "ready" ? checkoutLink.url : null);
  const writeBusy = cancellationBlocked || !!savingPayment || !!fulfilling || rescheduling || savingItems;
  /** The order and its review are one read: either failing fails it. */
  const loadBoth = useCallback(async (orderId: string) => {
    const [aggregate, review] = await Promise.all([orders.loadOrderAggregate(orderId), orders.loadOrderReview(orderId, allRows.current ? { allRows: true } : undefined)]);
    if (!aggregate.success) return aggregate;
    return review.success ? ok({ order: aggregate.data, review: review.data }) : review;
  }, []);
  const reload = useCallback(async (silent = false) => {
    const generation = checkoutGeneration.current;
    const requestScope = scope;
    if (!silent) setLoading(true);
    const fresh = await loadBoth(id);
    if (generation !== checkoutGeneration.current || requestScope !== currentScope.current) return;
    // A refresh the seller did not ask for keeps what is on screen when it fails.
    if (fresh.success) { setOrder(fresh.data.order); setOrderReview(fresh.data.review); setError(""); loaded.current = true; }
    else if (!silent) setError(fresh.error.code === "ORDER_NOT_FOUND" ? translations.t('orderNotFound') : translations.t('loadOrderError'));
    setLoading(false);
  }, [id, scope, loadBoth]);
  const confirmDiscardItems = (onConfirm: () => void) => showConfirmation({ title: t("itemsEdit.discardTitle"), confirmLabel: t("itemsEdit.discard"), cancelLabel: t("itemsEdit.keepEditing"), destructive: true, onConfirm });
  const leaveAllowed = useRef(false);
  // Swipe-back, the header button and the hardware back all ask before dropping unsaved product edits.
  usePreventRemove(itemsDirty, ({ data }) => {
    if (leaveAllowed.current) { navigation.dispatch(data.action); return; }
    confirmDiscardItems(() => { leaveAllowed.current = true; navigation.dispatch(data.action); });
  });
  // The status line belongs to the screen: it clears when the seller really leaves it, not when the order reloads.
  useFocusEffect(useCallback(() => () => { setPaymentLine(null); setMeanwhile(null); }, []));
  // A notice tapped while this very order is open navigates to the same route; its `noticeAt` is the only change.
  const handledNoticeAt = useRef(noticeAt);
  useFocusEffect(useCallback(() => {
    if (noticeAt === handledNoticeAt.current) return;
    handledNoticeAt.current = noticeAt;
    if (companyId) void reload(true);
  }, [noticeAt, companyId, reload]));
  const noticeWatch = useNotices()?.watchArrivals;
  const writing = useRef(false);
  useLayoutEffect(() => { writing.current = writeBusy; });
  // Any notice that arrives while the order is open may have changed it: refresh it, coalescing a burst.
  useFocusEffect(useCallback(() => {
    if (!noticeWatch || !companyId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      // A write in flight owns the screen; look again after it settles.
      if (writing.current || cancellationLock.current) { timer = setTimeout(refresh, noticeReloadWindowMs); return; }
      timer = null;
      void reload(true);
    };
    const stop = noticeWatch(() => { if (timer === null) timer = setTimeout(refresh, noticeReloadWindowMs); });
    return () => { stop(); if (timer !== null) clearTimeout(timer); };
  }, [noticeWatch, companyId, reload]));
  async function confirmPayment(paymentId: string, source: "manual" | "buyer_report", amountText: string,
    method: PaymentMethodAndProvider, deductStockIfPartial: boolean) {
    if (!order || cancellationLock.current || writeBusy || order.cancelled) return;
    const amount = Number(normalizeDecimalInput(amountText));
    if (!Number.isFinite(amount) || amount <= 0 || !/^\d+(?:[.,]\d{1,2})?$/.test(amountText.trim())) {
      setPaymentError(t("invalidPaymentAmount")); return;
    }
    setSavingPayment(paymentId); setPaymentError(""); setPaymentLine(null);
    const result = await orders.registerPayment(order.id, { paymentId, source, amount: { amount, currency: order.total.currency },
      ...method, deductStockIfPartial });
    if (result.success) {
      setOrder(result.data.order); setEditor(null);
      setPaymentLine(isWaitingDue(result.data.order.stockDue) ? "waiting" : "recorded");
      if (source === "manual") manualPaymentId.current = null;
    }
    else {
      const failure = confirmPaymentFailure(result.error.code);
      setPaymentError(failure === "already_reviewed" ? t("paymentAlreadyReviewed")
        : failure === "unknown" ? t("paymentUnknownResult") : t("paymentSaveError"));
      if (failure !== "failed") { const refreshed = await orders.loadOrderAggregate(order.id); if (refreshed.success) setOrder(refreshed.data); }
    }
    setSavingPayment(null);
  }
  async function rejectReport(paymentId: string, reason: string) {
    if (!order || cancellationLock.current || writeBusy || order.cancelled) return;
    const trimmed = reason.trim();
    if (trimmed.length > 200) { setPaymentError(t("rejectReasonTooLong")); return; }
    setSavingPayment(paymentId); setPaymentError(""); setPaymentLine(null);
    const outcome = await orders.rejectPayment(order.id, paymentId, trimmed || null);
    if (outcome.kind === "rejected") { setOrder(outcome.order); setEditor(null); setRejection(null); }
    else {
      setPaymentError(t(outcome.kind === "already_reviewed" ? "paymentAlreadyReviewed" : outcome.kind === "order_cancelled" ? "rejectCancelled"
        : outcome.kind === "unknown" ? "paymentUnknownResult" : "paymentSaveError"));
      if (outcome.kind !== "failed") { const refreshed = await orders.loadOrderAggregate(order.id); if (refreshed.success) setOrder(refreshed.data); }
    }
    setSavingPayment(null);
  }
  async function voidPayment(paymentId: string) {
    if (!order || cancellationLock.current || writeBusy || order.cancelled) return;
    setSavingPayment(paymentId); setPaymentError(""); setPaymentLine(null);
    const result = await orders.voidPayment(order.id, paymentId);
    if (result.success) setOrder(result.data);
    else setPaymentError(t("paymentSaveError"));
    setSavingPayment(null);
  }
  const endItemsEdit = (notice: ItemsNotice | null) => { setItemsDraft(null); setItemsNotice(notice); };
  /** A lost answer: reading the order tells whether the edit went through, nothing changed or somebody else changed the items. */
  async function verifyLostSave(orderId: string, base: string, lines: readonly ItemsLine[]) {
    setItemsNotice("doubt");
    const fresh = await orders.loadOrderAggregate(orderId);
    if (!fresh.success) { setItemsNotice("checkFailed"); return; }
    setOrder(fresh.data);
    const outcome = reconcileLostSave(lines, base, fresh.data);
    if (outcome === "saved") endItemsEdit(isWaitingDue(fresh.data.stockDue) ? "savedWaiting" : "saved");
    else setItemsNotice(outcome === "unchanged" ? "offline" : "conflict");
  }
  async function itemsRefused(code: string, orderId: string, base: string, lines: readonly ItemsLine[]) {
    if (code === "ORDER_CHANGED") { setItemsNotice("conflict"); return; }
    if (code === "VARIANT_NOT_FOUND") { setItemsNotice("deactivated"); return; }
    if (code === "DELIVERY_LOCKED" || code === "ORDER_CANCELLED") {
      const fresh = await orders.loadOrderAggregate(orderId);
      if (!fresh.success) { setItemsNotice("checkFailed"); return; }
      setOrder(fresh.data);
      endItemsEdit(fresh.data.cancelled ? "saveCancelled" : fresh.data.deliveryStatus === "shipped" ? "saveShipped" : "saveDelivered");
      return;
    }
    if (lostAnswerCodes.has(code)) await verifyLostSave(orderId, base, lines);
    else setItemsNotice(code === "SERVICE_UNAVAILABLE" ? "offline" : code === "ORDER_NOT_FOUND" ? "notFound" : "failed");
  }
  async function saveItems() {
    if (!order || !itemsDraft || savingItems || cancellationLock.current) return;
    const lines = draftLines(itemsDraft);
    if (!lines || !isDraftDirty(itemsDraft)) return;
    sentLines.current = lines;
    setSavingItems(true); setItemsNotice(null);
    const result = await orders.editOrderItems(order.id, { base: itemsDraft.base, lines });
    if (result.success) { setOrder(result.data.order); endItemsEdit(isWaitingDue(result.data.order.stockDue) ? "savedWaiting" : "saved"); }
    else await itemsRefused(result.error.code, order.id, itemsDraft.base, lines);
    setSavingItems(false);
  }
  async function reloadAfterConflict() {
    if (!order) return;
    const fresh = await orders.loadOrderAggregate(order.id);
    if (fresh.success) { setOrder(fresh.data); endItemsEdit(null); } else setItemsNotice("checkFailed");
  }
  async function fulfill(operation: "ship" | "deliver") {
    if (!order || cancellationLock.current || writeBusy || orderFulfillmentBlock(order, operation)) return;
    setFulfilling(operation); setFulfillmentError(""); setFulfillmentMessage(""); setPaymentLine(null);
    try {
      const result = await orders[operation](order.id);
      if (result.success) { setOrder(result.data); setFulfillmentMessage(t(`orderFulfillment.${operation}Saved`)); }
      else {
        setFulfillmentError(t(`orderFulfillment.${fulfillmentKey(operation, result.error.code)}`, { defaultValue: t("orderFulfillment.saveError") }));
        // The stock changed after the screen loaded: show the order as it is now.
        if (result.error.code === "INSUFFICIENT_STOCK") await reload(true);
      }
    } catch { setFulfillmentError(t("orderFulfillment.saveError")); }
    finally { setFulfilling(null); }
  }
  async function reschedule(day: string) {
    if (!order || cancellationLock.current || writeBusy) return;
    setRescheduling(true); setFulfillmentError(""); setFulfillmentMessage(""); setPaymentLine(null);
    try {
      const result = await orders.updateOrderShipping(order.id, { scheduledDispatchDate: day || null });
      if (result.success) setOrder(result.data);
      else setFulfillmentError(t("scheduledSaveError"));
    } catch { setFulfillmentError(t("scheduledSaveError")); }
    finally { setRescheduling(false); }
  }
  async function viewReceipt(imageId: string) {
    const result = await orders.receiptUrl(imageId);
    if (!result.success) { setPaymentError(t("receiptUnavailable")); return; }
    try { await Linking.openURL(result.data); }
    catch { setPaymentError(t("receiptUnavailable")); }
  }
  useFocusEffect(useCallback(() => {
    checkoutGeneration.current += 1;
    cancellationLock.current = false; setCancellation({ kind: "idle" }); setDetailRefreshFailed(false);
    setLinkRefresh(count => count + 1);
    if (companyId) void reload();
    return () => {
      checkoutGeneration.current += 1;
      if (notice?.id === id && loaded.current) clear();
    };
  }, [companyId, id, notice, clear, reload]));

  // The link is a read of the order's current brand-host URL, so it loads with the screen and again on every return (a subdomain may have been chosen meanwhile).
  const linkOrderId = order?.id;
  const linkCancelled = order?.cancelled ?? false;
  // The live region is Android-only, so VoiceOver gets the same text announced once when the line appears.
  useEffect(() => { if (paymentLine) AccessibilityInfo.announceForAccessibility(translations.t(paymentLine === "waiting" ? "paymentRecordedWaiting" : "paymentRecorded")); }, [paymentLine]);
  useEffect(() => { if (copied) AccessibilityInfo.announceForAccessibility(translations.t("checkoutCopied")); }, [copied]);
  useEffect(() => {
    if (!linkOrderId || linkCancelled) return;
    const request = ++linkRequest.current;
    void (async () => {
      try {
        const result = await orders.enableOrderCheckout(linkOrderId);
        if (request !== linkRequest.current) return;
        setLinkResult({ orderId: linkOrderId, link: result.success ? { kind: "ready", url: result.data.url }
          : result.error.code === "SUBDOMAIN_REQUIRED" ? { kind: "subdomain_required" } : { kind: "error" } });
      } catch { if (request === linkRequest.current) setLinkResult({ orderId: linkOrderId, link: { kind: "error" } }); }
    })();
    return () => { linkRequest.current += 1; };
  }, [linkOrderId, linkCancelled, linkRefresh]);
  async function runCancellation(verify: boolean) {
    if (!order || cancellationBusy || cancellationLock.current || savingPayment || fulfilling) return;
    if (!verify && (cancellationBlocked || order.cancelled || order.status !== "active" || order.deliveryStatus !== "pending")) return;
    const generation = checkoutGeneration.current;
    const requestScope = scope;
    const isCurrent = () => generation === checkoutGeneration.current && requestScope === currentScope.current;
    cancellationLock.current = true;
    setCancellation({ kind: verify ? "verifying" : "submitting", orderId: order.id });
    setDetailRefreshFailed(false);
    setEditor(null);
    let confirmed = false;
    try {
      const result = await orders[verify ? "checkCancellation" : "cancelOrder"](order.id);
      if (!isCurrent()) return;
      if (!result.success) { setCancellation({ kind: "failed", error: result.error }); return; }
      const outcome = result.data;
      if (outcome.kind === "uncertain") { setCancellation(outcome); return; }
      setOrder(previous => previous?.id === outcome.order.id ? { ...previous, ...outcome.order } : previous);
      confirmed = outcome.kind === "cancelled";
      const refreshed = await orders.loadOrderAggregate(order.id);
      if (!isCurrent()) return;
      if (refreshed.success && refreshed.data.id === order.id && (outcome.kind !== "cancelled" ||
        (refreshed.data.cancelled && refreshed.data.status === "cancelled" && refreshed.data.deliveryStatus === "pending" && refreshed.data.deliveredAt === null && refreshed.data.completedAt === null))) {
        setOrder(refreshed.data); setError("");
      } else setDetailRefreshFailed(true);
      setCancellation(outcome.kind === "cancelled" ? { kind: "idle" } : { kind: "failed", error: {
        code: outcome.kind === "dispatched" ? "INVALID_TRANSITION" : "NETWORK_ERROR", message: "Cancellation not confirmed",
      } });
    } catch {
      if (isCurrent() && confirmed) { setDetailRefreshFailed(true); setCancellation({ kind: "idle" }); }
      else if (isCurrent()) setCancellation({ kind: "uncertain", orderId: order.id, cause: { code: "NETWORK_ERROR", message: "Cancellation unavailable" } });
    } finally { if (isCurrent()) cancellationLock.current = false; }
  }
  function confirmCancellation() {
    if (!order || writeBusy || cancellationLock.current) return;
    const requestScope = scope;
    const generation = checkoutGeneration.current;
    showConfirmation({ title: t("orderCancellation.title"), description: t("orderCancellation.description"),
      confirmLabel: t("orderCancellation.cancel"), cancelLabel: t("orderCancellation.keep"), destructive: true,
      onConfirm: () => { if (generation === checkoutGeneration.current && requestScope === currentScope.current) void runCancellation(false); } });
  }
  /** Takes the checkout link and records it, when the action really happened (a dismissed share sheet is not a link taken). */
  async function takeLink(action: LinkActionKind) {
    if (!order || checkoutLink.kind !== "ready") return;
    const url = checkoutLink.url;
    let taken = false;
    if (action === "copy") taken = await copyLink();
    else if (action === "open") taken = await openLink();
    else {
      const shared = await Share.share({ message: url }).catch(() => null);
      taken = shared !== null && shared.action !== Share.dismissedAction;
    }
    if (taken) void recordLinkAction(order.id, action);
  }
  // On an order open for messages with something to review, every link action goes through the review first.
  const needsReview = !!order && !order.cancelled && orderReview?.status.entry === "link" && orderReview.status.toReview;
  function requestLink(action: LinkActionKind) {
    if (itemsDraft || !order) return;
    if (needsReview) setReviewFlow({ origin: "link", action }); else void takeLink(action);
  }
  async function reloadForReview() {
    if (!order) return null;
    const fresh = await loadBoth(order.id);
    if (!fresh.success) return null;
    setOrder(fresh.data.order); setOrderReview(fresh.data.review);
    return fresh.data;
  }
  function reviewConfirmed(result: ConfirmOrderReviewResponse) {
    const flow = reviewFlow;
    setReviewFlow(null);
    setOrder(result.order);
    if (result.changedMeanwhile.length > 0) {
      const text = meanwhileText(result.changedMeanwhile, money(result.total.amount, result.total.currency, locale), t);
      setMeanwhile(text);
      AccessibilityInfo.announceForAccessibility(text);
    }
    void reload(true);
    if (flow?.origin === "link" && flow.action) void takeLink(flow.action);
  }
  async function applyUndo(messageId: string, onInDoubt: () => void): Promise<UndoOutcome> {
    if (!order) return { kind: "failed" };
    const outcome = await undoMessage(order.id, messageId, onInDoubt);
    if (outcome.kind === "done") { setOrder(outcome.order); setOrderReview(outcome.review); }
    else if (outcome.kind === "refused") void reload(true);
    return outcome;
  }
  function askUndo(row: OrderReviewResponse["messageRows"][number]) {
    if (undoing || itemsDraft) return;
    showConfirmation({ title: t("orderReview.undoTitle"), description: undoConfirmationLines(row.changes, t, row.pendings).join("\n"), confirmLabel: t("orderReview.undoConfirm"), cancelLabel: t("orderReview.undoKeep"), destructive: true,
      onConfirm: () => void (async () => {
        setUndoing(true); setUndoNotice(null);
        const outcome = await applyUndo(row.messageId, () => setUndoNotice({ text: t("orderReview.undoInDoubt"), tone: "polite" }));
        if (outcome.kind === "done") { setUndoNotice({ text: t("orderReview.undoDone"), tone: "polite" }); AccessibilityInfo.announceForAccessibility(t("orderReview.undoDone")); }
        else setUndoNotice({ text: outcome.kind === "refused" ? undoRefusalText(outcome.reason, row.changes, t) : t("orderReview.undoFailed"), tone: "alert" });
        setUndoing(false);
      })() });
  }
  async function showAllRows() {
    if (!order) return;
    allRows.current = true; setLoadingRows(true);
    const result = await orders.loadOrderReview(order.id, { allRows: true });
    if (result.success) setOrderReview(result.data);
    setLoadingRows(false);
  }
  if (state.status !== "ready") return null;
  if (loading) return <ScreenState status="loading" title={t('loadingOrder')} />;
  if (!order || error) return <ScreenState status="error" title={t('openOrderError')} description={error} onRetry={() => void reload()} />;

  const original = notice?.id === order.id ? notice.shownTotal : null;
  const difference = original?.currency === order.total.currency ? subtract(original)(order.total) : null;
  const changed = original && (original.currency !== order.total.currency || original.amount !== order.total.amount);
  const language = orderLanguage(state.company.country, i18n.language);
  const title = orderStatusLabel(order.status, language);
  const format = (value: { amount: number; currency: string }) => money(value.amount, value.currency, locale);
  const reports = order.payments.filter((payment) => payment.status === "reported");
  const hasPaid = order.paidAmount.amount > 0;
  // A confirmed payment is an advance when the running total after it (oldest first, in whole cents) still leaves a balance.
  const advanceIds = new Set<string>();
  order.payments.flatMap(payment => payment.status === "confirmed" && payment.amount ? [{ id: payment.id, at: payment.data.confirmedAt, cents: Math.round(payment.amount.amount * 100) }] : [])
    .sort((a, b) => a.at.localeCompare(b.at))
    .reduce((running, payment) => { const next = running + payment.cents; if (next < Math.round(order.total.amount * 100)) advanceIds.add(payment.id); return next; }, 0);
  const canEditItems = order.status === "active" && order.deliveryStatus === "pending" && !order.cancelled;
  const itemsLockedText = order.cancelled || order.deliveryStatus === "pending" ? null : t(order.deliveryStatus === "shipped" ? "itemsEdit.lockedShipped" : "itemsEdit.lockedDelivered");
  const canEditDelivery = order.status === "active" && order.deliveryStatus === "pending" && !order.cancelled;
  const checkoutState = order.cancelled ? t("checkoutCancelled") : order.checkoutConfirmedAt ? t("checkoutConfirmed") : order.status === "active" ? t("checkoutPending") : null;
  const openPayments = () => {
    scroll.current?.scrollTo({ y: paymentPosition.current, animated: false });
  };
  const review = editor && editor !== "manual" ? editor : null;
  const openEditor = (value: NonNullable<typeof editor>) => { if (cancellationLock.current || writeBusy || order.cancelled) return; setPaymentError(""); setPaymentLine(null); setRejection(null); setEditor(value); };
  const closeEditor = () => { if (!savingPayment) { setEditor(null); setRejection(null); setPaymentError(""); } };
  // The one main action is the next valid transition; when it is blocked the button stays disabled and says why.
  const nextOperation = order.deliveryStatus === "pending" ? (order.delivery?.method === "store" ? "deliver" : "ship") : order.deliveryStatus === "shipped" ? "deliver" : null;
  const nextBlock = nextOperation ? orderFulfillmentBlock(order, nextOperation) : null;
  const shortLines = shortStockLines(order);
  const nextReason = nextBlock && ["PAYMENT_REQUIRED", "STOCK_WAITING"].includes(nextBlock.code) ? nextBlock.code : null;
  const nextReasonText = !nextReason || !nextOperation ? null
    : nextReason === "STOCK_WAITING" ? t(`orderFulfillment.STOCK_WAITING_${nextOperation === "ship" ? "SHIP" : "DELIVER"}${shortLines.length ? "" : "_GENERIC"}`, { items: joinLabels(shortLines.map(line => line.label), t("listAnd")) })
    : t(`orderFulfillment.${fulfillmentKey(nextOperation, nextReason)}`);
  const stockLine = isWaitingDue(order.stockDue) ? t("stockWaiting") : order.stockDeducted ? t("stockDeducted") : order.stockDue?.kind === "deducting" ? t("stockDeducting") : t("stockPending");
  const cardStyle = { backgroundColor: theme.backgroundElement, borderColor: theme.border };
  // Cancelled and completed orders, and orders without a chat, show no marks and no review.
  const reviewShown = orderReview !== null && !order.cancelled && orderReview.status.entry !== "none" ? orderReview : null;
  const marks = reviewShown ? doubtsByItem(reviewShown) : new Map<string, never[]>();
  const counts = reviewShown ? countsText(reviewShown.status, t) : null;
  const reasonContext = { t, money: (amount: number) => money(amount, order.total.currency, locale) };
  return <ThemedView style={styles.page}><SafeAreaView style={styles.page} edges={["top", "left", "right"]}>
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('backToOrders')} onPress={() => router.back()}
          style={({ pressed }) => [styles.iconButton, { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}>
          <SymbolView name={{ ios: "chevron.left", android: "arrow_back" }} size={24} tintColor={theme.text} />
        </Pressable>
        <ThemedText accessibilityRole="header" style={styles.title}>{t("orderNumber", { number: order.number })}</ThemedText>
      </View>
      <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <View style={styles.heading}>
          <View style={styles.row}>
            <ThemedText type="small" themeColor="textSecondary" accessibilityLabel={t('createdOn', { date: date(order.createdAt, locale) })}>
              {new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "America/Lima" }).format(new Date(order.createdAt))}
            </ThemedText>
            <StatusBadge label={title} tone={order.status === "cancelled" ? "neutral" : "success"} />
          </View>
          {order.source === "catalog" ? <ThemedText type="small" themeColor="textSecondary">{t('fromCatalog')}</ThemedText> : null}
          <OrderBuyerName buyer={order.buyer} source={order.source} labelled />
          {order.buyer?.name && order.buyer.phone ? <ThemedText type="small" themeColor="textSecondary" selectable>{order.buyer.phone}</ThemedText> : null}
        </View>
        {order.cancelled ? <ThemedText accessibilityRole="alert">{t("orderCancellation.cancelled")}</ThemedText> : null}
        {cancellationBusy ? <ThemedText accessibilityRole="alert">{t(cancellation.kind === "verifying" ? "orderCancellation.verifying" : "orderCancellation.submitting")}</ThemedText> : null}
        {cancellation.kind === "failed" ? <ThemedText accessibilityRole="alert" style={{ color: theme.error }}>{t(`orderCancellation.${cancellation.error.code}`, { defaultValue: t("orderCancellation.failed") })}</ThemedText> : null}
        {cancellation.kind === "uncertain" ? <ThemedText accessibilityRole="alert">{t("orderCancellation.uncertain")}</ThemedText> : null}
        {detailRefreshFailed ? <ThemedText accessibilityRole="alert">{t("orderCancellation.refreshFailed")}</ThemedText> : null}
        {cancellation.kind === "uncertain" || detailRefreshFailed ? <Button disabled={cancellationBusy} loading={cancellation.kind === "verifying"} onPress={() => void runCancellation(true)}>{t("orderCancellation.check")}</Button> : null}
        {reports.length > 0 ? <Pressable accessibilityRole="button" accessibilityLabel={t('detailReports', { count: reports.length })} onPress={openPayments}
          style={({ pressed }) => [styles.receiptNotice, { backgroundColor: pressed ? theme.backgroundSelected : theme.warningSurface, borderColor: theme.border }]}>
          <SymbolView name={{ ios: "doc.text", android: "description" }} size={24} tintColor={theme.warning} />
          <ThemedText style={[styles.flex, { color: theme.warning }]}>{t('detailReports', { count: reports.length })}</ThemedText>
          <SymbolView name={{ ios: "chevron.right", android: "chevron_right" }} size={20} tintColor={theme.warning} />
        </Pressable> : null}
        {!order.cancelled && order.stockDue ? <View style={[styles.stockNotice, { backgroundColor: theme.warningSurface, borderColor: theme.border }]}>
          <SymbolView name={{ ios: "shippingbox", android: "inventory_2" }} size={24} tintColor={theme.warning} />
          <View style={styles.flex}>
            <ThemedText accessibilityRole="header" style={[styles.semibold, { color: theme.warning }]}>{isWaitingDue(order.stockDue) ? t("stockWaitingTitle") : t("stockDeductingTitle")}</ThemedText>
            {isWaitingDue(order.stockDue) ? shortLines.map(line => <ThemedText key={line.variantId} type="small" style={{ color: theme.warning }}>
              {t("stockWaitingLine", { name: line.label, quantity: line.quantity, available: line.available })}</ThemedText>) : null}
            <ThemedText type="small" style={{ color: theme.warning }}>{isWaitingDue(order.stockDue) ? t("stockWaitingHelp") : t("stockDeductingHelp")}</ThemedText>
          </View>
        </View> : null}
        {changed && original ? <View style={[styles.card, styles.section, { backgroundColor: theme.warningSurface, borderColor: theme.border }]}>
          <ThemedText type="subtitle" accessibilityRole="header">{t('reviewCharge')}</ThemedText>
          <ThemedText>{t('shownAtConfirmation', { amount: money(original.amount, original.currency, locale) })}</ThemedText>
          <ThemedText>{t('recordedTotalAmount', { amount: format(order.total) })}</ThemedText>
          {difference?.success ? <ThemedText>{t('amountDifference', { amount: money(difference.data.amount, order.total.currency, locale) })}</ThemedText> : null}
          <ThemedText type="small">{t('adjustCharge')}</ThemedText>
        </View> : null}
        {reviewShown ? <ReviewPoints points={reviewShown.points} money={reasonContext.money} /> : null}
        {reviewShown && reviewShown.status.entry === "detail" && reviewShown.status.toReview ? <View style={[styles.card, styles.section, cardStyle]}>
          {counts ? <ThemedText>{counts}</ThemedText> : null}
          <Button variant="secondary" disabled={!!itemsDraft} accessibilityHint={itemsDraft ? t("itemsEdit.saveFirst") : undefined} onPress={() => { if (!itemsDraft) setReviewFlow({ origin: "detail", action: null }); }}>{t("orderReview.open")}</Button>
        </View> : null}
        <View style={[styles.card, cardStyle]}>
          <View style={styles.productsHeader}>
            <ThemedText type="subtitle" accessibilityRole="header" style={styles.flex}>{t('detailProducts', { count: order.items.reduce((sum, item) => sum + item.quantity, 0) })}</ThemedText>
            {canEditItems && !itemsDraft ? <Button variant="ghost" disabled={writeBusy} onPress={() => { setItemsNotice(null); setItemsDraft(startItemsDraft(order)); }}>{t("itemsEdit.edit")}</Button> : null}
          </View>
          {itemsLockedText ? <ThemedText type="small" themeColor="textSecondary">{itemsLockedText}</ThemedText> : null}
          {!itemsDraft && itemsNotice && ["saved", "savedWaiting", "saveShipped", "saveDelivered", "saveCancelled"].includes(itemsNotice)
            ? <ThemedText accessibilityLiveRegion="polite">{t(`itemsEdit.${itemsNotice}`)}</ThemedText> : null}
          {itemsDraft ? <OrderItemsEditor draft={itemsDraft} onChange={setItemsDraft} disabled={savingItems} format={(amount, currency) => money(amount, currency, locale)} /> : order.items.map((item, index) => {
            const note = mentionedPriceNote(item);
            const noteText = note ? t('mentionedPrice', { count: note.units, amount: money(note.amount, item.unitPrice.currency, locale) }) : null;
            const variant = Object.entries(item.variantAttributes).map(([key, value]) => `${key}: ${value}`).join(" · ");
            const doubt = marks.get(item.id)?.[0]?.change.decision;
            const doubtReason = doubt?.kind === "doubtful" ? lowerFirst(reasonText(doubt.reason, reasonContext)) : null;
            const plainLabel = [[item.productName, variant, item.sku ? `SKU ${item.sku}` : null, t('orderItemDetailLabel', { quantity: item.quantity, unit: format(item.unitPrice), subtotal: format(item.subtotal) })].filter(Boolean).join(", "), noteText].filter(Boolean).join(". ");
            const label = doubtReason ? t("orderReview.doubtOf", { item: plainLabel, reason: doubtReason }) : plainLabel;
            return <View key={item.id} accessible accessibilityLabel={label} style={[styles.product, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.border }]}>
            <View style={styles.productIdentity}>
              <ThemedText style={styles.semibold}>{item.productName}</ThemedText>
              {Object.entries(item.variantAttributes).length > 0 ? <ThemedText type="small" themeColor="textSecondary">{variant}</ThemedText> : null}
              {item.sku ? <ThemedText type="small" themeColor="textSecondary">SKU {item.sku}</ThemedText> : null}
              <ThemedText type="small" themeColor="textSecondary">{item.quantity} × {format(item.unitPrice)}</ThemedText>
              {noteText ? <ThemedText type="small" themeColor="textSecondary">{noteText}</ThemedText> : null}
              {doubtReason ? <><DoubtBadge /><ThemedText type="small" themeColor="textSecondary">{doubtReason}</ThemedText></> : null}
            </View>
            <ThemedText style={styles.amount}>{format(item.subtotal)}</ThemedText>
          </View>;
          })}
          <View style={[styles.paymentSummary, { borderColor: theme.border }]}>
            <MoneyRow label={t('detailSubtotal')} value={format(order.itemsTotal)} />
            <MoneyRow label={t('detailShippingCharge')} value={format(order.deliveryCharge)} />
          </View>
        </View>
        {orderReview ? <MessageChangesBlock rows={orderReview.messageRows} moreRows={orderReview.moreRows} locale={locale} busy={undoing} disabledReason={itemsDraft ? t("itemsEdit.saveFirst") : null}
          onUndo={askUndo} onMore={() => void showAllRows()} loadingMore={loadingRows} /> : null}
        {undoNotice ? <ThemedText accessibilityRole={undoNotice.tone === "alert" ? "alert" : undefined} accessibilityLiveRegion="polite" style={undoNotice.tone === "alert" ? { color: theme.error } : undefined}>{undoNotice.text}</ThemedText> : null}
        <View onLayout={(event) => { paymentPosition.current = event.nativeEvent.layout.y; }} style={[styles.card, styles.section, cardStyle]}>
          <View style={styles.row}>
            <ThemedText type="subtitle" accessibilityRole="header" style={styles.flex}>{t('payments')}</ThemedText>
            <PaymentBadge status={paymentBadgeStatus(order.paidAmount.amount, order.balanceDue.amount)} />
          </View>
          <PaymentSummary total={format(order.total)} paid={format(order.paidAmount)} balance={format(order.balanceDue)} showPaid={hasPaid} />
          {paymentLine ? <ThemedText accessibilityLiveRegion="polite" style={paymentLine === "recorded" ? { color: theme.success } : undefined}>{t(paymentLine === "waiting" ? "paymentRecordedWaiting" : "paymentRecorded")}</ThemedText> : null}
          {reports.length > 0 && !order.cancelled ? <ThemedText type="small" style={{ color: theme.warning }}>{t('paymentToReview')}</ThemedText> : null}
          {order.overpaidAmount.amount > 0 ? <ThemedText type="small" style={{ color: theme.warning }}>{t('overpaid', { amount: format(order.overpaidAmount) })}</ThemedText> : null}
          {order.payments.map((payment) => {
            const receiptImageId = payment.status === "reported" ? payment.data.receiptImageId
              : payment.status === "rejected" ? payment.data.report.receiptImageId
              : payment.data.evidence.kind === "buyer_report" ? payment.data.evidence.report.receiptImageId : null;
            const tag = payment.status === "reported" ? t('paymentTagReported') : payment.status === "voided" ? t('paymentTagVoided')
              : payment.status === "rejected" ? t('paymentTagRejected') : advanceIds.has(payment.id) ? t('advancePayment') : t('detailPaymentConfirmed');
            const method = payment.method === null ? undefined : paymentMethodLabel(t, payment);
            const when = date(payment.status === "reported" ? payment.data.reportedAt : payment.status === "rejected" ? payment.data.rejectedAt : payment.data.confirmedAt, locale);
            const amount = payment.amount ? format(payment.amount) : "—";
            return <View key={payment.id}>
              <PaymentRow method={method} amount={amount} tag={tag} meta={when}
                accessibilityLabel={[method, amount, tag, when, receiptImageId ? t('viewReceipt') : null].filter(Boolean).join(", ")}
                onPress={receiptImageId ? () => void viewReceipt(receiptImageId) : undefined} />
              {payment.status === "rejected" && payment.data.reason ? <ThemedText type="small">{payment.data.reason}</ThemedText> : null}
              {payment.status === "reported" && !order.cancelled ? <Button variant="secondary" disabled={writeBusy} onPress={() => openEditor({ paymentId: payment.id, receiptImageId: payment.data.receiptImageId })}>{t('detailReviewPayment')}</Button> : null}
              {payment.status === "confirmed" && !order.cancelled ? <Button variant="ghost" disabled={writeBusy} onPress={() => void voidPayment(payment.id)}>{t('voidPayment')}</Button> : null}
            </View>;
          })}
          {paymentError && !editor ? <ThemedText style={{ color: theme.error }} accessibilityRole="alert">{paymentError}</ThemedText> : null}
          {!order.cancelled && order.balanceDue.amount > 0 ? <Button disabled={writeBusy} onPress={() => openEditor("manual")}>{hasPaid ? t('collectBalance', { amount: format(order.balanceDue) }) : t('detailRegisterPayment')}</Button> : null}
        </View>
        {order.delivery || !order.cancelled ? <View style={[styles.card, styles.section, cardStyle]}>
          <View style={styles.row}>
            <ThemedText type="subtitle" accessibilityRole="header" style={styles.flex}>{t('delivery')}</ThemedText>
            {!order.cancelled ? <DeliveryBadge status={order.deliveryStatus} language={language} /> : null}
          </View>
          {!order.cancelled ? <>
            {canEditDelivery ? <OrderDayField row label={t('rowDispatch')} value={order.scheduledDispatchDate ?? ""} onChange={day => void reschedule(day)} />
              : <DeliveryRow symbol={deliveryRowSymbols.dispatch} label={t('rowDispatch')} value={order.scheduledDispatchDate ?? t('noScheduledDispatch')} muted={!order.scheduledDispatchDate} />}
            <View style={[styles.divider, { borderColor: theme.border }]} />
          </> : null}
          {order.delivery ? <DeliveryRow symbol={deliveryRowSymbols.shipping} label={t('rowShipping')} expanded={deliveryOpen} onPress={() => setDeliveryOpen(!deliveryOpen)}
            value={shippingSummary(order.delivery.method === "store" ? { method: "store" } : order.delivery.method === "agency"
              ? { method: "agency", district: order.delivery.agency.location.district, province: order.delivery.agency.location.province }
              : { method: "home", district: order.delivery.destination.district })} />
            : canEditDelivery ? <ThemedText themeColor="textSecondary">{t('orderDeliveryUndefined')}</ThemedText> : null}
          {!order.cancelled && Platform.OS === "android" && order.delivery && order.delivery.method !== "store"
            ? <><View style={[styles.divider, { borderColor: theme.border }]} /><LabelRow id={order.id} number={order.number} /></> : null}
          {canEditDelivery ? <Button disabled={writeBusy} variant="ghost" onPress={() => { setPaymentLine(null); router.push({ pathname: "/orders/delivery", params: { id: order.id } }); }}>{t(order.delivery ? 'editOrderDeliveryData' : 'assignOrderDeliveryData')}</Button> : null}
          {canEditDelivery && order.paymentStatus === "pending" ? <ThemedText type="small" themeColor="textSecondary">{t('manualDeliveryWithoutPayment')}</ThemedText> : null}
          {order.delivery ? <>
            {deliveryOpen ? <View style={styles.section}>
              <ThemedText type="small" themeColor="textSecondary">{t('detailRecipient')}</ThemedText>
              <ThemedText selectable>{order.delivery.recipient.name} · {order.delivery.recipient.phone}</ThemedText>
              {order.delivery.recipient.identity.kind === "document" ? <ThemedText selectable>
                {documentTypeLabel(order.delivery.recipient.identity.documentType, language)}: {order.delivery.recipient.identity.document}
              </ThemedText> : null}
              {order.delivery.method === "store" ? <>
                <ThemedText>{order.delivery.pickupPoint.name}</ThemedText><ThemedText selectable>{order.delivery.pickupPoint.address}</ThemedText>
                {order.delivery.pickupPoint.instructions ? <ThemedText themeColor="textSecondary">{order.delivery.pickupPoint.instructions}</ThemedText> : null}
              </> : null}
              {order.delivery.method === "home" ? <>
                <ThemedText selectable>{order.delivery.destination.address}</ThemedText><ThemedText>{order.delivery.destination.district}</ThemedText>
                {order.delivery.destination.instructions ? <ThemedText themeColor="textSecondary">{order.delivery.destination.instructions}</ThemedText> : null}
              </> : null}
              {order.delivery.method === "agency" ? <>
                <ThemedText type="small" themeColor="textSecondary">{t('detailCourier')}</ThemedText><ThemedText selectable>{order.delivery.courier.name}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">{t('detailAgency')}</ThemedText>
                <ThemedText selectable>{order.delivery.agency.name}</ThemedText><ThemedText selectable>{order.delivery.agency.address}</ThemedText>
                <ThemedText>{order.delivery.agency.location.district}, {order.delivery.agency.location.province}</ThemedText>
              </> : null}
              <ThemedText type="small">{t('orderDeliveryCharge', { amount: format(order.deliveryCharge) })}</ThemedText>
              {!canEditDelivery ? <ThemedText type="small" themeColor="textSecondary">{t('orderDeliveryLocked')}</ThemedText> : null}
            </View> : null}
          </> : null}
          {!order.cancelled ? <View style={styles.section}>
            {order.shippedAt ? <ThemedText type="small" themeColor="textSecondary">{t('shippedOn', { date: date(order.shippedAt, locale) })}</ThemedText> : null}
            {nextOperation && (!nextBlock || nextReason) ? <Button disabled={writeBusy || !!nextBlock} loading={fulfilling === nextOperation} onPress={() => void fulfill(nextOperation)}>{t(`orderFulfillment.${nextOperation}`)}</Button> : null}
            {nextReasonText ? <ThemedText type="small" themeColor="textSecondary" style={styles.center}>{nextReasonText}</ThemedText> : null}
            {fulfillmentError ? <ThemedText style={{ color: theme.error }} accessibilityRole="alert">{fulfillmentError}</ThemedText> : null}
            {fulfillmentMessage ? <ThemedText accessibilityRole="alert">{fulfillmentMessage}</ThemedText> : null}
          </View> : null}
        </View> : null}
        <View style={[styles.card, styles.section, cardStyle]}>
          <View><ThemedText style={styles.semibold} accessibilityRole="header">{t('checkoutTitle')}</ThemedText>
            {checkoutState ? <ThemedText type="small" themeColor="textSecondary">{checkoutState}</ThemedText> : null}</View>
          {!order.cancelled && checkoutLink.kind === "loading" ? <View style={styles.linkLoading} accessibilityRole="progressbar" accessibilityLabel={t('checkoutLoading')}>
            <ActivityIndicator color={theme.text} /><ThemedText type="small" themeColor="textSecondary">{t('checkoutLoading')}</ThemedText>
          </View> : null}
          {!order.cancelled && checkoutLink.kind === "ready" ? <>
            {needsReview ? <>
              <ThemedText>{t("orderReview.beforeLink")}</ThemedText>
              {counts ? <ThemedText type="small" themeColor="textSecondary">{counts}</ThemedText> : null}
            </> : <ThemedText type="small" selectable>{checkoutLink.url}</ThemedText>}
            <Button variant="secondary" disabled={!!itemsDraft} onPress={() => requestLink("copy")}>{t('copyCheckoutLink')}</Button>
            <Button variant="secondary" disabled={!!itemsDraft} onPress={() => requestLink("share")}>{t('shareCheckoutLink')}</Button>
            <Button variant="secondary" disabled={!!itemsDraft} onPress={() => requestLink("open")}>{t('openCheckoutLink')}</Button>
            {meanwhile ? <ThemedText accessibilityLiveRegion="polite">{meanwhile}</ThemedText> : null}
            {itemsDraft ? <ThemedText type="small" themeColor="textSecondary">{t("itemsEdit.saveFirst")}</ThemedText> : null}
            {copied ? <ThemedText accessibilityLiveRegion="polite">{t('checkoutCopied')}</ThemedText> : null}
            <ThemedText type="small" themeColor="textSecondary">{t('checkoutHelp')}</ThemedText>
          </> : null}
          {!order.cancelled && checkoutLink.kind === "subdomain_required" ? <>
            <ThemedText>{t('checkoutSubdomainRequired')}</ThemedText>
            <Button variant="secondary" onPress={() => router.push("/settings/appearance?focus=catalog")}>{t('catalogGoToAppearance')}</Button>
          </> : null}
          {!order.cancelled && checkoutLink.kind === "error" ? <>
            <ThemedText accessibilityRole="alert">{t('checkoutLinkError')}</ThemedText>
            <Button variant="secondary" onPress={() => { setLinkResult(null); setLinkRefresh(count => count + 1); }}>{t('retry')}</Button>
          </> : null}
        </View>
        <View style={[styles.card, styles.section, cardStyle]}>
          <Disclosure label={t('detailInternal')} open={internalOpen} onPress={() => setInternalOpen(!internalOpen)} />
          {internalOpen ? <>
            <ThemedText type="small">{stockLine}</ThemedText>
            {order.sellerId ? <ThemedText type="small" themeColor="textSecondary" selectable>{t('detailSeller', { id: order.sellerId })}</ThemedText> : null}
            {order.completedAt ? <ThemedText type="small" themeColor="textSecondary">{t('completedOn', { date: date(order.completedAt, locale) })}</ThemedText> : null}
            {order.delivery ? <>
              <ThemedText type="small">{t('orderDeliveryCost', { amount: format(order.deliveryCost) })}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{order.delivery.recordedBy.kind === "seller" ? t('orderDeliverySeller', { id: order.delivery.recordedBy.userId }) : t('orderDeliveryBuyer')}</ThemedText>
            </> : null}
          </> : null}
        </View>
        {order.status === "active" && order.deliveryStatus === "pending" && !order.cancelled ?
          <Button variant="ghost" disabled={writeBusy} loading={cancellation.kind === "submitting"} onPress={confirmCancellation}>{t("orderCancellation.cancel")}</Button> : null}
      </ScrollView>
      {itemsDraft ? <View style={[styles.editBar, cardStyle]}>
        {itemsNotice && !["saved", "savedWaiting", "saveShipped", "saveDelivered", "saveCancelled"].includes(itemsNotice) ? <View style={styles.section}>
          <ThemedText type="small" accessibilityRole="alert">{t(`itemsEdit.${itemsNotice === "doubt" ? "inDoubt" : itemsNotice}`)}</ThemedText>
          {itemsNotice === "conflict" ? <Button variant="secondary" disabled={savingItems} onPress={() => showConfirmation({ title: t("itemsEdit.reloadTitle"), confirmLabel: t("itemsEdit.reloadConfirm"), cancelLabel: t("itemsEdit.reloadKeep"), destructive: true, onConfirm: () => void reloadAfterConflict() })}>{t("itemsEdit.reload")}</Button> : null}
          {itemsNotice === "checkFailed" ? <Button variant="secondary" onPress={() => void verifyLostSave(order.id, itemsDraft.base, sentLines.current)}>{t("itemsEdit.checkAgain")}</Button> : null}
        </View> : null}
        <ThemedText style={styles.semibold}>{itemsDirty ? t("itemsEdit.unsaved") : t("itemsEdit.editing")}</ThemedText>
        <View style={styles.editActions}>
          <View style={styles.flex}><Button variant="secondary" disabled={savingItems} onPress={() => itemsDirty ? confirmDiscardItems(() => endItemsEdit(null)) : endItemsEdit(null)}>{t("itemsEdit.discard")}</Button></View>
          <View style={styles.flex}><Button loading={savingItems} disabled={!itemsDirty || draftLines(itemsDraft) === null} onPress={() => void saveItems()}>{t("itemsEdit.save")}</Button></View>
        </View>
      </View> : null}
    </View>
    <Modal visible={review !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={closeEditor}>
      <SafeAreaView style={[styles.page, { backgroundColor: theme.background }]}>
        <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={styles.modalHeader}>
            <ThemedText type="subtitle" accessibilityRole="header" style={styles.flex}>{t('detailReviewPayment')}</ThemedText>
            <Button variant="ghost" disabled={writeBusy} onPress={closeEditor}>{t('detailClose')}</Button>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
            <ThemedText>{t('balanceDue', { amount: format(order.balanceDue) })}</ThemedText>
            {review ? <Button variant="secondary" onPress={() => void viewReceipt(review.receiptImageId)}>{t('viewReceipt')}</Button> : null}
            {review && rejection ? <RejectionForm busy={writeBusy} reason={rejection.reason}
              onChange={reason => setRejection({ reason })} onBack={() => { setRejection(null); setPaymentError(""); }}
              onConfirm={() => void rejectReport(review.paymentId, rejection.reason)} /> : null}
            {review && !rejection ? <PaymentEditor key={review.paymentId} order={order} busy={writeBusy}
              onConfirm={(amount, method, deduct) => void confirmPayment(review.paymentId, "buyer_report", amount, method, deduct)} /> : null}
            {review && !rejection ? <Button variant="secondary" disabled={writeBusy} onPress={() => { setPaymentError(""); setRejection({ reason: "" }); }}>{t('rejectPayment')}</Button> : null}
            {paymentError ? <ThemedText style={{ color: theme.error }} accessibilityRole="alert">{paymentError}</ThemedText> : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
    {reviewFlow && orderReview ? <OrderReviewModal origin={reviewFlow.origin} order={order} review={orderReview} format={format}
      onClose={() => setReviewFlow(null)} onConfirmed={reviewConfirmed} onReload={reloadForReview} onUndo={applyUndo} /> : null}
    <PaymentRegisterSheet visible={editor === "manual"} balance={order.balanceDue.amount} currency={order.total.currency}
      format={amount => format({ amount, currency: order.total.currency })} busy={writeBusy} error={editor === "manual" ? paymentError : ""}
      stockOffer={amount => {
        const offered = offersPartialStockDeduction(order, amount !== null ? { amount, currency: order.total.currency } : null);
        return { offered, reason: offered || amount === null ? null : order.stockDeducted ? t('stockAlreadyDeducted') : t('stockWithFullPayment') };
      }}
      onClose={closeEditor}
      onSubmit={({ amount, deductStockIfPartial, ...method }) => {
        manualPaymentId.current ??= Crypto.randomUUID();
        void confirmPayment(manualPaymentId.current, "manual", amount, method, deductStockIfPartial);
      }} />
  </SafeAreaView></ThemedView>;
}

function LabelRow({ id, number }: { id: string; number: number }) {
  const { t } = useTranslation();
  const { open, active, show } = useDispatchPrint();
  // Like the order list: while a batch is in progress, open it instead of replacing it.
  return <DeliveryRow symbol={deliveryRowSymbols.label} label={t('rowLabel')} value={active ? t('dispatchViewBatch') : t('rowLabelPrint')} onPress={() => active ? show() : open([{ id, number }])} />;
}

function StatusBadge({ label, tone }: { label: string; tone: "neutral" | "success" | "warning" }) {
  const theme = useTheme();
  return <View style={[styles.badge, { backgroundColor: tone === "success" ? theme.successSurface : tone === "warning" ? theme.warningSurface : theme.secondary }]}>
    <ThemedText type="small" style={{ color: tone === "success" ? theme.success : tone === "warning" ? theme.warning : theme.textSecondary }}>{label}</ThemedText>
  </View>;
}

function MoneyRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <View style={styles.moneyRow}>
    <ThemedText style={[styles.moneyLabel, strong && styles.semibold]} themeColor={strong ? 'text' : 'textSecondary'}>{label}</ThemedText>
    <ThemedText style={[styles.moneyValue, strong && styles.semibold]}>{value}</ThemedText>
  </View>;
}

function Disclosure({ label, description, open, onPress }: { label: string; description?: string; open: boolean; onPress: () => void }) {
  const theme = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded: open }} onPress={onPress}
    style={({ pressed }) => [styles.disclosure, { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}>
    <View style={styles.flex}><ThemedText style={styles.semibold}>{label}</ThemedText>
      {description ? <ThemedText type="small" themeColor="textSecondary">{description}</ThemedText> : null}</View>
    <SymbolView name={open ? { ios: "chevron.down", android: "expand_more" } : { ios: "chevron.right", android: "chevron_right" }} size={20} tintColor={theme.textSecondary} />
  </Pressable>;
}

const styles = StyleSheet.create({
  productsHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  editBar: { gap: 8, padding: 16, borderTopWidth: StyleSheet.hairlineWidth },
  editActions: { flexDirection: "row", gap: 8 },
  page: { flex: 1 }, container: { flex: 1, width: "100%", maxWidth: 640, alignSelf: "center" }, flex: { flex: 1 },
  content: { gap: 12, padding: 16, paddingTop: 4, paddingBottom: 32, maxWidth: 640, width: "100%", alignSelf: "center" },
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, paddingVertical: 4 },
  iconButton: { minWidth: 48, minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 6 },
  title: { flex: 1, fontSize: 20, lineHeight: 28, fontWeight: "600" },
  heading: { gap: 8, paddingBottom: 4 }, row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  card: { padding: 16, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth },
  paymentSummary: { gap: 8, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  center: { textAlign: "center" },
  linkLoading: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 12 },
  stockNotice: { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 12, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth },
  receiptNotice: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth },
  section: { gap: 10 },
  product: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8, paddingVertical: 12 },
  productIdentity: { flexGrow: 1, flexShrink: 1, flexBasis: 170, gap: 2 },
  semibold: { fontWeight: "600" }, amount: { fontWeight: "600", fontVariant: ["tabular-nums"], textAlign: "right" },
  moneyRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "baseline", gap: 8 },
  moneyLabel: { flexGrow: 1, flexShrink: 1, flexBasis: 150 }, moneyValue: { textAlign: "right", fontVariant: ["tabular-nums"] },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, marginVertical: 2 },
  disclosure: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48, paddingVertical: 4, borderRadius: 6 },
  modalHeader: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16 },
  item: { gap: 4, paddingVertical: 12 },
});

function PaymentEditor({ order, busy, onConfirm }: { order: OrderAggregateResponse; busy: boolean;
  onConfirm: (amount: string, method: PaymentMethodAndProvider, deductStockIfPartial: boolean) => void }) {
  const { t } = useTranslation();
  const balance = order.balanceDue.amount;
  const [value, setValue] = useState<PaymentFieldsValue>({ amount: balance > 0 ? balance.toFixed(2) : "", ...paymentFromChoice(defaultPaymentChoice), deductStockIfPartial: false });
  const typed = Number(normalizeDecimalInput(value.amount));
  const showStock = offersPartialStockDeduction(order, value.amount.trim() && Number.isFinite(typed) ? { amount: typed, currency: order.total.currency } : null);
  return <View style={styles.section}><PaymentFields value={value} onChange={setValue} currency={order.total.currency} busy={busy} showStockOption={showStock} />
    <Button disabled={busy} loading={busy} onPress={() => onConfirm(value.amount, paymentFromChoice(choiceOfPayment(value) ?? defaultPaymentChoice), showStock && value.deductStockIfPartial)}>{t('confirmPayment')}</Button>
  </View>;
}

function RejectionForm({ reason, busy, onChange, onBack, onConfirm }: { reason: string; busy: boolean;
  onChange: (reason: string) => void; onBack: () => void; onConfirm: () => void }) {
  const { t } = useTranslation();
  return <View style={styles.section}>
    <ThemedText type="subtitle" accessibilityRole="header">{t('rejectTitle')}</ThemedText>
    <ThemedText>{t('rejectHelp')}</ThemedText>
    <Field disabled={busy}><FieldLabel>{t('rejectReason')}</FieldLabel>
      <Input value={reason} onChangeText={onChange} maxLength={200} multiline accessibilityLabel={t('rejectReason')} /></Field>
    <Button disabled={busy} loading={busy} onPress={onConfirm}>{t('rejectConfirm')}</Button>
    <Button variant="ghost" disabled={busy} onPress={onBack}>{t('rejectBack')}</Button>
  </View>;
}
