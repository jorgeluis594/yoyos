import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Switch, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { setOrderDeliverySchema, type OrderAggregateResponse } from "@shared/contracts/orders";
import type { DeliverySettingsResponse } from "@shared/contracts/delivery-settings";
import { orders } from "@mobile/features/orders/composition";
import { deliverySettings } from "@mobile/features/delivery-settings/composition";
import { useAccess } from "@mobile/features/users/presentation/access-provider";
import { ThemedText } from "@mobile/components/themed-text";
import { ThemedView } from "@mobile/components/themed-view";
import { Button } from "@mobile/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@mobile/components/ui/field";
import { Input } from "@mobile/components/ui/input";
import { OptionSelector } from "@mobile/components/ui/option-selector";
import { ScreenState } from "@mobile/components/ui/screen-state";
import { useTheme } from "@mobile/hooks/use-theme";
import { documentTypeLabel, orderLanguage } from "@mobile/features/orders/presentation/order-labels";

type DocumentType = "absent" | "national_id" | "passport" | "foreign_id";
export default function OrderDeliveryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const { state } = useAccess();
  const theme = useTheme();
  const companyId = state.status === "ready" ? state.company.id : "";
  const [order, setOrder] = useState<OrderAggregateResponse | null>(null);
  const [settings, setSettings] = useState<DeliverySettingsResponse | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [documentType, setDocumentType] = useState<DocumentType>("absent");
  const [document, setDocument] = useState("");
  const [charge, setCharge] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [locked, setLocked] = useState(false);
  const inFlight = useRef(false);
  const initialized = useRef(false);
  const focused = useRef(false);
  const load = useCallback(async () => {
    if (!companyId || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    const [aggregate, config] = await Promise.all([orders.loadOrderAggregate(id), deliverySettings.get()]);
    if (aggregate.success && config.success) {
      const current = aggregate.data;
      setOrder(current); setSettings(config.data); setError("");
      setLocked(current.status !== "active" || current.cancelled || current.deliveryStatus !== "pending");
      const recipient = current.delivery?.recipient;
      setName(recipient?.name ?? (current.customer.kind === "contact" ? current.customer.name ?? "" : ""));
      setPhone(recipient?.phone ?? (current.customer.kind === "contact" ? current.customer.phone : ""));
      setDocumentType(recipient?.identity.kind === "document" ? recipient.identity.documentType : "absent");
      setDocument(recipient?.identity.kind === "document" ? recipient.identity.document : "");
      setCharge(current.deliveryCharge.amount > 0);
    } else setError(!aggregate.success && aggregate.error.code === "ORDER_NOT_FOUND" ? "orderNotFound" : "loadOrderDeliveryError");
    inFlight.current = false; setBusy(false);
  }, [companyId, id]);
  useEffect(() => { if (companyId && !initialized.current) { initialized.current = true; void load(); } }, [companyId, load]);
  const refreshSettings = useCallback(async () => {
    if (!companyId || inFlight.current) return;
    inFlight.current = true; setBusy(true);
    const result = await deliverySettings.get();
    if (result.success) { setSettings(result.data); setError(""); }
    else setError("loadOrderDeliveryError");
    inFlight.current = false; setBusy(false);
  }, [companyId]);
  useFocusEffect(useCallback(() => {
    if (!companyId) return;
    if (focused.current) void refreshSettings();
    else focused.current = true;
  }, [companyId, refreshSettings]));
  const save = async () => {
    if (inFlight.current || locked || !settings?.store.enabled) return;
    const parsed = setOrderDeliverySchema.safeParse({ delivery: { method: "store", recipient: { name, phone,
      identity: documentType === "absent" ? { kind: "absent" } : { kind: "document", documentType, document } } }, chargeDeliveryToCustomer: charge });
    if (!parsed.success) { setError("invalidOrderDelivery"); return; }
    inFlight.current = true; setBusy(true); setError("");
    const result = await orders.setDelivery(id, parsed.data);
    if (result.success) { setOrder(result.data); router.back(); }
    else {
      const code = result.error.code;
      if (code === "DELIVERY_LOCKED" || code === "ORDER_CANCELLED" || code === "INVALID_TRANSITION") setLocked(true);
      setError(code === "DELIVERY_UNAVAILABLE" ? "orderDeliveryUnavailable"
        : code === "DELIVERY_METHOD_DISABLED" ? "orderDeliveryDisabled"
        : code === "INSUFFICIENT_STOCK" ? "insufficientStock"
        : code === "DELIVERY_LOCKED" || code === "ORDER_CANCELLED" || code === "INVALID_TRANSITION" ? "orderDeliveryLocked"
        : code === "INVALID_INPUT" ? "invalidOrderDelivery" : "saveOrderDeliveryError");
    }
    inFlight.current = false; setBusy(false);
  };
  if (state.status !== "ready") return null;
  if (!order || !settings) return busy ? <ScreenState status="loading" title={t("loadingOrderDelivery")} />
    : <ScreenState status="error" title={t("loadOrderDeliveryError")} description={error === "loadOrderDeliveryError" ? undefined : t(error)} onRetry={() => void load()} />;
  const language = orderLanguage(state.company.country, i18n.language);
  const point = settings.store.pickupPoint;
  return <ThemedView style={styles.page}><SafeAreaView style={styles.page} edges={["top", "left", "right"]}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      <Button variant="ghost" onPress={() => router.back()} disabled={busy}>{t("backToOrder")}</Button>
      <ThemedText type="title" accessibilityRole="header">{t(order.delivery ? "replaceOrderDelivery" : "assignOrderDelivery")}</ThemedText>
      {locked ? (!error ? <ThemedText>{t("orderDeliveryLocked")}</ThemedText> : null) : !settings.store.enabled ? <View style={styles.section}>
        <ThemedText>{t("orderDeliveryDisabled")}</ThemedText><Button variant="secondary" onPress={() => router.push("/settings/delivery")}>{t("configureOrderDelivery")}</Button>
      </View> : <>
        <View style={styles.section}><ThemedText type="subtitle">{t("pickupStoreTitle")}</ThemedText>
          <ThemedText>{point?.name}</ThemedText><ThemedText>{point?.address}</ThemedText>
          {point?.instructions ? <ThemedText themeColor="textSecondary">{point.instructions}</ThemedText> : null}</View>
        <FieldGroup><Field required disabled={busy}><FieldLabel>{t("deliveryRecipientName")}</FieldLabel><Input value={name} onChangeText={setName} accessibilityLabel={t("deliveryRecipientName")} /></Field>
          <Field required disabled={busy}><FieldLabel>{t("deliveryRecipientPhone")}</FieldLabel><Input value={phone} onChangeText={setPhone} keyboardType="phone-pad" accessibilityLabel={t("deliveryRecipientPhone")} /></Field>
          <Field disabled={busy}><FieldLabel>{t("deliveryDocumentType")}</FieldLabel><OptionSelector value={documentType} onValueChange={value => setDocumentType((value ?? "absent") as DocumentType)}
            options={[{ value: "absent", label: t("deliveryNoDocument") }, ...(["national_id", "passport", "foreign_id"] as const).map(value => ({ value, label: documentTypeLabel(value, language) }))]} /></Field>
          {documentType !== "absent" ? <Field required disabled={busy}><FieldLabel>{t("deliveryDocument")}</FieldLabel><Input value={document} onChangeText={setDocument} accessibilityLabel={t("deliveryDocument")} /></Field> : null}</FieldGroup>
        <View style={styles.toggle}><ThemedText style={styles.label}>{t("chargeOrderDelivery")}</ThemedText><Switch value={charge} disabled={busy} hitSlop={10} trackColor={{ true: theme.primary }} accessibilityLabel={t("chargeOrderDelivery")} onValueChange={setCharge} /></View>
        <ThemedText type="small" themeColor="textSecondary">{t("orderDeliveryCostHint")}</ThemedText>
        <Button onPress={() => void save()} loading={busy} disabled={busy}>{t("saveOrderDelivery")}</Button>
      </>}
      {error ? <ThemedText accessibilityRole="alert" style={{ color: theme.error }}>{t(error)}</ThemedText> : null}
    </ScrollView>
  </SafeAreaView></ThemedView>;
}
const styles = StyleSheet.create({ page: { flex: 1 }, content: { gap: 24, padding: 16, paddingBottom: 32, maxWidth: 640, width: "100%", alignSelf: "center" },
  section: { gap: 8 }, toggle: { flexDirection: "row", alignItems: "center", gap: 16, minHeight: 48 }, label: { flex: 1 } });
