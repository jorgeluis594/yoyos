/** @jsxImportSource react */
// THESIS: understand the sale before editing it; approved native commercial summary A.
// OWN-WORLD: Caramelo sobrio, Inter, flat token surfaces, discreet borders and native symbols.
// STORY: identify independent states, inspect products and money, review payments, consult delivery.
// FIRST VIEWPORT: compact header, buyer, receipt notice, products then payment; actions stay contextual.
// FORM: user-approved .impeccable/mocks/native-order-detail/a-commercial.png.
// FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
import { fulfillmentBlock } from "@shared/orders-fulfillment";
import { PaymentFields, type PaymentFieldsValue } from "@mobile/features/orders/presentation/payment-fields";
import * as Clipboard from "expo-clipboard";
import { useCallback, useRef, useState } from "react";
import { KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SymbolView } from "expo-symbols";
import * as Crypto from "expo-crypto";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { subtract } from "@shared/money";
import type { OrderAggregateResponse } from "@shared/contracts/orders";
import { orders } from "@mobile/features/orders/composition";
import { ThemedText } from "@mobile/components/themed-text";
import { ThemedView } from "@mobile/components/themed-view";
import { Button } from "@mobile/components/ui/button";
import { ScreenState } from "@mobile/components/ui/screen-state";
import { useAccess } from "@mobile/features/users/presentation/access-provider";
import { useOrderResult } from "@mobile/features/orders/presentation/order-result";
import { deliveryMethodLabel, deliveryStatusLabel, documentTypeLabel, orderLanguage, orderStatusLabel } from "@mobile/features/orders/presentation/order-labels";
import { useTheme } from "@mobile/hooks/use-theme";
import translations from "@mobile/i18n";

const money = (amount: number, currency: string, locale: string) => new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
const date = (value: string, locale: string) => new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short", timeZone: "America/Lima" }).format(new Date(value));

