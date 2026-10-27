import { OrderItemsCard } from "@mobile/features/orders/presentation/order-items-card";
import { OrderPaymentCard } from "@mobile/features/orders/presentation/order-payment-card";
import { usePendingOrders } from "@mobile/features/orders/presentation/pending-order-sync-provider";
import { OptionSelector } from "@mobile/components/ui/option-selector";
import { Field, FieldLabel } from "@mobile/components/ui/field";
import { DeliveryFields, deliveryDraftFromOrder } from "@mobile/features/orders/presentation/delivery-fields";
import { deliverySettings } from "@mobile/features/delivery-settings";
import type { DeliveryQuotation } from "@mobile/features/delivery-settings";
import { orderDeliveryFormSchema, type OrderDeliveryFormValues } from "@mobile/features/orders/presentation/order-delivery-form";
import type { DeliverySettingsResponse } from "@shared/contracts/delivery-settings";
import { orderLanguage } from "@mobile/features/orders/presentation/order-labels";
import type { Result } from "@shared/result";
import { add, subtract, type Money, type MoneyError } from "@shared/money";
import { andThen, ok } from "@shared/functional";
import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { usePreventRemove } from "expo-router/react-navigation";
import * as Crypto from "expo-crypto";
import * as Network from "expo-network";
import { z } from "zod";
import { orderCatalogSchema } from "@shared/contracts/orders";
import { orders } from "@mobile/features/orders/composition";
import { ThemedText } from "@mobile/components/themed-text";
import { ThemedView } from "@mobile/components/themed-view";
import { Button } from "@mobile/components/ui/button";
import { Input } from "@mobile/components/ui/input";
import { OrderDayField } from "@mobile/features/orders/presentation/order-day-field";
import { ListRow } from "@mobile/components/ui/list-row";
import { ScreenState } from "@mobile/components/ui/screen-state";
import { showConfirmation } from "@mobile/components/ui/show-confirmation";
import { useAccess } from "@mobile/features/users/presentation/access-provider";
import { addDraftItem, changeDraftQuantity, emptyOrderDraft, prepareOrder, removeDraftItem, type RatedDeliveryAssignment,
  type OrderDraft } from "@mobile/features/orders/domain/order-draft";
import type { ConfirmOrderOutcome, ConfirmOrderError } from "@mobile/features/orders/application/order-operations";
import { useOrderDraft } from "@mobile/features/orders/presentation/order-draft-guard";
import { useOrderResult } from "@mobile/features/orders/presentation/order-result";
import { useTheme } from "@mobile/hooks/use-theme";
import translations from "@mobile/i18n";

type Catalog = z.infer<typeof orderCatalogSchema>;
const money = (amount: number, currency: string, locale: string) => new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
const errorKeys: Record<string, string> = {
  TOTAL_CHANGED: 'orderDeliveryPriceChanged', RATE_UNAVAILABLE: 'orderDeliveryRateUnavailable', INVALID_DELIVERY_RATE: 'orderDeliveryRateUnavailable', INVALID_DISTRICT: 'invalidHomeDestination',
  INSUFFICIENT_STOCK: 'insufficientStock', VARIANT_NOT_FOUND: 'variantNotFound',
  CURRENCY_MISMATCH: 'currencyMismatch',
  INVALID_ORDER: 'invalidOrder', INVALID_PAYMENT: 'invalidOrder', PAYMENT_REQUIRED: 'immediateRequirements',
  DELIVERY_UNAVAILABLE: 'orderDeliveryUnavailable', DELIVERY_METHOD_DISABLED: 'orderDeliveryDisabled', PENDING_STORAGE_UNAVAILABLE: 'pendingStorageUnavailable',
  INVALID_PENDING_DATA: 'invalidPendingData', PENDING_CONFIRMATION: 'pendingConfirmation',
};

export default function NewOrderScreen() {
  const { state } = useAccess();
  return state.status === "ready" ? <CompanyOrderScreen key={state.company.id} /> : null;
}

