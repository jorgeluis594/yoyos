import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Switch, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { SetOrderDeliveryRequest, OrderAggregateResponse } from "@shared/contracts/orders";
import type { DeliverySettingsResponse } from "@shared/contracts/delivery-settings";
import { orders } from "@mobile/features/orders/composition";
import { deliverySettings } from "@mobile/features/delivery-settings/composition";
import { useAccess } from "@mobile/features/users/presentation/access-provider";
import { ThemedText } from "@mobile/components/themed-text";
import { ThemedView } from "@mobile/components/themed-view";
import { Button } from "@mobile/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@mobile/components/ui/field";
import { Input } from "@mobile/components/ui/input";
import { OptionSelector } from "@mobile/components/ui/option-selector";
import { ScreenState } from "@mobile/components/ui/screen-state";
import { useTheme } from "@mobile/hooks/use-theme";
import { documentTypeLabel, orderLanguage } from "@mobile/features/orders/presentation/order-labels";
import { orderDeliveryFormSchema, type OrderDeliveryFormValues } from "@mobile/features/orders/presentation/order-delivery-form";

export default function OrderDeliveryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const { state } = useAccess();
  const theme = useTheme();
  const companyId = state.status === "ready" ? state.company.id : "";
  const [order, setOrder] = useState<OrderAggregateResponse | null>(null);
  const [settings, setSettings] = useState<DeliverySettingsResponse | null>(null);
  const { control, reset, getValues, handleSubmit, formState: { isSubmitting } } = useForm<OrderDeliveryFormValues, unknown, SetOrderDeliveryRequest>({
    resolver: zodResolver(orderDeliveryFormSchema),
    defaultValues: { method: "store", courierId: "", agency: "", address: "", district: "", instructions: "",
      name: "", phone: "", documentType: "absent", document: "", charge: false },
  });
  const [method, courierId, documentType] = useWatch({ control, name: ["method", "courierId", "documentType"] });
  const [loading, setLoading] = useState(true);
  const busy = loading || isSubmitting;
  const [error, setError] = useState("");
  const [locked, setLocked] = useState(false);
  const inFlight = useRef(false);
  const initialized = useRef(false);
  const focused = useRef(false);
  const load = useCallback(async () => {
    if (!companyId || inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    const [aggregate, config] = await Promise.all([orders.loadOrderAggregate(id), deliverySettings.get()]);
    if (aggregate.success && config.success) {
      const current = aggregate.data;
      setOrder(current); setSettings(config.data); setError("");
      setLocked(current.status !== "active" || current.cancelled || current.deliveryStatus !== "pending");
      const recipient = current.delivery?.recipient;
      const destination = current.delivery?.method === "home" ? current.delivery.destination : null;
      reset({
        name: recipient?.name ?? current.buyer?.name ?? "",
        phone: recipient?.phone ?? current.buyer?.phone ?? "",
        documentType: recipient?.identity.kind === "document" ? recipient.identity.documentType : "absent",
        document: recipient?.identity.kind === "document" ? recipient.identity.document : "",
        charge: current.deliveryCharge.amount > 0,
        method: current.delivery?.method ?? (config.data.store.enabled ? "store" : config.data.home.enabled ? "home" : config.data.agency.enabled ? "agency" : "store"),
        courierId: current.delivery?.method === "agency" ? current.delivery.courier.id : "",
        agency: current.delivery?.method === "agency" ? current.delivery.agency : "",
        address: destination?.address ?? "", district: destination?.district ?? "", instructions: destination?.instructions ?? "",
      });
    } else setError(!aggregate.success && aggregate.error.code === "ORDER_NOT_FOUND" ? "orderNotFound" : "loadOrderDeliveryError");
    inFlight.current = false; setLoading(false);
  }, [companyId, id, reset]);
  useEffect(() => { if (companyId && !initialized.current) { initialized.current = true; void load(); } }, [companyId, load]);
  const refreshSettings = useCallback(async () => {
    if (!companyId || inFlight.current) return;
    inFlight.current = true; setLoading(true);
    const result = await deliverySettings.get();
    if (result.success) { setSettings(result.data); setError(""); }
    else setError("loadOrderDeliveryError");
    inFlight.current = false; setLoading(false);
  }, [companyId]);
  useFocusEffect(useCallback(() => {
    if (!companyId) return;
    if (focused.current) void refreshSettings();
    else focused.current = true;
  }, [companyId, refreshSettings]));
  const enabled = method === "store" ? settings?.store.enabled : method === "home" ? settings?.home.enabled : method === "agency" ? settings?.agency.enabled : false;
  const activeCouriers = settings?.couriers.filter(courier => courier.enabled) ?? [];
  const courierAvailable = activeCouriers.some(courier => courier.id === courierId);
  const save = async (request: SetOrderDeliveryRequest) => {
    if (inFlight.current || locked || !enabled || (method === "agency" && !courierAvailable)) return;
    inFlight.current = true; setError("");
    const result = await orders.setDelivery(id, request);
    if (result.success) { reset(getValues()); setOrder(result.data); router.back(); }
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
    inFlight.current = false;
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
        <Controller control={control} name="method" render={({ field, fieldState }) => (
          <Field disabled={busy} invalid={fieldState.invalid}><FieldLabel>{t("orderDeliveryMethod")}</FieldLabel><OptionSelector testID="delivery-method" value={enabled ? field.value : null}
          onValueChange={field.onChange} options={[
            ...(settings.store.enabled ? [{ value: "store", label: t("pickupStoreTitle") }] : []),
            ...(settings.home.enabled ? [{ value: "home", label: t("homeDeliveryTitle") }] : []),
            ...(settings.agency.enabled ? [{ value: "agency", label: t("agencyDeliveryTitle") }] : []),
          ]} />{fieldState.error ? <FieldError>{t(fieldState.error.message ?? "invalidOrderDelivery")}</FieldError> : null}</Field>
        )} />
        {!enabled ? <ThemedText>{t("orderDeliveryDisabled")}</ThemedText> : null}
        {method === "store" ? <View style={styles.section}><ThemedText type="subtitle" accessibilityRole="header">{t("pickupStoreTitle")}</ThemedText>
          <ThemedText>{point?.name}</ThemedText><ThemedText>{point?.address}</ThemedText>
          {point?.instructions ? <ThemedText themeColor="textSecondary">{point.instructions}</ThemedText> : null}</View> : method === "home" ? <FieldGroup>
          <Controller control={control} name="address" render={({ field, fieldState }) => (
          <Field required disabled={busy} invalid={fieldState.invalid}><FieldLabel>{t("orderDeliveryAddress")}</FieldLabel><Input ref={field.ref} value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} maxLength={500} multiline accessibilityLabel={t("orderDeliveryAddress")} />{fieldState.error ? <FieldError>{t(fieldState.error.message ?? "invalidOrderDelivery")}</FieldError> : null}</Field>
        )} />
          <Controller control={control} name="district" render={({ field, fieldState }) => (
          <Field required disabled={busy} invalid={fieldState.invalid}><FieldLabel>{t("orderDeliveryDistrict")}</FieldLabel><Input ref={field.ref} value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} maxLength={120} accessibilityLabel={t("orderDeliveryDistrict")} />{fieldState.error ? <FieldError>{t(fieldState.error.message ?? "invalidOrderDelivery")}</FieldError> : null}</Field>
        )} />
          <Controller control={control} name="instructions" render={({ field, fieldState }) => (
          <Field disabled={busy} invalid={fieldState.invalid}><FieldLabel>{t("orderDeliveryInstructions")}</FieldLabel><Input ref={field.ref} value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} maxLength={1000} multiline accessibilityLabel={t("orderDeliveryInstructions")} />{fieldState.error ? <FieldError>{t(fieldState.error.message ?? "invalidOrderDelivery")}</FieldError> : null}</Field>
        )} />
        </FieldGroup> : method === "agency" ? <FieldGroup>
          <Controller control={control} name="courierId" render={({ field, fieldState }) => (
          <Field required disabled={busy} invalid={fieldState.invalid}><FieldLabel>{t("orderDeliveryCourier")}</FieldLabel><OptionSelector testID="delivery-courier" value={courierAvailable ? field.value : null} onValueChange={value => field.onChange(value ?? "")} options={activeCouriers.map(courier => ({ value: courier.id, label: courier.name }))} />{fieldState.error ? <FieldError>{t(fieldState.error.message ?? "invalidOrderDelivery")}</FieldError> : null}</Field>
        )} />
          <Controller control={control} name="agency" render={({ field, fieldState }) => (
          <Field required disabled={busy} invalid={fieldState.invalid}><FieldLabel>{t("orderDeliveryAgency")}</FieldLabel><Input ref={field.ref} value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} maxLength={500} multiline accessibilityLabel={t("orderDeliveryAgency")} />{fieldState.error ? <FieldError>{t(fieldState.error.message ?? "invalidOrderDelivery")}</FieldError> : null}</Field>
        )} />
        </FieldGroup> : null}
        <FieldGroup><Controller control={control} name="name" render={({ field, fieldState }) => (
          <Field required disabled={busy} invalid={fieldState.invalid}><FieldLabel>{t("deliveryRecipientName")}</FieldLabel><Input ref={field.ref} value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} accessibilityLabel={t("deliveryRecipientName")} />{fieldState.error ? <FieldError>{t(fieldState.error.message ?? "invalidOrderDelivery")}</FieldError> : null}</Field>
        )} />
          <Controller control={control} name="phone" render={({ field, fieldState }) => (
          <Field required disabled={busy} invalid={fieldState.invalid}><FieldLabel>{t("deliveryRecipientPhone")}</FieldLabel><Input ref={field.ref} value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} keyboardType="phone-pad" accessibilityLabel={t("deliveryRecipientPhone")} />{fieldState.error ? <FieldError>{t(fieldState.error.message ?? "invalidOrderDelivery")}</FieldError> : null}</Field>
        )} />
          <Controller control={control} name="documentType" render={({ field, fieldState }) => (
          <Field required={method === "agency"} disabled={busy} invalid={fieldState.invalid}><FieldLabel>{t("deliveryDocumentType")}</FieldLabel><OptionSelector testID="delivery-document-type" value={method === "agency" && field.value === "absent" ? null : field.value} onValueChange={value => field.onChange(value ?? "absent")}
            options={[...(method === "agency" ? [] : [{ value: "absent", label: t("deliveryNoDocument") }]), ...(["national_id", "passport", "foreign_id"] as const).map(value => ({ value, label: documentTypeLabel(value, language) }))]} />{fieldState.error ? <FieldError>{t(fieldState.error.message ?? "invalidOrderDelivery")}</FieldError> : null}</Field>
        )} />
          {documentType !== "absent" ? <Controller control={control} name="document" render={({ field, fieldState }) => (
          <Field required disabled={busy} invalid={fieldState.invalid}><FieldLabel>{t("deliveryDocument")}</FieldLabel><Input ref={field.ref} value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} accessibilityLabel={t("deliveryDocument")} />{fieldState.error ? <FieldError>{t(fieldState.error.message ?? "invalidOrderDelivery")}</FieldError> : null}</Field>
        )} /> : null}</FieldGroup>
        <View style={styles.toggle}><ThemedText style={styles.label}>{t("chargeOrderDelivery")}</ThemedText><Controller control={control} name="charge" render={({ field }) => <Switch value={field.value} disabled={busy} hitSlop={10} trackColor={{ true: theme.primary }} accessibilityLabel={t("chargeOrderDelivery")} onValueChange={field.onChange} />} /></View>
        <ThemedText type="small" themeColor="textSecondary">{t("orderDeliveryCostHint")}</ThemedText>
        <Button onPress={() => void handleSubmit(save)()} loading={busy} disabled={busy || !enabled || (method === "agency" && !courierAvailable)}>{t("saveOrderDelivery")}</Button>
      </>}
      {error ? <ThemedText accessibilityRole="alert" style={{ color: theme.error }}>{t(error)}</ThemedText> : null}
    </ScrollView>
  </SafeAreaView></ThemedView>;
}
const styles = StyleSheet.create({ page: { flex: 1 }, content: { gap: 24, padding: 16, paddingBottom: 32, maxWidth: 640, width: "100%", alignSelf: "center" },
  section: { gap: 8 }, toggle: { flexDirection: "row", alignItems: "center", gap: 16, minHeight: 48 }, label: { flex: 1 } });
