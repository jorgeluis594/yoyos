import * as Clipboard from "expo-clipboard";
import { useCallback, useRef, useState } from "react";
import { Linking, ScrollView, StyleSheet, Switch, View } from "react-native";
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
import { Field, FieldLabel } from "@mobile/components/ui/field";
import { Input } from "@mobile/components/ui/input";
import { OptionSelector } from "@mobile/components/ui/option-selector";
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
  const manualPaymentId = useRef<string | null>(null);
  const loaded = useRef(false);
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
    if (!order || savingPayment) return;
    const amount = Number(amountText.replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0 || !/^\d+(?:[.,]\d{1,2})?$/.test(amountText.trim())) {
      setPaymentError(t("invalidPaymentAmount")); return;
    }
    setSavingPayment(paymentId); setPaymentError("");
    const result = await orders.registerPayment(order.id, { paymentId, source, amount: { amount, currency: order.total.currency },
      method, deductStockIfPartial });
    if (result.success) { setOrder(result.data.order); if (source === "manual") manualPaymentId.current = null; }
    else setPaymentError(result.error.code === "INSUFFICIENT_STOCK" ? t("paymentStockError") : t("paymentSaveError"));
    setSavingPayment(null);
  }
  async function voidPayment(paymentId: string) {
    if (!order || savingPayment) return;
    setSavingPayment(paymentId); setPaymentError("");
    const result = await orders.voidPayment(order.id, paymentId);
    if (result.success) setOrder(result.data);
    else setPaymentError(t("paymentSaveError"));
    setSavingPayment(null);
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
  return <ThemedView style={styles.page}><SafeAreaView style={styles.page} edges={["top", "left", "right"]}>
    <ScrollView contentContainerStyle={styles.content}>
      <Button variant="ghost" onPress={() => router.back()}>{t('backToOrders')}</Button>
      <View style={styles.heading}><ThemedText type="title" accessibilityRole="header">{t("orderNumber", { number: order.number })}</ThemedText><ThemedText>{title}</ThemedText>
        <ThemedText themeColor="textSecondary">{t('createdOn', { date: date(order.createdAt, locale) })}</ThemedText>
        {order.completedAt ? <ThemedText themeColor="textSecondary">{t('completedOn', { date: date(order.completedAt, locale) })}</ThemedText> : null}</View>
      <View style={styles.section}>
        <ThemedText type="subtitle" accessibilityRole="header">{t("checkoutTitle")}</ThemedText>
        <ThemedText>{t(order.cancelled ? "checkoutCancelled" : order.checkoutConfirmedAt ? "checkoutConfirmed" : order.checkoutEnabledAt ? "checkoutPending" : "checkoutDisabled")}</ThemedText>
        {!order.cancelled ? <>
          <Button disabled={checkoutBusy} onPress={() => void obtainCheckoutLink()}>{t("getCheckoutLink")}</Button>
          {checkoutUrl ? <><ThemedText selectable>{checkoutUrl}</ThemedText><Button variant="secondary" onPress={() => void copyCheckoutLink()}>{t("copyCheckoutLink")}</Button></> : null}
          {checkoutMessage ? <ThemedText accessibilityRole="alert">{checkoutMessage}</ThemedText> : null}
        </> : null}
      </View>
      <View style={[styles.summary, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="small" themeColor="textSecondary">{t('recordedTotal')}</ThemedText>
        <ThemedText type="title">{money(order.total.amount, order.total.currency, locale)}</ThemedText>
        <ThemedText type="small">{order.paymentStatus === "paid" ? t('paymentCovered') : t('balanceDue', { amount: money(order.balanceDue.amount, order.balanceDue.currency, locale) })} · {delivery}</ThemedText>
        <ThemedText type="small">{order.stockDeducted ? t('stockDeducted') : t('stockPending')}</ThemedText>
        {order.overpaidAmount.amount > 0 ? <ThemedText type="small">{t('overpaid', { amount: money(order.overpaidAmount.amount, order.overpaidAmount.currency, locale) })}</ThemedText> : null}
      </View>
      {changed && original ? <View style={[styles.notice, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="subtitle" accessibilityRole="header">{t('reviewCharge')}</ThemedText>
        <ThemedText>{t('shownAtConfirmation', { amount: money(original.amount, original.currency, locale) })}</ThemedText>
        <ThemedText>{t('recordedTotalAmount', { amount: money(order.total.amount, order.total.currency, locale) })}</ThemedText>
        {difference?.success ? <ThemedText>{t('amountDifference', { amount: money(difference.data.amount, order.total.currency, locale) })}</ThemedText> : null}
        <ThemedText type="small">{t('adjustCharge')}</ThemedText>
      </View> : null}
      <View style={styles.section}><ThemedText type="subtitle" accessibilityRole="header">{t('customer')}</ThemedText>
        <ThemedText>{order.buyer !== null ? order.buyer.name ?? order.buyer.phone : t('generalPublic')}</ThemedText>
        {order.buyer !== null && order.buyer.name ? <ThemedText themeColor="textSecondary">{order.buyer.phone}</ThemedText> : null}
      </View>
      {order.delivery ? <View style={styles.section}><ThemedText type="subtitle" accessibilityRole="header">{t('delivery')}</ThemedText>
        <ThemedText>{deliveryMethodLabel(order.delivery.method, language)}</ThemedText>
        <ThemedText>{order.delivery.recipient.name} · {order.delivery.recipient.phone}</ThemedText>
        {order.delivery.recipient.identity.kind === "document" ? <ThemedText>
          {documentTypeLabel(order.delivery.recipient.identity.documentType, language)}: {order.delivery.recipient.identity.document}
        </ThemedText> : null}
        {order.delivery.method === "store" ? <>
          <ThemedText>{order.delivery.pickupPoint.name}</ThemedText><ThemedText>{order.delivery.pickupPoint.address}</ThemedText>
          {order.delivery.pickupPoint.instructions ? <ThemedText themeColor="textSecondary">{order.delivery.pickupPoint.instructions}</ThemedText> : null}
        </> : null}
        {order.delivery.method === "home" ? <>
          <ThemedText>{order.delivery.destination.address}</ThemedText><ThemedText>{order.delivery.destination.district}</ThemedText>
          {order.delivery.destination.instructions ? <ThemedText themeColor="textSecondary">{order.delivery.destination.instructions}</ThemedText> : null}
        </> : null}
        {order.delivery.method === "agency" ? <>
          <ThemedText>{order.delivery.courier.name}</ThemedText><ThemedText>{order.delivery.agency}</ThemedText>
        </> : null}
        <ThemedText>{t("orderDeliveryCost", { amount: money(order.deliveryCost.amount, order.deliveryCost.currency, locale) })}</ThemedText>
        <ThemedText>{t("orderDeliveryCharge", { amount: money(order.deliveryCharge.amount, order.deliveryCharge.currency, locale) })}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{order.delivery.recordedBy.kind === "seller" ? t("orderDeliverySeller", { id: order.delivery.recordedBy.userId }) : t("orderDeliveryBuyer")}</ThemedText>
      </View> : order.status === "active" && order.deliveryStatus === "pending" && !order.cancelled ? <ThemedText>{t("orderDeliveryUndefined")}</ThemedText> : null}
      {order.status === "active" && order.deliveryStatus === "pending" && !order.cancelled ? <Button variant="secondary" onPress={() => router.push({ pathname: "/orders/delivery", params: { id: order.id } })}>{t(order.delivery ? "replaceOrderDelivery" : "assignOrderDelivery")}</Button> : null}
      <View style={styles.section}><ThemedText type="subtitle" accessibilityRole="header">{t('items')}</ThemedText>
        {order.items.map((item) => <View key={item.id} style={styles.item}>
          <ThemedText type="smallBold">{item.productName}</ThemedText>
          {Object.entries(item.variantAttributes).length ? <ThemedText type="small" themeColor="textSecondary">{Object.entries(item.variantAttributes).map(([key, value]) => `${key}: ${value}`).join(" · ")}</ThemedText> : null}
          {item.sku ? <ThemedText type="small" themeColor="textSecondary">SKU {item.sku}</ThemedText> : null}
          <ThemedText>{item.quantity} × {money(item.unitPrice.amount, item.unitPrice.currency, locale)} = {money(item.subtotal.amount, item.subtotal.currency, locale)}</ThemedText>
        </View>)}
      </View>
      {paymentError ? <ThemedText style={{ color: theme.error }} accessibilityRole="alert">{paymentError}</ThemedText> : null}
      {order.payments.length ? <View style={styles.section}><ThemedText type="subtitle" accessibilityRole="header">{t('payments')}</ThemedText>
        {order.payments.map((payment) => { const receiptImageId = payment.status === "reported" ? payment.data.receiptImageId
          : payment.data.evidence.kind === "buyer_report" ? payment.data.evidence.report.receiptImageId : null;
          return <View key={payment.id} style={styles.payment}><ThemedText>{payment.status === "reported"
            ? `${t('paymentReported')} · ${date(payment.data.reportedAt, locale)}`
            : `${payment.status === "voided" ? `${t('paymentVoided')} · ` : ""}${money(payment.amount.amount, payment.amount.currency, locale)} · ${date(payment.data.confirmedAt, locale)}`}</ThemedText>
            {receiptImageId ? <Button variant="ghost" onPress={() => void viewReceipt(receiptImageId)}>{t('viewReceipt')}</Button> : null}
            {payment.status === "reported" && !order.cancelled ? <PaymentEditor key={`${payment.id}-${order.balanceDue.amount}`} currency={order.total.currency}
              balance={order.balanceDue.amount} busy={!!savingPayment} onConfirm={(amount, method, deduct) =>
                void confirmPayment(payment.id, "buyer_report", amount, method, deduct)} /> : null}
            {payment.status === "confirmed" ? <Button variant="secondary" disabled={!!savingPayment}
              onPress={() => void voidPayment(payment.id)}>{t('voidPayment')}</Button> : null}
          </View>; })}
      </View> : null}
      {!order.cancelled && order.balanceDue.amount > 0 ? <View style={styles.section}><ThemedText type="subtitle" accessibilityRole="header">{t('manualPayment')}</ThemedText>
        <PaymentEditor key={order.balanceDue.amount} currency={order.total.currency} balance={order.balanceDue.amount} busy={!!savingPayment} onConfirm={(amount, method, deduct) => {
          manualPaymentId.current ??= Crypto.randomUUID();
          void confirmPayment(manualPaymentId.current, "manual", amount, method, deduct);
        }} />
      </View> : null}
    </ScrollView>
  </SafeAreaView></ThemedView>;
}

const styles = StyleSheet.create({ page: { flex: 1 }, content: { gap: 24, padding: 16, paddingBottom: 32, maxWidth: 640, width: "100%", alignSelf: "center" },
  heading: { gap: 4 }, summary: { gap: 8, padding: 16 }, notice: { gap: 8, padding: 16 }, section: { gap: 12 }, item: { gap: 4, paddingVertical: 12 },
  payment: { gap: 10, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth } });

function PaymentEditor({ currency, balance, busy, onConfirm }: { currency: string; balance: number; busy: boolean;
  onConfirm: (amount: string, method: "digital_wallet" | "bank_transfer", deductStockIfPartial: boolean) => void }) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState(balance > 0 ? balance.toFixed(2) : "");
  const [method, setMethod] = useState<"digital_wallet" | "bank_transfer">("digital_wallet");
  const [deduct, setDeduct] = useState(false);
  return <View style={styles.section}><Field required><FieldLabel>{t('paymentAmount')} ({currency})</FieldLabel>
      <Input value={amount} onChangeText={setAmount} keyboardType="decimal-pad" /></Field>
    <Field required><FieldLabel>{t('paymentMethod')}</FieldLabel><OptionSelector options={[
      { value: "digital_wallet", label: t('wallet') }, { value: "bank_transfer", label: t('bankTransfer') }]}
      value={method} onValueChange={(value) => { if (value === "digital_wallet" || value === "bank_transfer") setMethod(value); }} /></Field>
    <View style={styles.item}><ThemedText>{t('deductStockIfPartial')}</ThemedText>
      <Switch value={deduct} onValueChange={setDeduct} accessibilityLabel={t('deductStockIfPartial')} /></View>
    <Button disabled={busy} loading={busy} onPress={() => onConfirm(amount, method, deduct)}>{t('confirmPayment')}</Button>
  </View>;
}