function CompanyOrderScreen() {
  const router = useRouter();
  const theme = useTheme();
  const scroll = useRef<ScrollView>(null);
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'pt-BR' ? 'pt-BR' : 'es-PE';
  const navigation = useNavigation();
  const network = Network.useNetworkState();
  const { state } = useAccess();
  const { dirty, setDirty, discardVersion } = useOrderDraft();
  const { show } = useOrderResult();
  const [draft, setDraft] = useState<OrderDraft>(emptyOrderDraft);
  const [stage, setStage] = useState<"products" | "review">("products");
  const [paidPaymentId, setPaidPaymentId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [catalog, setCatalog] = useState<Catalog>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [selected, setSelected] = useState<Catalog[number] | null>(null);
  const { pending, refresh: refreshPending, trigger: syncPending } = usePendingOrders();
  const [reviewingOrder, setReviewingOrder] = useState(false);
  const [unavailableVariants, setUnavailableVariants] = useState<readonly string[]>([]);
  const [unavailableLabels, setUnavailableLabels] = useState<Readonly<Record<string, string>>>({});
  const [checking, setChecking] = useState(false);
  const [queuedNotice, setQueuedNotice] = useState(false);
  const [sending, setSending] = useState(false);
  const [settings, setSettings] = useState<DeliverySettingsResponse | null>(null);
  const [initialDelivery, setInitialDelivery] = useState<OrderDeliveryFormValues | null>(null);
  const [quoteResult, setQuoteResult] = useState<{ key: string; quotation: DeliveryQuotation | null; error: boolean } | null>(null);
  const [quoteAttempt, setQuoteAttempt] = useState(0);
  const saving = useRef(false);
  const [error, setError] = useState("");
  const [problemVariantId, setProblemVariantId] = useState<string | null>(null);
  const [problemCode, setProblemCode] = useState<string | null>(null);
  const leaveAllowed = useRef(false);
  const version = useRef(discardVersion);
  const companyId = state.status === "ready" ? state.company.id : "";
  const activeCompany = useRef(companyId);
  const offline = network.isConnected === false || network.isInternetReachable === false;
  const productTotal = prepareOrder({ ...draft, payments: undefined, ratedDelivery: undefined });
  const method = initialDelivery?.method;
  const districtCode = initialDelivery?.districtCode ?? "";
  const deliveryEnabled = !!method && !!settings?.[method].enabled;
  const canQuote = !!initialDelivery && deliveryEnabled && (method === "home" || method === "agency") && !!districtCode;
  const requestKey = `${companyId}/${method}/${districtCode}/${quoteAttempt}/${settings?.version}`;
  const quotation = canQuote && quoteResult?.key === requestKey ? quoteResult.quotation : null;
  const quoting = canQuote && quoteResult?.key !== requestKey;
  const quoteError = canQuote && quoteResult?.key === requestKey && quoteResult.error;
  const rates = quotation?.districtCode === districtCode ? quotation.rates.filter(rate => rate.method === method) : [];
  const selectedRate = rates.find(rate => rate.id === initialDelivery?.rateId);
  const deliverySelection = initialDelivery ? orderDeliveryFormSchema.safeParse({ ...initialDelivery,
    currency: productTotal.success ? productTotal.data.shownTotal.currency : initialDelivery.currency,
    price: selectedRate?.price ?? null,
  }) : null;
  const agencyChosen = selectedRate?.method === "agency" && selectedRate.agencies.some(agency => agency.id === initialDelivery?.agencyId);
  const ratedDelivery = deliveryEnabled && !quoting && deliverySelection?.success && (method === "store" || (selectedRate && (method !== "agency" || agencyChosen))) ? deliverySelection.data : undefined;
  const saveDraft = { ...draft, ratedDelivery };
  const prepared = prepareOrder(saveDraft);
  const deliveryReady = !initialDelivery || !!ratedDelivery;
  const reviewedPrice = initialDelivery && deliveryEnabled && productTotal.success
    ? method === "store" ? { amount: 0, currency: productTotal.data.shownTotal.currency } : selectedRate?.price
    : undefined;
  const reviewedTotal = productTotal.success && (!initialDelivery || reviewedPrice)
    ? reviewedPrice ? add(reviewedPrice)(productTotal.data.shownTotal) : ok(productTotal.data.shownTotal) : null;
  const retryQuotation = () => {
    setInitialDelivery(current => current ? { ...current, rateId: "", agencyId: "", price: null } : null);
    setQuoteAttempt(value => value + 1);
  };
  const paymentDraft = prepareOrder({ ...draft, ratedDelivery: undefined });
  const paidAmount = paymentDraft.success ? (paymentDraft.data.request.payments ?? []).reduce(
    (sum, payment) => andThen(sum, current => add(payment.amount)(current)),
    ok({ amount: 0, currency: paymentDraft.data.shownTotal.currency }) as Result<Money, MoneyError>,
  ) : null;
  const currency = productTotal.success ? productTotal.data.shownTotal.currency : "";
  const orderTotal = reviewedTotal?.success ? reviewedTotal.data : productTotal.success ? productTotal.data.shownTotal : null;
  const card = { backgroundColor: theme.backgroundElement, borderColor: theme.border };
  const balance = paidAmount?.success && reviewedTotal?.success ? subtract(paidAmount.data)(reviewedTotal.data) : null;

  useEffect(() => {
    if (error && stage === "review") scroll.current?.scrollToEnd({ animated: false });
  }, [error, stage]);
  useEffect(() => {
    if (!canQuote) return;
    let active = true;
    void deliverySettings.createQuotation(districtCode).then(result => {
      if (active) setQuoteResult({ key: requestKey, quotation: result.success ? result.data : null, error: !result.success });
    });
    return () => { active = false; };
  }, [canQuote, districtCode, requestKey]);
  useEffect(() => {
    activeCompany.current = companyId;
    let active = true;
    if (companyId) void deliverySettings.get().then(result => { if (active) setSettings(result.success ? result.data : null); });
    return () => { active = false; activeCompany.current = ""; };
  }, [companyId]);
  useEffect(() => {
    if (draft.kind === "empty") leaveAllowed.current = false;
    setDirty((draft.kind === "items" || reviewingOrder) && !leaveAllowed.current);
  }, [draft, reviewingOrder, setDirty]);
  useEffect(() => () => setDirty(false), [setDirty]);
  useEffect(() => {
    if (version.current === discardVersion) return;
    version.current = discardVersion;
    leaveAllowed.current = true;
    setDraft(emptyOrderDraft());
    setStage("products"); setPaidPaymentId(null);
    setInitialDelivery(null);
    setReviewingOrder(false); setUnavailableVariants([]);
    setQuoteAttempt(value => value + 1);
  }, [discardVersion]);
  usePreventRemove(dirty, ({ data }) => {
    if (leaveAllowed.current) { navigation.dispatch(data.action); return; }
    showConfirmation({ title: t('discardOrder'), description: t('discardOrderHint'),
      confirmLabel: t('discard'), cancelLabel: t('keepEditing'), destructive: true,
      onConfirm: () => { leaveAllowed.current = true; setDirty(false); navigation.dispatch(data.action); } });
  });

  useEffect(() => {
    if (!companyId || stage !== "products") return;
    let active = true;
    const timer = setTimeout(() => { void orders.searchOrderCatalog(search.trim()).then((result) => {
      if (!active) return;
      setCatalogLoading(false);
      if (result.success) { setCatalog(result.data.filter((product) => product.variants.length)); setError(""); }
      else setError(translations.t('searchProductsError'));
    }); }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [companyId, search, stage]);

  const openCompleted = (outcome: Extract<ConfirmOrderOutcome, { kind: "completed" }>) => {
    leaveAllowed.current = true;
    setDirty(false);
    show({ id: outcome.order.id, shownTotal: outcome.shownTotal });
    router.replace(`/orders/${outcome.order.id}`);
  };
  const performSave = async (work: () => Promise<Result<ConfirmOrderOutcome, ConfirmOrderError>>) => {
    if (saving.current) return;
    saving.current = true;
    setSending(true);
    try {
      const connection = await Network.getNetworkStateAsync().catch(() => null);
      if (connection?.isConnected === false || connection?.isInternetReachable === false) { setError(t('offlineDraftSaved')); return; }
      const result = await work();
      if (activeCompany.current !== companyId) return;
      if (!result.success) {
        setError(translations.t(errorKeys[result.error.code] ?? 'confirmOrderError'));
        if (["TOTAL_CHANGED", "RATE_UNAVAILABLE", "INVALID_DELIVERY_RATE", "INVALID_DISTRICT", "DELIVERY_METHOD_DISABLED"].includes(result.error.code)) {
          setQuoteResult(null);
          const latest = await deliverySettings.get();
          if (activeCompany.current !== companyId) return;
          if (latest.success) setSettings(latest.data);
          retryQuotation();
        }
        setProblemVariantId("issues" in result.error ? result.error.issues?.find(issue => issue.variantId)?.variantId ?? null : null);
        setProblemCode(result.error.code);
        void refreshPending();
        return;
      }
      if (result.data.kind === "completed") { openCompleted(result.data); return; }
      // Core may not have it yet: the sale waits on the phone under its own ID and the sync sends it, so it never duplicates.
      startNewSale(); setQueuedNotice(true);
      void refreshPending(); syncPending();
    } finally { saving.current = false; setSending(false); }
  };
  const complete = () => { if (deliveryReady && prepared.success && !unavailableVariants.length)
    return performSave(reviewingOrder ? () => orders.reviewPendingOrder(companyId, saveDraft) : () => orders.completeOrder(saveDraft, companyId)); };
  const startNewSale = () => {
    leaveAllowed.current = true;
    setDraft(emptyOrderDraft()); setStage("products"); setPaidPaymentId(null); setInitialDelivery(null);
    setReviewingOrder(false); setUnavailableVariants([]); setUnavailableLabels({}); setError(""); setProblemVariantId(null); setProblemCode(null);
    scroll.current?.scrollTo({ y: 0, animated: true });
  };
  const restoreDelivery = (selection: RatedDeliveryAssignment["delivery"], currency: Money["currency"]) => {
    const recipient = selection.recipient;
    setInitialDelivery({ method: selection.method, name: recipient.name, phone: recipient.phone,
      documentType: recipient.identity.kind === "document" ? recipient.identity.documentType : "absent",
      document: recipient.identity.kind === "document" ? recipient.identity.document : "",
      address: selection.method === "home" ? selection.destination.address : "",
      instructions: selection.method === "home" ? selection.destination.instructions ?? "" : "",
      districtCode: "", rateId: "", agencyId: "", price: null, currency });
    setQuoteAttempt(value => value + 1);
  };
  const reviewSavedOrder = async (id: string) => {
    if (checking || sending) return;
    setChecking(true);
    const result = await orders.loadPendingOrderReview(companyId, id);
    if (activeCompany.current !== companyId) return;
    setChecking(false);
    if (!result.success) { setError(translations.t(errorKeys[result.error.code] ?? 'reviewSaleUnavailable')); return; }
    if (result.data.kind === "completed") { void refreshPending(); openCompleted(result.data); return; }
    if (result.data.kind !== "review") return;
    setDraft(result.data.draft); setQueuedNotice(false);
    setUnavailableVariants(result.data.unavailableVariantIds); setUnavailableLabels(result.data.unavailableLabels ?? {});
    setReviewingOrder(true); setStage("review"); setPaidPaymentId(null); setError("");
    const delivery = result.data.pending.request.delivery?.delivery;
    if (delivery) restoreDelivery(delivery, result.data.pending.shownTotal.currency);
    else setInitialDelivery(null);
  };
  const addVariant = (product: Catalog[number], variant: Catalog[number]["variants"][number]) => {
    const result = addDraftItem(draft, { variantId: variant.id, productName: product.name, variantAttributes: variant.attributes,
      sku: variant.sku, shownUnitPrice: { amount: variant.price, currency: product.currency }, shownStock: variant.stock, quantity: 1 },
      () => Crypto.randomUUID());
    if (result.success) { setDraft(result.data); setSelected(null); setError(""); setQueuedNotice(false); }
    else setError(variant.stock === 0 ? t('outOfStock') : t('variantAlreadyAdded'));
  };
  const changeQuantity = (variantId: string, quantity: number) => {
    const result = changeDraftQuantity(draft, variantId, quantity);
    if (result.success) { setDraft(result.data); setError(""); }
    else setError(t('quantityError'));
  };

  const backToProducts = () => { setCatalogLoading(true); setStage("products"); scroll.current?.scrollTo({ y: 0, animated: false }); };
  const showDeliveryFields = () => {
    if (!settings) return;
    const { name, phone, documentType, document, method, address, instructions } = deliveryDraftFromOrder({ delivery: null,
      buyer: null,
      deliveryCharge: { amount: 0, currency: "PEN" } }, settings);
    setInitialDelivery({ name, phone, documentType, document, method, address, instructions, rateId: "", agencyId: "", price: null, districtCode: "",
      currency: productTotal.success ? productTotal.data.shownTotal.currency : "PEN" });
    setQuoteAttempt(value => value + 1);
  };

  const rejected = pending?.success ? pending.data.filter(sale => sale.rejection) : [];
  const discardUnreadable = () => { void orders.discardPendingOrderConfirmation(companyId).then((result) => {
    if (result.success) { void refreshPending(); syncPending(); setError(""); }
    else setError(translations.t('pendingStorageUnavailable'));
  }); };

  if (state.status !== "ready") return null;

  return <ThemedView style={styles.page}><SafeAreaView style={styles.page} edges={["top", "left", "right"]}>
    <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === "ios" ? "padding" : undefined}>
    <View testID="new-order-viewport" style={styles.page}>
    <ScrollView ref={scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag" contentInsetAdjustmentBehavior="never">
      <View style={styles.heading}><Button variant="ghost" onPress={stage === "review" ? backToProducts : () => router.back()}>{t(stage === "review" ? 'editProducts' : 'backToOrders')}</Button>
        <ThemedText type="title" accessibilityRole="header">{t('newOrder')}</ThemedText></View>
      {queuedNotice ? <ThemedText type="small" accessibilityRole="alert" accessibilityLiveRegion="polite">{t('saleQueued')}</ThemedText> : null}
      {pending && !pending.success ? <View style={[styles.card, card]}>
          <ThemedText type="smallBold" accessibilityRole="header">{t('pendingReadError')}</ThemedText>
          {pending.error.code === "INVALID_PENDING_DATA" ? <>
            <ThemedText type="small" themeColor="textSecondary">{t('discardInvalidAttemptHint')}</ThemedText>
            <Button variant="secondary" onPress={discardUnreadable}>{t('discardInvalidAttempt')}</Button>
          </> : <Button variant="secondary" onPress={() => void refreshPending()}>{t('retry')}</Button>}
        </View> : null}
      {!reviewingOrder ? rejected.map(sale => <View key={sale.id} testID="rejected-sale" style={[styles.card, card]}>
          <ThemedText type="smallBold" accessibilityRole="header">{t('rejectedSale')}</ThemedText>
          <ThemedText type="small">{sale.rejection?.code === "VARIANT_NOT_FOUND" && sale.rejection.variantId && sale.itemLabels?.[sale.rejection.variantId]
            ? translations.t('itemNoLongerAvailable', { name: sale.itemLabels[sale.rejection.variantId] })
            : translations.t(errorKeys[sale.rejection?.code ?? ""] ?? 'confirmOrderError')}</ThemedText>
          <View style={styles.amountRow}><ThemedText>{t('itemCount', { count: sale.request.items.reduce((count, item) => count + item.quantity, 0) })}</ThemedText>
            <ThemedText style={styles.amount}>{money(sale.shownTotal.amount, sale.shownTotal.currency, locale)}</ThemedText></View>
          <Button variant="secondary" loading={checking} disabled={sending || draft.kind === "items"} onPress={() => void reviewSavedOrder(sale.id)}>{t('reviewRejectedSale')}</Button>
        </View>) : null}
      {stage === "products" ? <View style={styles.section}>
            <Input value={search} onChangeText={(value) => { setCatalogLoading(true); setSearch(value); }} accessibilityLabel={t('searchProductsByName')} placeholder={t('searchProductsByName')} />
            {catalogLoading ? <ScreenState status="loading" title={t('searchingProducts')} /> : selected ? <View style={styles.section}>
              <Button variant="ghost" onPress={() => setSelected(null)}>{t('backToProducts')}</Button>
              <ThemedText type="subtitle">{selected.name}</ThemedText>
              {selected.variants.map((variant) => <View key={variant.id} style={styles.item}>
                <ThemedText type="smallBold">{Object.entries(variant.attributes).map(([key, value]) => `${key}: ${value}`).join(" · ") || variant.sku || t('variant')}</ThemedText>
                <ThemedText>{money(variant.price, selected.currency, locale)} · {t('stockCount', { count: variant.stock })}</ThemedText>
                <Button variant="secondary" disabled={draft.items.some((item) => item.variantId === variant.id)} onPress={() => addVariant(selected, variant)}>{t('add')}</Button>
              </View>)}
            </View> : catalog.length ? catalog.map((product) => <ListRow key={product.id} title={product.name}
              description={t('variantCount', { count: product.variants.length })} onPress={() => setSelected(product)} />)
              : <ScreenState status={search ? "no-results" : "empty"} title={search ? t('noProductsFound') : t('noProductsAvailable')} />}
            <ThemedText type="subtitle" accessibilityRole="header" style={[styles.sectionHeading, { borderColor: theme.border }]}>{t('items')}</ThemedText>
            {unavailableVariants.map((variantId, index) => <View key={variantId} style={styles.item}>
              <ThemedText accessibilityRole="alert">{unavailableLabels[variantId] ? t('itemNoLongerAvailable', { name: unavailableLabels[variantId] }) : t('savedProductUnavailable', { number: index + 1 })}</ThemedText>
              <Button variant="ghost" onPress={() => setUnavailableVariants(current => current.filter(id => id !== variantId))}>{t('removeUnavailableProduct', { number: index + 1 })}</Button>
            </View>)}
            {draft.items.map((item) => <View key={item.variantId} style={styles.item}>
              <ThemedText type="smallBold">{item.productName}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{Object.entries(item.variantAttributes).map(([key, value]) => `${key}: ${value}`).join(" · ")} · {t('stockCount', { count: item.shownStock })}</ThemedText>
              <ThemedText>{money(item.shownUnitPrice.amount, item.shownUnitPrice.currency, locale)} × {item.quantity}</ThemedText>
              {item.quantity > item.shownStock ? <ThemedText themeColor="textSecondary">{t('creationStockWarning')}</ThemedText> : null}
              {problemVariantId === item.variantId ? <ThemedText accessibilityRole="alert">{problemCode === "VARIANT_NOT_FOUND" ? t('itemNoLongerAvailable', { name: Object.values(item.variantAttributes).join(" / ") || item.productName }) : t('reviewVariant')}</ThemedText> : null}
              <View style={styles.row}><Button variant="secondary" disabled={item.quantity <= 1} onPress={() => changeQuantity(item.variantId, item.quantity - 1)}>−</Button>
                <Button variant="secondary" onPress={() => changeQuantity(item.variantId, item.quantity + 1)}>+</Button>
                <Button variant="ghost" onPress={() => setDraft(removeDraftItem(draft, item.variantId))}>{t('remove')}</Button></View>
            </View>)}
            {productTotal.success ? <View style={styles.amountRow}><ThemedText>{t('estimatedProductsLabel')}</ThemedText><ThemedText style={styles.amount}>{money(productTotal.data.shownTotal.amount, productTotal.data.shownTotal.currency, locale)}</ThemedText></View> : null}
            <Button disabled={draft.kind === "empty" || !!unavailableVariants.length} onPress={() => { setStage("review"); setError(""); scroll.current?.scrollTo({ y: 0, animated: false }); }}>{t('continueOrder')}</Button>
          </View> : <View style={styles.section}>
            <OrderItemsCard items={draft.items} total={productTotal.success ? money(productTotal.data.shownTotal.amount, productTotal.data.shownTotal.currency, locale) : null}
              format={(amount, currency) => money(amount, currency, locale)} onEdit={backToProducts} />
            {unavailableVariants.length ? <ThemedText accessibilityRole="alert">{t('savedProductsNeedReview')}</ThemedText> : null}
            <OrderPaymentCard payments={draft.payments ?? []} paidPaymentId={paidPaymentId} onPaidChange={setPaidPaymentId}
              currency={currency} busy={sending} newId={() => Crypto.randomUUID()} format={amount => money(amount, currency, locale)}
              total={orderTotal ? orderTotal.amount : null} balance={orderTotal ? money(orderTotal.amount, orderTotal.currency, locale) : null}
              onPaymentsChange={update => setDraft(current => ({ ...current, payments: update(current.payments ?? []) }))} />
            <View style={[styles.card, card]}>
            <ThemedText type="subtitle" accessibilityRole="header">{t('delivery')}</ThemedText>
            <Field disabled={sending}><FieldLabel>{t('deliveryStatus')}</FieldLabel><OptionSelector testID="delivery-status" value={draft.deliverImmediately ? "delivered" : "pending"}
              options={[{ value: "pending", label: t('deliveryPending') }, { value: "delivered", label: t('deliveryDelivered') }]}
              onValueChange={value => setDraft(current => ({ ...current, deliverImmediately: value === "delivered" }))} /></Field>
            <OrderDayField label={t('scheduledDispatch')} value={draft.scheduledDispatchDate ?? ""}
              onChange={day => setDraft(current => ({ ...current, scheduledDispatchDate: day || undefined }))} />
            {settings && (initialDelivery || settings.home.enabled || settings.store.enabled || settings.agency.enabled) ? <>
              <Button variant="ghost" disabled={sending} onPress={() => {
                if (initialDelivery) { setInitialDelivery(null); setQuoteAttempt(value => value + 1); }
                else showDeliveryFields();
              }}>{t(initialDelivery ? 'removeShippingDetails' : 'shippingDetails')}</Button>
              {initialDelivery ? <DeliveryFields value={initialDelivery} onChange={next => {
                if (next.method !== initialDelivery.method || next.districtCode !== initialDelivery.districtCode) setQuoteAttempt(value => value + 1);
                setInitialDelivery(next);
              }} settings={settings} busy={sending} language={orderLanguage(state.company.country, i18n.language)}
                rates={rates} quoting={quoting} quoteError={quoteError} onRetry={retryQuotation} /> : null}
            </> : <ThemedText themeColor="textSecondary">{t(settings ? 'orderDeliveryDisabled' : 'loadOrderDeliveryError')}</ThemedText>}
            {draft.deliverImmediately && balance?.success && balance.data.amount > 0
              ? <ThemedText accessibilityRole="alert" style={{ color: theme.error }}>{t('deliveryNeedsPayment')}</ThemedText> : null}
            {draft.deliverImmediately && draft.items.some(item => item.quantity > item.shownStock)
              ? <ThemedText accessibilityRole="alert" style={{ color: theme.error }}>{t('deliveryNeedsStock')}</ThemedText> : null}
            </View>
            <View style={[styles.card, card]}>
            <ThemedText type="subtitle" accessibilityRole="header">{t('creationSummary')}</ThemedText>
            {productTotal.success ? <View style={styles.amountRow}><ThemedText>{t('estimatedProductsLabel')}</ThemedText><ThemedText style={styles.amount}>{money(productTotal.data.shownTotal.amount, productTotal.data.shownTotal.currency, locale)}</ThemedText></View> : null}
            {reviewedPrice && reviewedTotal?.success ? <><View style={styles.amountRow}><ThemedText>{t('delivery')}</ThemedText><ThemedText style={styles.amount}>{money(reviewedPrice.amount, reviewedPrice.currency, locale)}</ThemedText></View>
              <View style={styles.amountRow}><ThemedText>{t('totalLabel')}</ThemedText><ThemedText style={styles.amount}>{money(reviewedTotal.data.amount, reviewedTotal.data.currency, locale)}</ThemedText></View></> : null}
            {paidAmount?.success ? <View style={styles.amountRow}><ThemedText>{t('initialPaid')}</ThemedText><ThemedText style={styles.amount}>{money(paidAmount.data.amount, paidAmount.data.currency, locale)}</ThemedText></View> : null}
            {balance?.success ? <View style={styles.amountRow}><ThemedText>{t('estimatedBalance')}</ThemedText><ThemedText style={styles.amount}>{money(Math.max(0, balance.data.amount), balance.data.currency, locale)}</ThemedText></View> : null}
            <ThemedText themeColor="textSecondary">{t('creationPriceHint')}</ThemedText>
            <Button disabled={!prepared.success || !deliveryReady || offline || !!unavailableVariants.length || !!(draft.deliverImmediately && balance?.success && balance.data.amount > 0) || !!(draft.deliverImmediately && draft.items.some(item => item.quantity > item.shownStock))} loading={sending} onPress={() => void complete()}>{t(reviewingOrder ? 'saveReviewedOrder' : 'saveOrder')}</Button>
            {offline ? <ThemedText type="small" accessibilityRole="alert">{t('offlineEditing')}</ThemedText> : null}
            </View>
          </View>}
      {error ? <ThemedText accessibilityRole="alert" accessibilityLiveRegion="polite" style={[styles.error, { color: theme.error }]}>{error}</ThemedText> : null}
    </ScrollView>
    </View></KeyboardAvoidingView>
  </SafeAreaView></ThemedView>;
}

const styles = StyleSheet.create({ page: { flex: 1 }, content: { gap: 16, padding: 16, paddingBottom: 24, maxWidth: 640, width: "100%", alignSelf: "center" },
  heading: { gap: 4 }, sectionHeading: { borderTopWidth: 1, paddingTop: 16, marginTop: 4 },
  card: { borderWidth: 1, borderRadius: 8, padding: 16, gap: 12 },
  amountRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 },
  amount: { fontVariant: ["tabular-nums"], textAlign: "right", flexShrink: 1 }, section: { gap: 12 }, item: { gap: 8, paddingVertical: 12 }, row: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, error: { padding: 12 } });
