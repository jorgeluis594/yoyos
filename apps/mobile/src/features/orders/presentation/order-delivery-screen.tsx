import { DeliveryFields, deliveryDraftFromOrder } from "@mobile/features/orders/presentation/delivery-fields";
import { prepareDelivery, type DraftDelivery } from "@mobile/features/orders/domain/order-draft";
import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import type { OrderAggregateResponse } from "@shared/contracts/orders";
import type { DeliverySettingsResponse } from "@shared/contracts/delivery-settings";
import { orders } from "@mobile/features/orders/composition";
import { deliverySettings } from "@mobile/features/delivery-settings/composition";
import { useAccess } from "@mobile/features/users/presentation/access-provider";
import { ThemedText } from "@mobile/components/themed-text";
import { ThemedView } from "@mobile/components/themed-view";
import { Button } from "@mobile/components/ui/button";
import { ScreenState } from "@mobile/components/ui/screen-state";
import { useTheme } from "@mobile/hooks/use-theme";
import { orderLanguage } from "@mobile/features/orders/presentation/order-labels";


export default function OrderDeliveryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const { state } = useAccess();
  const theme = useTheme();
  const companyId = state.status === "ready" ? state.company.id : "";
  const [order, setOrder] = useState<OrderAggregateResponse | null>(null);
  const [settings, setSettings] = useState<DeliverySettingsResponse | null>(null);
  const [value, setValue] = useState<DraftDelivery>({ method: "store", courierId: "", agency: "", address: "", district: "", instructions: "", name: "", phone: "", documentType: "absent", document: "", charge: false });
  const { method, courierId, address, district } = value;
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
      setValue(deliveryDraftFromOrder(current, config.data));
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
    const parsed = prepareDelivery(value);
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
  return <ThemedView style={styles.page}><SafeAreaView style={styles.page} edges={["top", "left", "right"]}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      <Button variant="ghost" onPress={() => router.back()} disabled={busy}>{t("backToOrder")}</Button>
      <ThemedText type="title" accessibilityRole="header">{t(order.delivery ? "replaceOrderDelivery" : "assignOrderDelivery")}</ThemedText>
      {locked ? (!error ? <ThemedText>{t("orderDeliveryLocked")}</ThemedText> : null) : !settings.store.enabled && !settings.home.enabled && !settings.agency.enabled ? <View style={styles.section}>
        <ThemedText>{t("orderDeliveryDisabled")}</ThemedText><Button variant="secondary" onPress={() => router.push("/settings/delivery")}>{t("configureOrderDelivery")}</Button>
      </View> : <>
        <DeliveryFields value={value} onChange={setValue} settings={settings} busy={busy} language={language} />
        <Button onPress={() => void save()} loading={busy} disabled={busy || !enabled || (method === "agency" && !courierAvailable)}>{t("saveOrderDelivery")}</Button>
      </>}
      {error ? <ThemedText accessibilityRole="alert" style={{ color: theme.error }}>{t(error)}</ThemedText> : null}
    </ScrollView>
  </SafeAreaView></ThemedView>;
}
const styles = StyleSheet.create({ page: { flex: 1 }, content: { gap: 24, padding: 16, paddingBottom: 32, maxWidth: 640, width: "100%", alignSelf: "center" },
  section: { gap: 8 }, toggle: { flexDirection: "row", alignItems: "center", gap: 16, minHeight: 48 }, label: { flex: 1 } });