export default function OrderDetailScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'pt-BR' ? 'pt-BR' : 'es-PE';
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state } = useAccess();
  const { notice, clear } = useOrderResult();
  const [order, setOrder] = useState<OrderAggregateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [checkoutUrl, setCheckoutUrl] = useState("");
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutMessage, setCheckoutMessage] = useState("");
  const checkoutGeneration = useRef(0);
  const [paymentError, setPaymentError] = useState("");
  const [savingPayment, setSavingPayment] = useState<string | null>(null);
  const [fulfilling, setFulfilling] = useState<"ship" | "deliver" | null>(null);
  const [fulfillmentMessage, setFulfillmentMessage] = useState("");
  const [fulfillmentError, setFulfillmentError] = useState("");
  const manualPaymentId = useRef<string | null>(null);
  const loaded = useRef(false);
  const scroll = useRef<ScrollView>(null);
  const paymentPosition = useRef(0);
  const [paymentsOpen, setPaymentsOpen] = useState(false);
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [internalOpen, setInternalOpen] = useState(false);
  const [editor, setEditor] = useState<"manual" | { paymentId: string; receiptImageId: string } | null>(null);
  const companyId = state.status === "ready" ? state.company.id : "";
  const reload = useCallback(async () => {
    setLoading(true);
    const result = await orders.loadOrderAggregate(id);
    if (result.success) { setOrder(result.data); setError(""); loaded.current = true; }
    else setError(result.error.code === "ORDER_NOT_FOUND" ? translations.t('orderNotFound') : translations.t('loadOrderError'));
    setLoading(false);
  }, [id]);
  async function confirmPayment(paymentId: string, source: "manual" | "buyer_report", amountText: string,
    method: "digital_wallet" | "bank_transfer", deductStockIfPartial: boolean) {
    if (!order || savingPayment || fulfilling) return;
    const amount = Number(amountText.replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0 || !/^\d+(?:[.,]\d{1,2})?$/.test(amountText.trim())) {
      setPaymentError(t("invalidPaymentAmount")); return;
    }
    setSavingPayment(paymentId); setPaymentError("");
    const result = await orders.registerPayment(order.id, { paymentId, source, amount: { amount, currency: order.total.currency },
      method, deductStockIfPartial });
    if (result.success) {
      setOrder(result.data.order); setEditor(null); setPaymentsOpen(true);
      if (source === "manual") manualPaymentId.current = null;
    }
    else setPaymentError(result.error.code === "INSUFFICIENT_STOCK" ? t("paymentStockError") : t("paymentSaveError"));
    setSavingPayment(null);
  }
  async function voidPayment(paymentId: string) {
    if (!order || savingPayment || fulfilling) return;
    setSavingPayment(paymentId); setPaymentError("");
    const result = await orders.voidPayment(order.id, paymentId);
    if (result.success) setOrder(result.data);
    else setPaymentError(t("paymentSaveError"));
    setSavingPayment(null);
  }
  async function fulfill(operation: "ship" | "deliver") {
    if (!order || fulfilling || savingPayment || fulfillmentBlock(order, operation)) return;
    setFulfilling(operation); setFulfillmentError(""); setFulfillmentMessage("");
    try {
      const result = await orders[operation](order.id);
      if (result.success) { setOrder(result.data); setFulfillmentMessage(t(`orderFulfillment.${operation}Saved`)); }
      else setFulfillmentError(t(`orderFulfillment.${result.error.code}`, { defaultValue: t("orderFulfillment.saveError") }));
    } catch { setFulfillmentError(t("orderFulfillment.saveError")); }
    finally { setFulfilling(null); }
  }
  async function viewReceipt(imageId: string) {
    const result = await orders.receiptUrl(imageId);
    if (!result.success) { setPaymentError(t("receiptUnavailable")); return; }
    try { await Linking.openURL(result.data); }
    catch { setPaymentError(t("receiptUnavailable")); }
  }
  useFocusEffect(useCallback(() => {
    checkoutGeneration.current += 1;
    setCheckoutUrl(""); setCheckoutMessage("");
    if (companyId) void reload();
    return () => {
      checkoutGeneration.current += 1;
      if (notice?.id === id && loaded.current) { void orders.clearPendingOrderConfirmation(companyId ?? "", id); clear(); }
    };
  }, [companyId, id, notice, clear, reload]));

  async function obtainCheckoutLink() {
    if (checkoutBusy) return;
    const generation = checkoutGeneration.current;
    setCheckoutBusy(true); setCheckoutMessage("");
    try {
      const result = await orders.enableOrderCheckout(id);
      if (generation !== checkoutGeneration.current) return;
      if (result.success) { await reload(); if (generation === checkoutGeneration.current) setCheckoutUrl(result.data.url); }
      else setCheckoutMessage(t("checkoutLinkError"));
    } catch { if (generation === checkoutGeneration.current) setCheckoutMessage(t("checkoutLinkError")); }
    finally { setCheckoutBusy(false); }
  }
  async function copyCheckoutLink() {
    try { setCheckoutMessage(t(await Clipboard.setStringAsync(checkoutUrl) ? "checkoutCopied" : "checkoutCopyManually")); }
    catch { setCheckoutMessage(t("checkoutCopyManually")); }
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
  const canEditDelivery = order.status === "active" && order.deliveryStatus === "pending" && !order.cancelled;
  const checkoutState = t(order.cancelled ? "checkoutCancelled" : order.checkoutConfirmedAt ? "checkoutConfirmed" : order.checkoutEnabledAt ? "checkoutPending" : "checkoutDisabled");
  const openPayments = () => {
    setPaymentsOpen(true);
    scroll.current?.scrollTo({ y: paymentPosition.current, animated: false });
  };
  const openEditor = (value: NonNullable<typeof editor>) => { setPaymentError(""); setEditor(value); };
  const closeEditor = () => { if (!savingPayment) { setEditor(null); setPaymentError(""); } };
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
          <View style={styles.row}>
            <StatusBadge label={t(order.paymentStatus === "paid" ? 'paymentCovered' : 'detailPaymentPending')} tone={order.paymentStatus === "paid" ? "success" : "warning"} />
            <StatusBadge label={delivery} tone={order.deliveryStatus === "delivered" ? "success" : "neutral"} />
          </View>
        </View>
        <View style={[styles.card, styles.customer, cardStyle]}>
          <SymbolView name={{ ios: "person", android: "person" }} size={24} tintColor={theme.textSecondary} />
          <View style={styles.flex}>
            <ThemedText type="small" themeColor="textSecondary">{t('detailBuyer')}</ThemedText>
            <ThemedText>{order.buyer !== null ? order.buyer.name ?? order.buyer.phone : t('generalPublic')}</ThemedText>
            {order.buyer?.name ? <ThemedText type="small" themeColor="textSecondary" selectable>{order.buyer.phone}</ThemedText> : null}
          </View>
        </View>
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
          {order.items.map((item, index) => <View key={item.id} style={[styles.product, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.border }]}>
            <View style={styles.productIdentity}>
              <ThemedText style={styles.semibold}>{item.productName}</ThemedText>
              {Object.entries(item.variantAttributes).length > 0 ? <ThemedText type="small" themeColor="textSecondary">{Object.entries(item.variantAttributes).map(([key, value]) => `${key}: ${value}`).join(" · ")}</ThemedText> : null}
              {item.sku ? <ThemedText type="small" themeColor="textSecondary">SKU {item.sku}</ThemedText> : null}
              <ThemedText type="small" themeColor="textSecondary">{item.quantity} × {format(item.unitPrice)}</ThemedText>
            </View>
            <ThemedText style={styles.amount}>{format(item.subtotal)}</ThemedText>
          </View>)}
        </View>
        <View onLayout={(event) => { paymentPosition.current = event.nativeEvent.layout.y; }} style={[styles.card, styles.section, cardStyle]}>
          <ThemedText type="subtitle" accessibilityRole="header">{t('detailPayment')}</ThemedText>
          <MoneyRow label={t('detailSubtotal')} value={format(order.itemsTotal)} />
          <MoneyRow label={t('detailShippingCharge')} value={format(order.deliveryCharge)} />
          <View style={[styles.divider, { borderColor: theme.border }]} />
          <MoneyRow label={t('detailTotal')} value={format(order.total)} strong />
          <View style={[styles.divider, { borderColor: theme.border }]} />
          <MoneyRow label={t('detailReceived')} value={format(order.paidAmount)} />
          <MoneyRow label={t('detailBalance')} value={format(order.balanceDue)} strong />
          {order.overpaidAmount.amount > 0 ? <ThemedText type="small" style={{ color: theme.warning }}>{t('overpaid', { amount: format(order.overpaidAmount) })}</ThemedText> : null}
          {!order.cancelled && order.balanceDue.amount > 0 ? <Button disabled={!!fulfilling} onPress={() => openEditor("manual")}>{t('detailRegisterPayment')}</Button> : null}
          {paymentError && !editor ? <ThemedText style={{ color: theme.error }} accessibilityRole="alert">{paymentError}</ThemedText> : null}
          {order.payments.length > 0 ? <>
            <Disclosure label={t('detailViewPayments')} open={paymentsOpen} onPress={() => setPaymentsOpen(!paymentsOpen)} />
            {paymentsOpen ? order.payments.map((payment) => {
              const receiptImageId = payment.status === "reported" ? payment.data.receiptImageId
                : payment.data.evidence.kind === "buyer_report" ? payment.data.evidence.report.receiptImageId : null;
              return <View key={payment.id} style={[styles.payment, { borderColor: theme.border }]}>
                <ThemedText style={styles.semibold}>{payment.status === "reported" ? t('paymentReported')
                  : payment.status === "voided" ? t('paymentVoided') : t('detailPaymentConfirmed')}</ThemedText>
                {payment.status !== "reported" ? <MoneyRow label={t(payment.method === "digital_wallet" ? 'wallet' : 'bankTransfer')} value={format(payment.amount)} /> : null}
                <ThemedText type="small" themeColor="textSecondary">{date(payment.status === "reported" ? payment.data.reportedAt : payment.data.confirmedAt, locale)}</ThemedText>
                {receiptImageId ? <Button variant="ghost" onPress={() => void viewReceipt(receiptImageId)}>{t('viewReceipt')}</Button> : null}
                {payment.status === "reported" && !order.cancelled ? <Button variant="secondary" disabled={!!fulfilling} onPress={() => openEditor({ paymentId: payment.id, receiptImageId: payment.data.receiptImageId })}>{t('detailReviewPayment')}</Button> : null}
                {payment.status === "confirmed" ? <Button variant="ghost" disabled={!!savingPayment || !!fulfilling} onPress={() => void voidPayment(payment.id)}>{t('voidPayment')}</Button> : null}
              </View>;
            }) : null}
          </> : null}
        </View>
        <View style={[styles.card, styles.section, cardStyle]}>
          <ThemedText type="subtitle" accessibilityRole="header">{t("delivery")}</ThemedText>
          {(["ship", "deliver"] as const).map(operation => {
            const blocked = fulfillmentBlock(order, operation);
            return <View key={operation} style={styles.heading}>
              <Button variant={operation === "ship" ? "secondary" : "default"} loading={fulfilling === operation} disabled={!!blocked || !!fulfilling || !!savingPayment} onPress={() => void fulfill(operation)}>{t(`orderFulfillment.${operation}`)}</Button>
              {blocked ? <ThemedText type="small" themeColor="textSecondary">{t(`orderFulfillment.${blocked}`)}</ThemedText> : null}
            </View>;
          })}
          {fulfillmentError ? <ThemedText style={{ color: theme.error }} accessibilityRole="alert">{fulfillmentError}</ThemedText> : null}
          {fulfillmentMessage ? <ThemedText accessibilityRole="alert">{fulfillmentMessage}</ThemedText> : null}
        </View>
        {order.delivery || canEditDelivery ? <View style={[styles.card, styles.section, cardStyle]}>
          <View style={styles.sectionHeading}>
            <ThemedText type="subtitle" accessibilityRole="header" style={styles.flex}>{t('delivery')}</ThemedText>
            {canEditDelivery ? <Button variant="ghost" onPress={() => router.push({ pathname: "/orders/delivery", params: { id: order.id } })}>{t(order.delivery ? 'replaceOrderDelivery' : 'assignOrderDelivery')}</Button> : null}
          </View>
          {order.delivery ? <>
            <Disclosure label={deliveryMethodLabel(order.delivery.method, language)} open={deliveryOpen} onPress={() => setDeliveryOpen(!deliveryOpen)}
              description={`${order.delivery.method === "agency" ? order.delivery.courier.name : order.delivery.method === "store" ? order.delivery.pickupPoint.name : order.delivery.destination.district} · ${order.delivery.recipient.name}`} />
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
                <ThemedText>{order.delivery.courier.name}</ThemedText><ThemedText>{order.delivery.agency}</ThemedText>
              </> : null}
              <ThemedText type="small">{t('orderDeliveryCharge', { amount: format(order.deliveryCharge) })}</ThemedText>
              {!canEditDelivery ? <ThemedText type="small" themeColor="textSecondary">{t('orderDeliveryLocked')}</ThemedText> : null}
            </View> : null}
          </> : <ThemedText themeColor="textSecondary">{t('orderDeliveryUndefined')}</ThemedText>}
        </View> : null}
        <View style={[styles.card, styles.section, cardStyle]}>
          <Disclosure label={t('checkoutTitle')} description={checkoutState} open={checkoutOpen} onPress={() => setCheckoutOpen(!checkoutOpen)} />
          {checkoutOpen && !order.cancelled ? <>
            <Button variant="secondary" loading={checkoutBusy} onPress={() => void obtainCheckoutLink()}>{t('getCheckoutLink')}</Button>
            {checkoutUrl ? <><ThemedText selectable>{checkoutUrl}</ThemedText><Button variant="secondary" onPress={() => void copyCheckoutLink()}>{t('copyCheckoutLink')}</Button></> : null}
            {checkoutMessage ? <ThemedText accessibilityRole="alert">{checkoutMessage}</ThemedText> : null}
          </> : null}
        </View>
        <View style={[styles.card, styles.section, cardStyle]}>
          <Disclosure label={t('detailInternal')} open={internalOpen} onPress={() => setInternalOpen(!internalOpen)} />
          {internalOpen ? <>
            <ThemedText type="small">{order.stockDeducted ? t('stockDeducted') : t('stockPending')}</ThemedText>
            <ThemedText type="small" selectable>{t('detailSeller', { id: order.sellerId })}</ThemedText>
            {order.completedAt ? <ThemedText type="small" themeColor="textSecondary">{t('completedOn', { date: date(order.completedAt, locale) })}</ThemedText> : null}
            {order.delivery ? <>
              <ThemedText type="small">{t('orderDeliveryCost', { amount: format(order.deliveryCost) })}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{order.delivery.recordedBy.kind === "seller" ? t('orderDeliverySeller', { id: order.delivery.recordedBy.userId }) : t('orderDeliveryBuyer')}</ThemedText>
            </> : null}
          </> : null}
        </View>
      </ScrollView>
    </View>
    <Modal visible={editor !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={closeEditor}>
      <SafeAreaView style={[styles.page, { backgroundColor: theme.background }]}>
        <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={styles.modalHeader}>
            <ThemedText type="subtitle" accessibilityRole="header" style={styles.flex}>{t(editor === "manual" ? 'detailRegisterPayment' : 'detailReviewPayment')}</ThemedText>
            <Button variant="ghost" disabled={!!savingPayment || !!fulfilling} onPress={closeEditor}>{t('detailClose')}</Button>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
            <ThemedText>{t('balanceDue', { amount: format(order.balanceDue) })}</ThemedText>
            {editor && editor !== "manual" ? <Button variant="secondary" onPress={() => void viewReceipt(editor.receiptImageId)}>{t('viewReceipt')}</Button> : null}
            {editor ? <PaymentEditor key={editor === "manual" ? "manual" : editor.paymentId} currency={order.total.currency} balance={order.balanceDue.amount} busy={!!savingPayment || !!fulfilling} onConfirm={(amount, method, deduct) => {
              if (editor === "manual") {
                manualPaymentId.current ??= Crypto.randomUUID();
                void confirmPayment(manualPaymentId.current, "manual", amount, method, deduct);
              } else void confirmPayment(editor.paymentId, "buyer_report", amount, method, deduct);
            }} /> : null}
            {paymentError ? <ThemedText style={{ color: theme.error }} accessibilityRole="alert">{paymentError}</ThemedText> : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  </SafeAreaView></ThemedView>;
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
  customer: { flexDirection: "row", alignItems: "center", gap: 12 },
  receiptNotice: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth },
  section: { gap: 10 }, sectionHeading: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
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

function PaymentEditor({ currency, balance, busy, onConfirm }: { currency: string; balance: number; busy: boolean;
  onConfirm: (amount: string, method: "digital_wallet" | "bank_transfer", deductStockIfPartial: boolean) => void }) {
  const { t } = useTranslation();
  const [value, setValue] = useState<PaymentFieldsValue>({ amount: balance > 0 ? balance.toFixed(2) : "", method: "digital_wallet", deductStockIfPartial: false });
  return <View style={styles.section}><PaymentFields value={value} onChange={setValue} currency={currency} busy={busy} />
    <Button disabled={busy} loading={busy} onPress={() => onConfirm(value.amount, value.method, value.deductStockIfPartial)}>{t('confirmPayment')}</Button>
  </View>;
}
