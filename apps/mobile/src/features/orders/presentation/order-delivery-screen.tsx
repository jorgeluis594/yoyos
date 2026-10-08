import { deliveryDraftFromOrder } from "@mobile/features/orders/presentation/delivery-fields";
import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { SetRatedOrderDeliveryRequest, OrderAggregateResponse } from "@shared/contracts/orders";
import type { DeliverySettingsResponse } from "@shared/contracts/delivery-settings";
import { orders } from "@mobile/features/orders/composition";
import { deliverySettings } from "@mobile/features/delivery-settings";
import { useAccess } from "@mobile/features/users/presentation/access-provider";
import { ThemedText } from "@mobile/components/themed-text";
import { ThemedView } from "@mobile/components/themed-view";
import { Button } from "@mobile/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@mobile/components/ui/field";
import { Input } from "@mobile/components/ui/input";
import { OptionSelector } from "@mobile/components/ui/option-selector";
import { ScreenState } from "@mobile/components/ui/screen-state";
import { PeruDistrictSelect } from "@mobile/components/peru-district-select";
import { getPeruDistrict } from "@shared/peru-geography";
import { add, type Money } from "@shared/money";
import type { DeliveryQuotation } from "@mobile/features/delivery-settings";
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
  const { control, reset, getValues, setValue, handleSubmit, formState: { isSubmitting } } = useForm<OrderDeliveryFormValues, unknown, SetRatedOrderDeliveryRequest>({
    resolver: zodResolver(orderDeliveryFormSchema),
    defaultValues: { method: "store", rateId: "", price: null, currency: "PEN", address: "", districtCode: "", instructions: "",
      name: "", phone: "", documentType: "absent", document: "" },
  });
  const [method, districtCode, rateId, documentType] = useWatch({ control, name: ["method", "districtCode", "rateId", "documentType"] });
  const [quoteResult, setQuoteResult] = useState<{ key: string; quotation: DeliveryQuotation | null; error: string } | null>(null);
  const [quoteAttempt, setQuoteAttempt] = useState(0);
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
      const { name, phone, documentType, document, method, address, instructions } = deliveryDraftFromOrder(current, config.data);
      const destination = current.delivery && "pricing" in current.delivery ? current.delivery.destination : null;
      reset({ name, phone, documentType, document, method, address, instructions, currency: current.total.currency,
        districtCode: destination?.districtCode ?? "", rateId: "", price: null });
    } else setError(!aggregate.success && aggregate.error.code === "ORDER_NOT_FOUND" ? "orderNotFound" : "loadOrderDeliveryError");
    inFlight.current = false; setLoading(false);
  }, [companyId, id, reset]);
  useEffect(() => { if (companyId && !initialized.current) { initialized.current = true; void load(); } }, [companyId, load]);
  const refreshSettings = useCallback(async () => {
    if (!companyId || inFlight.current) return;
    inFlight.current = true; setLoading(true);
    const result = await deliverySettings.get();
    if (result.success) { setSettings(result.data); setError(""); setQuoteAttempt(value => value + 1); }
    else setError("loadOrderDeliveryError");
    inFlight.current = false; setLoading(false);
  }, [companyId]);
  useFocusEffect(useCallback(() => {
    if (!companyId) return;
    if (focused.current) void refreshSettings();
    else focused.current = true;
  }, [companyId, refreshSettings]));
  const enabled = method === "store" ? settings?.store.enabled : method === "home" ? settings?.home.enabled : method === "agency" ? settings?.agency.enabled : false;
  const canQuote = !!order && (method === "home" || method === "agency") && !!districtCode && !!enabled && !locked;
  const requestKey = `${companyId}/${id}/${method}/${districtCode}/${quoteAttempt}/${settings?.version}`;
  const quotation = canQuote && quoteResult?.key === requestKey ? quoteResult.quotation : null;
  const quoteError = canQuote && quoteResult?.key === requestKey ? quoteResult.error : "";
  const quoting = canQuote && quoteResult?.key !== requestKey;
  useEffect(() => {
    if (!canQuote) return;
    let active = true;
    void deliverySettings.createQuotation(districtCode).then(result => {
      if (!active) return;
      setValue("rateId", ""); setValue("price", null);
      setQuoteResult({ key: requestKey, quotation: result.success ? result.data : null, error: result.success ? "" : "orderQuotationError" });
    });
    return () => { active = false; };
  }, [canQuote, districtCode, requestKey, setValue]);
  const rates = quotation?.districtCode === districtCode ? quotation.rates.filter(rate => rate.method === method) : [];
  const selectedRate = rates.find(rate => rate.id === rateId);
  const price = method === "store" && order ? { amount: 0, currency: order.total.currency } : selectedRate?.price;
  const shownTotal = order && price ? add(price)(order.itemsTotal) : null;
  const selectionReady = (method === "store" || !!selectedRate) && shownTotal?.success === true;
  const save = async (request: SetRatedOrderDeliveryRequest) => {
    if (inFlight.current || locked || !enabled || !selectionReady || quoting) return;
    inFlight.current = true; setError("");
    const result = await orders.setDelivery(id, request);
    if (result.success) { reset(getValues()); setOrder(result.data); router.back(); }
    else {
      const code = result.error.code;
      if (["TOTAL_CHANGED", "RATE_UNAVAILABLE", "INVALID_DELIVERY_RATE", "COURIER_UNAVAILABLE", "DELIVERY_METHOD_DISABLED"].includes(code)) {
        const latest = await deliverySettings.get();
        if (latest.success) setSettings(latest.data);
        setQuoteAttempt(value => value + 1);
      }
      if (code === "DELIVERY_LOCKED" || code === "ORDER_CANCELLED" || code === "INVALID_TRANSITION") setLocked(true);
      setError(code === "TOTAL_CHANGED" ? "orderDeliveryPriceChanged"
        : code === "RATE_UNAVAILABLE" || code === "INVALID_DELIVERY_RATE" ? "orderDeliveryRateUnavailable"
        : code === "DELIVERY_UNAVAILABLE" ? "orderDeliveryUnavailable"
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
  const point = settings.store.pickupPoint;
  const language = orderLanguage(state.company.country, i18n.language);
  const formatPrice = (price: Money) => new Intl.NumberFormat(i18n.language === "pt-BR" ? "pt-BR" : "es-PE", { style: "currency", currency: price.currency }).format(price.amount);
  return <ThemedView style={styles.page}><SafeAreaView style={styles.page} edges={["top", "left", "right"]}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      <Button variant="ghost" onPress={() => router.back()} disabled={busy}>{t("backToOrder")}</Button>
      <ThemedText type="title" accessibilityRole="header">{t(order.delivery ? "replaceOrderDelivery" : "assignOrderDelivery")}</ThemedText>
      {locked ? (!error ? <ThemedText>{t("orderDeliveryLocked")}</ThemedText> : null) : !settings.store.enabled && !settings.home.enabled && !settings.agency.enabled ? <View style={styles.section}>
        <ThemedText>{t("orderDeliveryDisabled")}</ThemedText><Button variant="secondary" onPress={() => router.push("/settings/delivery")}>{t("configureOrderDelivery")}</Button>
      </View> : <>
        <Controller control={control} name="method" render={({ field, fieldState }) => (
          <Field disabled={busy} invalid={fieldState.invalid}><FieldLabel>{t("orderDeliveryMethod")}</FieldLabel><OptionSelector testID="delivery-method" value={enabled ? field.value : null}
          onValueChange={method => { field.onChange(method); setValue("rateId", ""); setValue("price", null); setQuoteAttempt(value => value + 1); }} options={[
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
          <Controller control={control} name="instructions" render={({ field, fieldState }) => (
          <Field disabled={busy} invalid={fieldState.invalid}><FieldLabel>{t("orderDeliveryInstructions")}</FieldLabel><Input ref={field.ref} value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} maxLength={1000} multiline accessibilityLabel={t("orderDeliveryInstructions")} />{fieldState.error ? <FieldError>{t(fieldState.error.message ?? "invalidOrderDelivery")}</FieldError> : null}</Field>
        )} />
        </FieldGroup> : null}
        {method !== "store" ? <View style={styles.section}>
          <Controller control={control} name="districtCode" render={({ field }) => <PeruDistrictSelect value={getPeruDistrict(field.value)?.code ?? null}
            disabled={busy} onChange={code => field.onChange(code ?? "")} />} />
          {quoting ? <ThemedText accessibilityLiveRegion="polite">{t("orderQuotationLoading")}</ThemedText> : null}
          {quoteError ? <ThemedText accessibilityRole="alert">{t(quoteError)}</ThemedText> : null}
          {!quoting && quotation && rates.length === 0 ? <ThemedText>{t("orderQuotationEmpty")}</ThemedText> : null}
          {rates.length > 0 ? <Field disabled={busy || quoting} required><FieldLabel>{t("orderDeliveryRate")}</FieldLabel>
            <OptionSelector testID="delivery-rate" value={selectedRate?.id ?? null} options={rates.map(rate => ({ value: rate.id,
              label: rate.price.amount === 0 ? t("zonesFree") : formatPrice(rate.price) }))}
              onValueChange={id => { const rate = rates.find(rate => rate.id === id); setValue("rateId", rate?.id ?? ""); setValue("price", rate?.price ?? null); }} />
          </Field> : null}
          {districtCode && !quoting ? <Button variant="secondary" disabled={busy} onPress={() => setQuoteAttempt(value => value + 1)}>{t("orderQuotationRetry")}</Button> : null}
        </View> : null}
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
        <ThemedText type="small" themeColor="textSecondary">{t("orderRatedDeliveryHint")}</ThemedText>
        <ThemedText>{t("orderDeliveryProductsAmount", { amount: formatPrice(order.itemsTotal) })}</ThemedText>
        {price && shownTotal?.success ? <><ThemedText>{t("orderDeliveryAmount", { amount: formatPrice(price) })}</ThemedText>
          <ThemedText>{t("orderDeliveryTotalAmount", { amount: formatPrice(shownTotal.data) })}</ThemedText></> : null}
        <Button onPress={() => void handleSubmit(save)()} loading={busy} disabled={busy || !enabled || !selectionReady || quoting}>{t("saveOrderDelivery")}</Button>
      </>}
      {error ? <ThemedText accessibilityRole="alert" style={{ color: theme.error }}>{t(error)}</ThemedText> : null}
    </ScrollView>
  </SafeAreaView></ThemedView>;
}
const styles = StyleSheet.create({ page: { flex: 1 }, content: { gap: 24, padding: 16, paddingBottom: 32, maxWidth: 640, width: "100%", alignSelf: "center" },
  section: { gap: 8 } });
