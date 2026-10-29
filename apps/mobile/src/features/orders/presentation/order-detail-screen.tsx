/** @jsxImportSource react */
// THESIS: understand the sale, then act on delivery beside its data; approved order-detail A.
// OWN-WORLD: Caramelo sobrio, Inter, flat token surfaces, discreet borders and native symbols.
// STORY: inspect products and payments, consult and fulfill delivery, disclose technical details.
// FIRST VIEWPORT: compact header, buyer, receipt notice, products then payment; actions stay contextual.
// FORM: user-approved round2-a-resumen-conectado.png; grouped summary and compact contextual rows.
// FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
import { showConfirmation } from "@mobile/components/ui/show-confirmation";
import type { CancellationRequestError, CancellationRecoveryError } from "@mobile/features/orders/application/cancel-order";
import { fulfillmentBlock } from "@shared/orders-fulfillment";
import { mentionedPriceNote } from "@shared/mentioned-price";
import { PaymentFields, type PaymentFieldsValue } from "@mobile/features/orders/presentation/payment-fields";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, View } from "react-native";
import { SymbolView } from "expo-symbols";
import * as Crypto from "expo-crypto";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { subtract } from "@shared/money";
import { offersPartialStockDeduction } from "@shared/orders-payment";
import type { OrderAggregateResponse } from "@shared/contracts/orders";
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
import { deliveryMethodLabel, deliveryStatusLabel, documentTypeLabel, orderLanguage, orderStatusLabel } from "@mobile/features/orders/presentation/order-labels";
import { PaymentBadge, PaymentRegisterSheet, PaymentRow, PaymentSummary, paymentBadgeStatus } from "@mobile/features/orders/presentation/order-payment-parts";
import { OrderDayField } from "@mobile/features/orders/presentation/order-day-field";
import { useCopyLink } from "@mobile/features/catalog/presentation/use-copy-link";
import { OrderBuyerName } from "@mobile/features/orders/presentation/order-buyer";
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

