import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Switch, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { setOrderDeliverySchema, type SetOrderDeliveryRequest, type OrderAggregateResponse } from "@shared/contracts/orders";
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
  const [method, setMethod] = useState<SetOrderDeliveryRequest["delivery"]["method"] | null>("store");
  const [courierId, setCourierId] = useState("");
  const [agency, setAgency] = useState("");
  const [address, setAddress] = useState("");
  const [district, setDistrict] = useState("");
  const [instructions, setInstructions] = useState("");
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
      setName(recipient?.name ?? (current.buyer?.name ?? ""));
      setPhone(recipient?.phone ?? (current.buyer?.phone ?? ""));
      setDocumentType(recipient?.identity.kind === "document" ? recipient.identity.documentType : "absent");
      setDocument(recipient?.identity.kind === "document" ? recipient.identity.document : "");
      setCharge(current.deliveryCharge.amount > 0);
      setMethod(current.delivery?.method ?? (config.data.store.enabled ? "store" : config.data.home.enabled ? "home" : config.data.agency.enabled ? "agency" : "store"));
      setCourierId(current.delivery?.method === "agency" ? current.delivery.courier.id : "");
      setAgency(current.delivery?.method === "agency" ? current.delivery.agency : "");
      const destination = current.delivery?.method === "home" ? current.delivery.destination : null;
      setAddress(destination?.address ?? ""); setDistrict(destination?.district ?? ""); setInstructions(destination?.instructions ?? "");
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
  const enabled = method === "store" ? settings?.store.enabled : method === "home" ? settings?.home.enabled : method === "agency" ? settings?.agency.enabled : false;
  const activeCouriers = settings?.couriers.filter(courier => courier.enabled) ?? [];
  const courierAvailable = activeCouriers.some(courier => courier.id === courierId);
  const save = async () => {
    if (inFlight.current || locked || !enabled || (method === "agency" && !courierAvailable)) return;
    const recipient = { name, phone, identity: documentType === "absent" ? { kind: "absent" } : { kind: "document", documentType, document } };
    const delivery = method === "store" ? { method, recipient } : method === "home" ? { method, recipient, destination: { address, district, instructions: instructions.trim() || null } } : { method, recipient, courierId, agency };
    const parsed = setOrderDeliverySchema.safeParse({ delivery, chargeDeliveryToCustomer: charge });
    if (!parsed.success) { setError(method === "home" && (!address.trim() || !district.trim()) ? "invalidHomeDestination" : method === "agency" ? "invalidAgencyDelivery" : "invalidOrderDelivery"); return; }
    inFlight.current = true; setBusy(true); setError("");
    const result = await orders.setDelivery(id, parsed.data);
    if (result.success) { setOrder(result.data); router.back(); }
    else {
      const code = result.error.code;
      if (code === "COURIER_UNAVAILABLE" || code === "DELIVERY_METHOD_DISABLED") {
        const latest = await deliverySettings.get();
        if (latest.success) setSettings(latest.data);
      }
      if (code === "DELIVERY_LOCKED" || code === "ORDER_CANCELLED" || code === "INVALID_TRANSITION") setLocked(true);
      setError(code === "DELIVERY_UNAVAILABLE" ? "orderDeliveryUnavailable"
        : code === "DELIVERY_METHOD_DISABLED" ? "orderDeliveryDisabled"
        : code === "COURIER_UNAVAILABLE" ? "orderCourierUnavailable"
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
      {locked ? (!error ? <ThemedText>{t("orderDeliveryLocked")}</ThemedText> : null) : !settings.store.enabled && !settings.home.enabled && !settings.agency.enabled ? <View style={styles.section}>
        <ThemedText>{t("orderDeliveryDisabled")}</ThemedText><Button variant="secondary" onPress={() => router.push("/settings/delivery")}>{t("configureOrderDelivery")}</Button>
      </View> : <>
        <Field disabled={busy}><FieldLabel>{t("orderDeliveryMethod")}</FieldLabel><OptionSelector testID="delivery-method" value={enabled ? method : null}
          onValueChange={value => setMethod(value as SetOrderDeliveryRequest["delivery"]["method"] | null)} options={[
            ...(settings.store.enabled ? [{ value: "store", label: t("pickupStoreTitle") }] : []),
            ...(settings.home.enabled ? [{ value: "home", label: t("homeDeliveryTitle") }] : []),
            ...(settings.agency.enabled ? [{ value: "agency", label: t("agencyDeliveryTitle") }] : []),
          ]} /></Field>
        {!enabled ? <ThemedText>{t("orderDeliveryDisabled")}</ThemedText> : null}
        {method === "store" ? <View style={styles.section}><ThemedText type="subtitle" accessibilityRole="header">{t("pickupStoreTitle")}</ThemedText>
          <ThemedText>{point?.name}</ThemedText><ThemedText>{point?.address}</ThemedText>
          {point?.instructions ? <ThemedText themeColor="textSecondary">{point.instructions}</ThemedText> : null}</View> : method === "home" ? <FieldGroup>
          <Field required disabled={busy}><FieldLabel>{t("orderDeliveryAddress")}</FieldLabel><Input value={address} onChangeText={setAddress} maxLength={500} multiline accessibilityLabel={t("orderDeliveryAddress")} /></Field>
          <Field required disabled={busy}><FieldLabel>{t("orderDeliveryDistrict")}</FieldLabel><Input value={district} onChangeText={setDistrict} maxLength={120} accessibilityLabel={t("orderDeliveryDistrict")} /></Field>
          <Field disabled={busy}><FieldLabel>{t("orderDeliveryInstructions")}</FieldLabel><Input value={instructions} onChangeText={setInstructions} maxLength={1000} multiline accessibilityLabel={t("orderDeliveryInstructions")} /></Field>
        </FieldGroup> : method === "agency" ? <FieldGroup>
          <Field required disabled={busy}><FieldLabel>{t("orderDeliveryCourier")}</FieldLabel><OptionSelector testID="delivery-courier" value={courierAvailable ? courierId : null} onValueChange={value => setCourierId(value ?? "")} options={activeCouriers.map(courier => ({ value: courier.id, label: courier.name }))} /></Field>
          <Field required disabled={busy}><FieldLabel>{t("orderDeliveryAgency")}</FieldLabel><Input value={agency} onChangeText={setAgency} maxLength={500} multiline accessibilityLabel={t("orderDeliveryAgency")} /></Field>
        </FieldGroup> : null}
        <FieldGroup><Field required disabled={busy}><FieldLabel>{t("deliveryRecipientName")}</FieldLabel><Input value={name} onChangeText={setName} accessibilityLabel={t("deliveryRecipientName")} /></Field>
          <Field required disabled={busy}><FieldLabel>{t("deliveryRecipientPhone")}</FieldLabel><Input value={phone} onChangeText={setPhone} keyboardType="phone-pad" accessibilityLabel={t("deliveryRecipientPhone")} /></Field>
          <Field required={method === "agency"} disabled={busy}><FieldLabel>{t("deliveryDocumentType")}</FieldLabel><OptionSelector testID="delivery-document-type" value={method === "agency" && documentType === "absent" ? null : documentType} onValueChange={value => setDocumentType((value ?? "absent") as DocumentType)}
            options={[...(method === "agency" ? [] : [{ value: "absent", label: t("deliveryNoDocument") }]), ...(["national_id", "passport", "foreign_id"] as const).map(value => ({ value, label: documentTypeLabel(value, language) }))]} /></Field>
          {documentType !== "absent" ? <Field required disabled={busy}><FieldLabel>{t("deliveryDocument")}</FieldLabel><Input value={document} onChangeText={setDocument} accessibilityLabel={t("deliveryDocument")} /></Field> : null}</FieldGroup>
        <View style={styles.toggle}><ThemedText style={styles.label}>{t("chargeOrderDelivery")}</ThemedText><Switch value={charge} disabled={busy} hitSlop={10} trackColor={{ true: theme.primary }} accessibilityLabel={t("chargeOrderDelivery")} onValueChange={setCharge} /></View>
        <ThemedText type="small" themeColor="textSecondary">{t("orderDeliveryCostHint")}</ThemedText>
        <Button onPress={() => void save()} loading={busy} disabled={busy || !enabled || (method === "agency" && !courierAvailable)}>{t("saveOrderDelivery")}</Button>
      </>}
      {error ? <ThemedText accessibilityRole="alert" style={{ color: theme.error }}>{t(error)}</ThemedText> : null}
    </ScrollView>
  </SafeAreaView></ThemedView>;
}
const styles = StyleSheet.create({ page: { flex: 1 }, content: { gap: 24, padding: 16, paddingBottom: 32, maxWidth: 640, width: "100%", alignSelf: "center" },
  section: { gap: 8 }, toggle: { flexDirection: "row", alignItems: "center", gap: 16, minHeight: 48 }, label: { flex: 1 } });