export default function OrderDetailScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'pt-BR' ? 'pt-BR' : 'es-PE';
  const { id, noticeAt } = useLocalSearchParams<{ id: string; noticeAt?: string }>();
  const { state } = useAccess();
  const { notice, clear } = useOrderResult();
  const [order, setOrder] = useState<OrderAggregateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [linkResult, setLinkResult] = useState<Readonly<{ orderId: string; link: Exclude<CheckoutLinkState, { kind: "loading" }> }> | null>(null);
  const [linkRefresh, setLinkRefresh] = useState(0);
  const linkRequest = useRef(0);
  const checkoutGeneration = useRef(0);
  const [paymentError, setPaymentError] = useState("");
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
  const scope = `${state.status === "ready" ? state.user.id : ""}:${companyId}:${id}`;
  const currentScope = useRef(scope);
  useLayoutEffect(() => { currentScope.current = scope; }, [scope]);
  const cancellationBusy = cancellation.kind === "submitting" || cancellation.kind === "verifying";
  const cancellationBlocked = cancellationBusy || cancellation.kind === "uncertain" || detailRefreshFailed;
  // A result belongs to the order it was read for, so another order never shows this one's link while its own loads.
  const checkoutLink: CheckoutLinkState = linkResult && linkResult.orderId === order?.id ? linkResult.link : { kind: "loading" };
  const { copied, copy: copyLink, open: openLink } = useCopyLink(checkoutLink.kind === "ready" ? checkoutLink.url : null);
  const writeBusy = cancellationBlocked || !!savingPayment || !!fulfilling || rescheduling;
  const reload = useCallback(async (silent = false) => {
    const generation = checkoutGeneration.current;
    const requestScope = scope;
    if (!silent) setLoading(true);
    const result = await orders.loadOrderAggregate(id);
    if (generation !== checkoutGeneration.current || requestScope !== currentScope.current) return;
    // A refresh the seller did not ask for keeps what is on screen when it fails.
    if (result.success) { setOrder(result.data); setError(""); loaded.current = true; }
    else if (!silent) setError(result.error.code === "ORDER_NOT_FOUND" ? translations.t('orderNotFound') : translations.t('loadOrderError'));
    setLoading(false);
  }, [id, scope]);
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
    method: "digital_wallet" | "bank_transfer", deductStockIfPartial: boolean) {
    if (!order || cancellationLock.current || writeBusy || order.cancelled) return;
    const amount = Number(normalizeDecimalInput(amountText));
    if (!Number.isFinite(amount) || amount <= 0 || !/^\d+(?:[.,]\d{1,2})?$/.test(amountText.trim())) {
      setPaymentError(t("invalidPaymentAmount")); return;
    }
    setSavingPayment(paymentId); setPaymentError("");
    const result = await orders.registerPayment(order.id, { paymentId, source, amount: { amount, currency: order.total.currency },
      method, deductStockIfPartial });
    if (result.success) {
      setOrder(result.data.order); setEditor(null);
      if (source === "manual") manualPaymentId.current = null;
    }
    else {
      const failure = confirmPaymentFailure(result.error.code);
      setPaymentError(result.error.code === "INSUFFICIENT_STOCK" ? t("paymentStockError") : failure === "already_reviewed" ? t("paymentAlreadyReviewed")
        : failure === "unknown" ? t("paymentUnknownResult") : t("paymentSaveError"));
      if (failure !== "failed") { const refreshed = await orders.loadOrderAggregate(order.id); if (refreshed.success) setOrder(refreshed.data); }
    }
    setSavingPayment(null);
  }
  async function rejectReport(paymentId: string, reason: string) {
    if (!order || cancellationLock.current || writeBusy || order.cancelled) return;
    const trimmed = reason.trim();
    if (trimmed.length > 200) { setPaymentError(t("rejectReasonTooLong")); return; }
    setSavingPayment(paymentId); setPaymentError("");
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
    setSavingPayment(paymentId); setPaymentError("");
    const result = await orders.voidPayment(order.id, paymentId);
    if (result.success) setOrder(result.data);
    else setPaymentError(t("paymentSaveError"));
    setSavingPayment(null);
  }
  async function fulfill(operation: "ship" | "deliver") {
    if (!order || cancellationLock.current || writeBusy || fulfillmentBlock(order, operation)) return;
    setFulfilling(operation); setFulfillmentError(""); setFulfillmentMessage("");
    try {
      const result = await orders[operation](order.id);
      if (result.success) { setOrder(result.data); setFulfillmentMessage(t(`orderFulfillment.${operation}Saved`)); }
      else setFulfillmentError(t(`orderFulfillment.${result.error.code}`, { defaultValue: t("orderFulfillment.saveError") }));
    } catch { setFulfillmentError(t("orderFulfillment.saveError")); }
    finally { setFulfilling(null); }
  }
  async function reschedule(day: string) {
    if (!order || cancellationLock.current || writeBusy) return;
    setRescheduling(true); setFulfillmentError(""); setFulfillmentMessage("");
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
  if (state.status !== "ready") return null;
  if (loading) return <ScreenState status="loading" title={t('loadingOrder')} />;
  if (!order || error) return <ScreenState status="error" title={t('openOrderError')} description={error} onRetry={() => void reload()} />;

  const original = notice?.id === order.id ? notice.shownTotal : null;
  const difference = original?.currency === order.total.currency ? subtract(original)(order.total) : null;
  const changed = original && (original.currency !== order.total.currency || original.amount !== order.total.amount);
  const language = orderLanguage(state.company.country, i18n.language);
  const title = orderStatusLabel(order.status, language);
  const delivery = deliveryStatusLabel(order.deliveryStatus, language);
  const format = (value: { amount: number; currency: string }) => money(value.amount, value.currency, locale);
  const reports = order.payments.filter((payment) => payment.status === "reported");
  const hasPaid = order.paidAmount.amount > 0;
  const canEditDelivery = order.status === "active" && order.deliveryStatus === "pending" && !order.cancelled;
  const checkoutState = order.cancelled ? t("checkoutCancelled") : order.checkoutConfirmedAt ? t("checkoutConfirmed") : order.status === "active" ? t("checkoutPending") : null;
  const openPayments = () => {
    scroll.current?.scrollTo({ y: paymentPosition.current, animated: false });
  };
  const openEditor = (value: NonNullable<typeof editor>) => { if (cancellationLock.current || writeBusy || order.cancelled) return; setPaymentError(""); setRejection(null); setEditor(value); };
  const closeEditor = () => { if (!savingPayment) { setEditor(null); setRejection(null); setPaymentError(""); } };
  const fulfillmentActions = (["ship", "deliver"] as const).filter(operation => !fulfillmentBlock(order, operation));
  const deliveryBlock = fulfillmentBlock(order, "deliver");
  const fulfillmentReason = deliveryBlock === "PAYMENT_REQUIRED" || deliveryBlock === "STOCK_NOT_DEDUCTED" ? deliveryBlock : null;
  const cardStyle = { backgroundColor: theme.backgroundElement, borderColor: theme.border };
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
        {changed && original ? <View style={[styles.card, styles.section, { backgroundColor: theme.warningSurface, borderColor: theme.border }]}>
          <ThemedText type="subtitle" accessibilityRole="header">{t('reviewCharge')}</ThemedText>
          <ThemedText>{t('shownAtConfirmation', { amount: money(original.amount, original.currency, locale) })}</ThemedText>
          <ThemedText>{t('recordedTotalAmount', { amount: format(order.total) })}</ThemedText>
          {difference?.success ? <ThemedText>{t('amountDifference', { amount: money(difference.data.amount, order.total.currency, locale) })}</ThemedText> : null}
          <ThemedText type="small">{t('adjustCharge')}</ThemedText>
        </View> : null}
        <View style={[styles.card, cardStyle]}>
          <ThemedText type="subtitle" accessibilityRole="header">{t('detailProducts', { count: order.items.reduce((sum, item) => sum + item.quantity, 0) })}</ThemedText>
          {order.items.map((item, index) => {
            const note = mentionedPriceNote(item);
            const noteText = note ? t('mentionedPrice', { count: note.units, amount: money(note.amount, item.unitPrice.currency, locale) }) : null;
            const variant = Object.entries(item.variantAttributes).map(([key, value]) => `${key}: ${value}`).join(" · ");
            const label = [[item.productName, variant, item.sku ? `SKU ${item.sku}` : null, t('orderItemDetailLabel', { quantity: item.quantity, unit: format(item.unitPrice), subtotal: format(item.subtotal) })].filter(Boolean).join(", "), noteText].filter(Boolean).join(". ");
            return <View key={item.id} accessible accessibilityLabel={label} style={[styles.product, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.border }]}>
            <View style={styles.productIdentity}>
              <ThemedText style={styles.semibold}>{item.productName}</ThemedText>
              {Object.entries(item.variantAttributes).length > 0 ? <ThemedText type="small" themeColor="textSecondary">{variant}</ThemedText> : null}
              {item.sku ? <ThemedText type="small" themeColor="textSecondary">SKU {item.sku}</ThemedText> : null}
              <ThemedText type="small" themeColor="textSecondary">{item.quantity} × {format(item.unitPrice)}</ThemedText>
              {noteText ? <ThemedText type="small" themeColor="textSecondary">{noteText}</ThemedText> : null}
            </View>
            <ThemedText style={styles.amount}>{format(item.subtotal)}</ThemedText>
          </View>;
          })}
          <View style={[styles.paymentSummary, { borderColor: theme.border }]}>
            <MoneyRow label={t('detailSubtotal')} value={format(order.itemsTotal)} />
            <MoneyRow label={t('detailShippingCharge')} value={format(order.deliveryCharge)} />
          </View>
        </View>
        <View onLayout={(event) => { paymentPosition.current = event.nativeEvent.layout.y; }} style={[styles.card, styles.section, cardStyle]}>
          <View style={styles.row}>
            <ThemedText type="subtitle" accessibilityRole="header" style={styles.flex}>{t('payments')}</ThemedText>
            <PaymentBadge status={paymentBadgeStatus(order.paidAmount.amount, order.balanceDue.amount)} />
          </View>
          <PaymentSummary total={format(order.total)} paid={format(order.paidAmount)} balance={format(order.balanceDue)} showPaid={hasPaid} />
          {reports.length > 0 && !order.cancelled ? <ThemedText type="small" style={{ color: theme.warning }}>{t('paymentToReview')}</ThemedText> : null}
          {order.overpaidAmount.amount > 0 ? <ThemedText type="small" style={{ color: theme.warning }}>{t('overpaid', { amount: format(order.overpaidAmount) })}</ThemedText> : null}
          {order.payments.map((payment) => {
            const receiptImageId = payment.status === "reported" ? payment.data.receiptImageId
              : payment.status === "rejected" ? payment.data.report.receiptImageId
              : payment.data.evidence.kind === "buyer_report" ? payment.data.evidence.report.receiptImageId : null;
            const tag = payment.status === "reported" ? t('paymentTagReported') : payment.status === "voided" ? t('paymentTagVoided')
              : payment.status === "rejected" ? t('paymentTagRejected') : payment.amount && payment.amount.amount < order.total.amount - 0.005 ? t('advancePayment') : t('detailPaymentConfirmed');
            const method = t(payment.method === "digital_wallet" ? 'wallet' : 'bankTransfer');
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
            <ThemedText type="subtitle" accessibilityRole="header">{t('delivery')}</ThemedText>
            {!order.cancelled ? <ThemedText type="small" themeColor="textSecondary">{delivery}</ThemedText> : null}
          </View>
          <View style={styles.deliverySummary}>
            <View style={styles.deliveryIdentity}>
            {order.delivery ? <Disclosure label={deliveryMethodLabel(order.delivery.method, language)} open={deliveryOpen} onPress={() => setDeliveryOpen(!deliveryOpen)}
              description={`${order.delivery.method === "agency" ? `${order.delivery.courier.name} · ${order.delivery.agency.name}` : order.delivery.method === "store" ? order.delivery.pickupPoint.name : order.delivery.destination.district} · ${order.delivery.recipient.name}`} />
              : canEditDelivery ? <ThemedText themeColor="textSecondary">{t('orderDeliveryUndefined')}</ThemedText> : null}
            </View>
            {canEditDelivery ? <Button disabled={writeBusy} variant="ghost" onPress={() => router.push({ pathname: "/orders/delivery", params: { id: order.id } })}>{t(order.delivery ? 'editOrderDeliveryData' : 'assignOrderDeliveryData')}</Button> : null}
          </View>
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
            {canEditDelivery ? <OrderDayField label={t('scheduledDispatch')} value={order.scheduledDispatchDate ?? ""} onChange={day => void reschedule(day)} />
              : <ThemedText type="small" themeColor="textSecondary">{t('scheduledDispatch')}: {order.scheduledDispatchDate ?? t('noScheduledDispatch')}</ThemedText>}
            {order.shippedAt ? <ThemedText type="small" themeColor="textSecondary">{t('shippedOn', { date: date(order.shippedAt, locale) })}</ThemedText> : null}
            {fulfillmentActions.length > 0 ? <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.border }}>
              {fulfillmentActions.map(operation => <OrderAction key={operation} label={t(`orderFulfillment.${operation}`)}
                loading={fulfilling === operation} disabled={writeBusy} onPress={() => void fulfill(operation)} />)}
            </View> : null}
            {fulfillmentReason ? <View style={[styles.fulfillmentNotice, { borderColor: theme.border }]}>
              <ThemedText type="small" themeColor="textSecondary">{t(`orderFulfillment.${fulfillmentReason}`)}</ThemedText>
            </View> : null}
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
            <ThemedText type="small" selectable>{checkoutLink.url}</ThemedText>
            <Button variant="secondary" onPress={() => void copyLink()}>{t('copyCheckoutLink')}</Button>
            <Button variant="secondary" onPress={() => void Share.share({ message: checkoutLink.url }).catch(() => undefined)}>{t('shareCheckoutLink')}</Button>
            <Button variant="secondary" onPress={openLink}>{t('openCheckoutLink')}</Button>
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
            <ThemedText type="small">{order.stockDeducted ? t('stockDeducted') : t('stockPending')}</ThemedText>
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
    </View>
    <Modal visible={editor !== null && editor !== "manual"} animationType="slide" presentationStyle="pageSheet" onRequestClose={closeEditor}>
      <SafeAreaView style={[styles.page, { backgroundColor: theme.background }]}>
        <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={styles.modalHeader}>
            <ThemedText type="subtitle" accessibilityRole="header" style={styles.flex}>{t(editor === "manual" ? 'detailRegisterPayment' : 'detailReviewPayment')}</ThemedText>
            <Button variant="ghost" disabled={writeBusy} onPress={closeEditor}>{t('detailClose')}</Button>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
            <ThemedText>{t('balanceDue', { amount: format(order.balanceDue) })}</ThemedText>
            {editor && editor !== "manual" ? <Button variant="secondary" onPress={() => void viewReceipt(editor.receiptImageId)}>{t('viewReceipt')}</Button> : null}
            {editor && rejection && editor !== "manual" ? <RejectionForm busy={writeBusy} reason={rejection.reason}
              onChange={reason => setRejection({ reason })} onBack={() => { setRejection(null); setPaymentError(""); }}
              onConfirm={() => void rejectReport(editor.paymentId, rejection.reason)} /> : null}
            {editor && !rejection ? <PaymentEditor key={editor === "manual" ? "manual" : editor.paymentId} order={order} busy={writeBusy} onConfirm={(amount, method, deduct) => {
              if (editor === "manual") {
                manualPaymentId.current ??= Crypto.randomUUID();
                void confirmPayment(manualPaymentId.current, "manual", amount, method, deduct);
              } else void confirmPayment(editor.paymentId, "buyer_report", amount, method, deduct);
            }} /> : null}
            {editor && editor !== "manual" && !rejection ? <Button variant="secondary" disabled={writeBusy} onPress={() => { setPaymentError(""); setRejection({ reason: "" }); }}>{t('rejectPayment')}</Button> : null}
            {paymentError ? <ThemedText style={{ color: theme.error }} accessibilityRole="alert">{paymentError}</ThemedText> : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
    <PaymentRegisterSheet visible={editor === "manual"} balance={order.balanceDue.amount} currency={order.total.currency}
      format={amount => format({ amount, currency: order.total.currency })} busy={writeBusy} error={editor === "manual" ? paymentError : ""}
      stockOffer={amount => {
        const offered = offersPartialStockDeduction(order, amount !== null ? { amount, currency: order.total.currency } : null);
        return { offered, reason: offered || amount === null ? null : order.stockDeducted ? t('stockAlreadyDeducted') : t('stockWithFullPayment') };
      }}
      onClose={closeEditor}
      onSubmit={({ amount, method, deductStockIfPartial }) => {
        manualPaymentId.current ??= Crypto.randomUUID();
        void confirmPayment(manualPaymentId.current, "manual", amount, method, deductStockIfPartial);
      }} />
  </SafeAreaView></ThemedView>;
}

function OrderAction({ label, onPress, disabled = false, loading = false }: {
  label: string; onPress: () => void; disabled?: boolean; loading?: boolean;
}) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const blocked = disabled || loading;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: blocked, busy: loading }}
    disabled={blocked} onPress={onPress} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={({ pressed }) => [styles.action, { backgroundColor: pressed ? theme.backgroundSelected : 'transparent',
      borderColor: focused ? theme.ring : 'transparent', opacity: blocked ? 0.5 : 1 }]}>
    <ThemedText style={styles.flex}>{label}</ThemedText>
    {loading ? <ActivityIndicator color={theme.text} /> : <SymbolView name={{ ios: "chevron.right", android: "chevron_right" }} size={20} tintColor={theme.textSecondary} />}
  </Pressable>;
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
  page: { flex: 1 }, container: { flex: 1, width: "100%", maxWidth: 640, alignSelf: "center" }, flex: { flex: 1 },
  content: { gap: 12, padding: 16, paddingTop: 4, paddingBottom: 32, maxWidth: 640, width: "100%", alignSelf: "center" },
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, paddingVertical: 4 },
  iconButton: { minWidth: 48, minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 6 },
  title: { flex: 1, fontSize: 20, lineHeight: 28, fontWeight: "600" },
  heading: { gap: 8, paddingBottom: 4 }, row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  card: { padding: 16, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth },
  paymentSummary: { gap: 8, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  balances: { flexDirection: "row", flexWrap: "wrap", gap: 16, paddingVertical: 4 },
  balance: { flexGrow: 1, flexBasis: 120, gap: 4 },
  fulfillmentNotice: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10 },
  deliverySummary: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  deliveryIdentity: { flexGrow: 1, flexShrink: 1, flexBasis: 150 },
  action: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, paddingHorizontal: 4, borderRadius: 6, borderWidth: 2 },
  linkLoading: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 12 },
  receiptNotice: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth },
  section: { gap: 10 },
  product: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8, paddingVertical: 12 },
  productIdentity: { flexGrow: 1, flexShrink: 1, flexBasis: 170, gap: 2 },
  semibold: { fontWeight: "600" }, amount: { fontWeight: "600", fontVariant: ["tabular-nums"], textAlign: "right" },
  moneyRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "baseline", gap: 8 },
  moneyLabel: { flexGrow: 1, flexShrink: 1, flexBasis: 150 }, moneyValue: { textAlign: "right", fontVariant: ["tabular-nums"] },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, marginVertical: 2 },
  disclosure: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48, paddingVertical: 4, borderRadius: 6 },
  payment: { gap: 8, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  modalHeader: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16 },
  item: { gap: 4, paddingVertical: 12 },
});

function PaymentEditor({ order, busy, onConfirm }: { order: OrderAggregateResponse; busy: boolean;
  onConfirm: (amount: string, method: "digital_wallet" | "bank_transfer", deductStockIfPartial: boolean) => void }) {
  const { t } = useTranslation();
  const balance = order.balanceDue.amount;
  const [value, setValue] = useState<PaymentFieldsValue>({ amount: balance > 0 ? balance.toFixed(2) : "", method: "digital_wallet", deductStockIfPartial: false });
  const typed = Number(normalizeDecimalInput(value.amount));
  const showStock = offersPartialStockDeduction(order, value.amount.trim() && Number.isFinite(typed) ? { amount: typed, currency: order.total.currency } : null);
  return <View style={styles.section}><PaymentFields value={value} onChange={setValue} currency={order.total.currency} busy={busy} showStockOption={showStock} />
    <Button disabled={busy} loading={busy} onPress={() => onConfirm(value.amount, value.method, showStock && value.deductStockIfPartial)}>{t('confirmPayment')}</Button>
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
