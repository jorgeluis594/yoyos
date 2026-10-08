import { PaymentFields } from "@mobile/features/orders/presentation/payment-fields";
import { DeliveryFields, deliveryDraftFromOrder } from "@mobile/features/orders/presentation/delivery-fields";
import { deliverySettings } from "@mobile/features/delivery-settings";
import type { DeliveryQuotation } from "@mobile/features/delivery-settings";
import { orderDeliveryFormSchema, type OrderDeliveryFormValues } from "@mobile/features/orders/presentation/order-delivery-form";
import type { DeliverySettingsResponse } from "@shared/contracts/delivery-settings";
import { orderLanguage } from "@mobile/features/orders/presentation/order-labels";
import type { Result } from "@shared/result";
import { add } from "@shared/money";
import { ok } from "@shared/functional";
import { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Switch, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { usePreventRemove } from "expo-router/react-navigation";
import * as Crypto from "expo-crypto";
import * as Network from "expo-network";
import { z } from "zod";
import { orderCatalogSchema, orderContactsSchema } from "@shared/contracts/orders";
import { orders } from "@mobile/features/orders/composition";
import { ThemedText } from "@mobile/components/themed-text";
import { ThemedView } from "@mobile/components/themed-view";
import { Button } from "@mobile/components/ui/button";
import { Input } from "@mobile/components/ui/input";
import { ListRow } from "@mobile/components/ui/list-row";
import { ScreenState } from "@mobile/components/ui/screen-state";
import { showConfirmation } from "@mobile/components/ui/show-confirmation";
import { useAccess } from "@mobile/features/users/presentation/access-provider";
import { addDraftItem, changeDraftQuantity, emptyOrderDraft, prepareOrder, removeDraftItem, setDraftCustomer,
  type OrderDraft } from "@mobile/features/orders/domain/order-draft";
import type { PendingOrderConfirmation, ConfirmOrderOutcome, ConfirmOrderError } from "@mobile/features/orders/application/order-operations";
import { useOrderDraft } from "@mobile/features/orders/presentation/order-draft-guard";
import { useOrderResult } from "@mobile/features/orders/presentation/order-result";
import { useTheme } from "@mobile/hooks/use-theme";
import translations from "@mobile/i18n";
import { normalizeDecimalInput } from "@mobile/shared/decimal-input";

type Catalog = z.infer<typeof orderCatalogSchema>;
type Contacts = z.infer<typeof orderContactsSchema>;
const money = (amount: number, currency: string, locale: string) => new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
const errorKeys: Record<string, string> = {
  TOTAL_CHANGED: 'orderDeliveryPriceChanged', RATE_UNAVAILABLE: 'orderDeliveryRateUnavailable', INVALID_DELIVERY_RATE: 'orderDeliveryRateUnavailable', INVALID_DISTRICT: 'invalidHomeDestination',
  INSUFFICIENT_STOCK: 'insufficientStock', VARIANT_NOT_FOUND: 'variantNotFound',
  CONTACT_NOT_FOUND: 'contactNotFound', CURRENCY_MISMATCH: 'currencyMismatch',
  INVALID_ORDER: 'invalidOrder', INVALID_PAYMENT: 'invalidOrder', PAYMENT_REQUIRED: 'immediateRequirements',
  DELIVERY_UNAVAILABLE: 'orderDeliveryUnavailable', DELIVERY_METHOD_DISABLED: 'orderDeliveryDisabled', COURIER_UNAVAILABLE: 'orderCourierUnavailable', PENDING_STORAGE_UNAVAILABLE: 'pendingStorageUnavailable',
  INVALID_PENDING_DATA: 'invalidPendingData', PENDING_CONFIRMATION: 'pendingConfirmation',
};

export default function NewOrderScreen() {
  const { state } = useAccess();
  return state.status === "ready" ? <CompanyOrderScreen key={state.company.id} /> : null;
}

function CompanyOrderScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'pt-BR' ? 'pt-BR' : 'es-PE';
  const navigation = useNavigation();
  const network = Network.useNetworkState();
  const { state } = useAccess();
  const { dirty, setDirty, discardVersion } = useOrderDraft();
  const { show } = useOrderResult();
  const [draft, setDraft] = useState<OrderDraft>(emptyOrderDraft);
  const [stage, setStage] = useState<"products" | "review">("products");
  const [search, setSearch] = useState("");
  const [catalog, setCatalog] = useState<Catalog>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [selected, setSelected] = useState<Catalog[number] | null>(null);
  const [contactSearch, setContactSearch] = useState("");
  const [contacts, setContacts] = useState<Contacts>([]);
  const [pending, setPending] = useState<PendingOrderConfirmation | null>(null);
  const [reviewingLegacy, setReviewingLegacy] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<"loading" | "none" | "uncertain" | "error">("loading");
  const [checks, setChecks] = useState(0);
  const [checking, setChecking] = useState(false);
  const [sending, setSending] = useState(false);
  const [settings, setSettings] = useState<DeliverySettingsResponse | null>(null);
  const [initialDelivery, setInitialDelivery] = useState<OrderDeliveryFormValues | null>(null);
  const [quoteResult, setQuoteResult] = useState<{ key: string; quotation: DeliveryQuotation | null; error: boolean } | null>(null);
  const [quoteAttempt, setQuoteAttempt] = useState(0);
  const saving = useRef(false);
  const [error, setError] = useState("");
  const [problemVariantId, setProblemVariantId] = useState<string | null>(null);
  const leaveAllowed = useRef(false);
  const version = useRef(discardVersion);
  const companyId = state.status === "ready" ? state.company.id : "";
  const activeCompany = useRef(companyId);
  const offline = network.isConnected === false || network.isInternetReachable === false;
  const legacyDelivery = pending?.request?.delivery && "chargeDeliveryToCustomer" in pending.request.delivery ? pending.request.delivery.delivery : null;
  const productTotal = reviewingLegacy && pending ? ok({ shownTotal: pending.shownTotal })
    : prepareOrder({ ...draft, payments: undefined, delivery: undefined, ratedDelivery: undefined });
  const method = initialDelivery?.method;
  const districtCode = initialDelivery?.districtCode ?? "";
  const deliveryEnabled = !!method && !!settings?.[method].enabled;
  const canQuote = !!initialDelivery && deliveryEnabled && (method === "home" || method === "agency") && !!districtCode && (pendingStatus === "none" || reviewingLegacy);
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
  const ratedDelivery = deliveryEnabled && !quoting && deliverySelection?.success && (method === "store" || selectedRate) ? deliverySelection.data : undefined;
  const saveDraft = { ...draft, ratedDelivery };
  const prepared = prepareOrder(saveDraft);
  const deliveryReady = !initialDelivery || !!ratedDelivery;
  const reviewedPrice = initialDelivery && deliveryEnabled && productTotal.success
    ? method === "store" ? { amount: 0, currency: productTotal.data.shownTotal.currency } : selectedRate?.price
    : undefined;
  const reviewedTotal = productTotal.success && (!initialDelivery || reviewedPrice)
    ? reviewedPrice ? add(reviewedPrice)(productTotal.data.shownTotal) : ok(productTotal.data.shownTotal) : null;
  const retryQuotation = () => {
    setInitialDelivery(current => current ? { ...current, rateId: "", price: null } : null);
    setQuoteAttempt(value => value + 1);
  };
  const paidAmount = (draft.payments ?? []).reduce((sum, payment) => sum + (Number(normalizeDecimalInput(payment.amount)) || 0), 0);

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
    setDirty((draft.kind === "items" || reviewingLegacy) && !leaveAllowed.current);
  }, [draft, reviewingLegacy, setDirty]);
  useEffect(() => () => setDirty(false), [setDirty]);
  useEffect(() => {
    if (version.current === discardVersion) return;
    version.current = discardVersion;
    leaveAllowed.current = true;
    setDraft(emptyOrderDraft());
    setInitialDelivery(null);
    setReviewingLegacy(false);
    setQuoteAttempt(value => value + 1);
  }, [discardVersion]);
  usePreventRemove(dirty, ({ data }) => {
    if (leaveAllowed.current) { navigation.dispatch(data.action); return; }
    showConfirmation({ title: t('discardOrder'), description: t('discardOrderHint'),
      confirmLabel: t('discard'), cancelLabel: t('keepEditing'), destructive: true,
      onConfirm: () => { leaveAllowed.current = true; setDirty(false); navigation.dispatch(data.action); } });
  });

  useEffect(() => {
    if (!companyId) return;
    let active = true;
    void orders.readPendingOrderConfirmation(companyId).then((result) => {
      if (!active) return;
      if (!result.success) { setPendingStatus("error"); setError(translations.t(errorKeys[result.error.code] ?? 'pendingReadError')); }
      else { setPending(result.data); setPendingStatus(result.data ? "uncertain" : "none"); }
    });
    return () => { active = false; };
  }, [companyId]);
  useEffect(() => {
    if (!companyId || pendingStatus !== "none" || stage !== "products") return;
    let active = true;
    const timer = setTimeout(() => { void orders.searchOrderCatalog(search.trim()).then((result) => {
      if (!active) return;
      setCatalogLoading(false);
      if (result.success) { setCatalog(result.data.filter((product) => product.variants.length)); setError(""); }
      else setError(translations.t('searchProductsError'));
    }); }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [companyId, pendingStatus, search, stage]);
  useEffect(() => {
    if (!companyId || pendingStatus !== "none" || stage !== "review") return;
    let active = true;
    const timer = setTimeout(() => { void orders.searchOrderContacts(contactSearch.trim()).then((result) => {
      if (active) setContacts(result.success ? result.data : []);
    }); }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [companyId, contactSearch, pendingStatus, stage]);

  if (state.status !== "ready") return null;

  const openCompleted = (outcome: Extract<ConfirmOrderOutcome, { kind: "completed" }>) => {
    leaveAllowed.current = true;
    setDirty(false);
    show({ id: outcome.order.id, shownTotal: outcome.shownTotal });
    router.replace(`/orders/${outcome.order.id}`);
  };
  const verify = async () => {
    if (checking) return;
    setChecking(true);
    const result = await orders.resolvePendingOrderConfirmation(companyId);
    setChecking(false);
    if (!result.success) { setError(t('verifyOrderOffline')); return; }
    if (!result.data) { setPending(null); setPendingStatus("none"); setReviewingLegacy(false); setChecks(0); return; }
    if (result.data.kind === "completed") { openCompleted(result.data); return; }
    setPending(result.data.pending);
    setChecks((current) => current + 1);
    setError(t('orderMissingHistory'));
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
        if (["TOTAL_CHANGED", "RATE_UNAVAILABLE", "INVALID_DELIVERY_RATE", "INVALID_DISTRICT", "COURIER_UNAVAILABLE", "DELIVERY_METHOD_DISABLED"].includes(result.error.code)) {
          const latest = await deliverySettings.get();
          if (activeCompany.current !== companyId) return;
          if (latest.success) setSettings(latest.data);
          retryQuotation();
        }
        setProblemVariantId("issues" in result.error ? result.error.issues?.find(issue => issue.variantId)?.variantId ?? null : null);
        const current = await orders.readPendingOrderConfirmation(companyId);
        if (!current.success) setPendingStatus("error");
        else { setPending(current.data); setPendingStatus(current.data ? "uncertain" : "none"); }
        return;
      }
      if (result.data.kind === "completed") { openCompleted(result.data); return; }
      setPending(result.data.pending); setPendingStatus("uncertain");
      if (reviewingLegacy) { setReviewingLegacy(false); setInitialDelivery(null); }
      setChecks(0); setError(t('uncertainOrder'));
    } finally { saving.current = false; setSending(false); }
  };
  const complete = () => { if (deliveryReady && prepared.success) return performSave(() => orders.completeOrder(saveDraft, companyId)); };
  const addVariant = (product: Catalog[number], variant: Catalog[number]["variants"][number]) => {
    const result = addDraftItem(draft, { variantId: variant.id, productName: product.name, variantAttributes: variant.attributes,
      sku: variant.sku, shownUnitPrice: { amount: variant.price, currency: product.currency }, shownStock: variant.stock, quantity: 1 },
      () => Crypto.randomUUID());
    if (result.success) { setDraft(result.data); setSelected(null); setError(""); }
    else setError(variant.stock === 0 ? t('outOfStock') : t('variantAlreadyAdded'));
  };
  const changeQuantity = (variantId: string, quantity: number) => {
    const result = changeDraftQuantity(draft, variantId, quantity);
    if (result.success) { setDraft(result.data); setError(""); }
    else setError(t('quantityError'));
  };

  return <ThemedView style={styles.page}><SafeAreaView style={styles.page} edges={["top", "left", "right"]}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Button variant="ghost" onPress={() => router.back()}>{t('backToOrders')}</Button>
      <View style={styles.heading}><ThemedText type="title" accessibilityRole="header">{t('newOrder')}</ThemedText>
        <ThemedText themeColor="textSecondary">{stage === "products" ? t('products') : t('review')}</ThemedText></View>
      {pendingStatus === "loading" ? <ScreenState status="loading" title={t('checkingPendingOrder')} />
        : pendingStatus === "error" ? <ScreenState status="error" title={t('pendingAttemptError')}
            description={t('pendingAttemptHint')}
            onRetry={() => { setPendingStatus("loading"); void orders.readPendingOrderConfirmation(companyId).then((result) => {
              if (result.success) { setPending(result.data); setPendingStatus(result.data ? "uncertain" : "none"); setError(""); }
              else setPendingStatus("error");
            }); }} />
        : pendingStatus === "uncertain" ? <View style={[styles.section, { backgroundColor: theme.backgroundElement, padding: 16, borderRadius: 8 }]}>
            <ThemedText type="subtitle" accessibilityRole="header">{t('pendingSale')}</ThemedText>
            <ThemedText>{t('verifyPendingId', { id: pending?.id })}</ThemedText>
            <Button disabled={sending} loading={checking} onPress={() => void verify()}>{t('verifyOrder')}</Button>
            {legacyDelivery && pending && !reviewingLegacy ? <Button variant="secondary" disabled={checking || sending} onPress={() => {
              const recipient = legacyDelivery.recipient;
              setInitialDelivery({ method: legacyDelivery.method, name: recipient.name, phone: recipient.phone,
                documentType: recipient.identity.kind === "document" ? recipient.identity.documentType : "absent",
                document: recipient.identity.kind === "document" ? recipient.identity.document : "",
                address: legacyDelivery.method === "home" ? legacyDelivery.destination.address : "",
                instructions: legacyDelivery.method === "home" ? legacyDelivery.destination.instructions ?? "" : "",
                districtCode: "", rateId: "", price: null, currency: pending.shownTotal.currency });
              setReviewingLegacy(true); setQuoteAttempt(value => value + 1); setError("");
            }}>{t('reviewLegacyDelivery')}</Button> : null}
            {reviewingLegacy && initialDelivery && pending ? <>
              <ThemedText>{t('legacyDeliveryReviewHint')}</ThemedText>
              <ThemedText>{t('itemCount', { count: pending.request?.items.reduce((count, item) => count + item.quantity, 0) ?? 0 })}</ThemedText>
              {pending?.request?.payments?.map(payment => <ThemedText key={payment.paymentId}>{t('initialPaid')}: {money(payment.amount.amount, payment.amount.currency, locale)}</ThemedText>)}
              {settings ? <DeliveryFields value={initialDelivery} onChange={next => {
                if (next.method !== initialDelivery.method || next.districtCode !== initialDelivery.districtCode) setQuoteAttempt(value => value + 1);
                setInitialDelivery(next);
              }} settings={settings} busy={sending || checking} language={orderLanguage(state.company.country, i18n.language)}
                rates={rates} quoting={quoting} quoteError={quoteError} onRetry={retryQuotation} /> : <ThemedText>{t('loadOrderDeliveryError')}</ThemedText>}
              <ThemedText>{t('orderDeliveryProductsAmount', { amount: money(pending.shownTotal.amount, pending.shownTotal.currency, locale) })}</ThemedText>
              {reviewedPrice && reviewedTotal?.success ? <>
                <ThemedText>{t('orderDeliveryAmount', { amount: money(reviewedPrice.amount, reviewedPrice.currency, locale) })}</ThemedText>
                <ThemedText>{t('orderDeliveryTotalAmount', { amount: money(reviewedTotal.data.amount, reviewedTotal.data.currency, locale) })}</ThemedText>
              </> : null}
              <ThemedText themeColor="textSecondary">{t('creationPriceHint')}</ThemedText>
              <Button disabled={!ratedDelivery || offline || checking} loading={sending} onPress={() => {
                if (ratedDelivery) void performSave(() => orders.reviewLegacyPendingDelivery(companyId, ratedDelivery));
              }}>{t('saveReviewedDelivery')}</Button>
            </> : null}
            {checks >= 2 && pending?.request && !legacyDelivery ? <Button variant="secondary" loading={sending} onPress={() => void performSave(() => orders.resendPendingOrder(companyId))}>{t('resendAttempt')}</Button> : null}
            {pending && !pending.request ? <ThemedText>{t('legacyAttemptHint')}</ThemedText> : null}
          </View>
        : stage === "products" ? <View style={styles.section}>
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
          </View> : <View style={styles.section}>
            <ThemedText type="subtitle" accessibilityRole="header">{t('items')}</ThemedText>
            {draft.items.map((item) => <View key={item.variantId} style={styles.item}>
              <ThemedText type="smallBold">{item.productName}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{Object.entries(item.variantAttributes).map(([key, value]) => `${key}: ${value}`).join(" · ")} · {t('stockCount', { count: item.shownStock })}</ThemedText>
              <ThemedText>{money(item.shownUnitPrice.amount, item.shownUnitPrice.currency, locale)} × {item.quantity}</ThemedText>
              {item.quantity > item.shownStock ? <ThemedText themeColor="textSecondary">{t('creationStockWarning')}</ThemedText> : null}
              {problemVariantId === item.variantId ? <ThemedText accessibilityRole="alert">{t('reviewVariant')}</ThemedText> : null}
              <View style={styles.row}><Button variant="secondary" disabled={item.quantity <= 1} onPress={() => changeQuantity(item.variantId, item.quantity - 1)}>−</Button>
                <Button variant="secondary" onPress={() => changeQuantity(item.variantId, item.quantity + 1)}>+</Button>
                <Button variant="ghost" onPress={() => setDraft(removeDraftItem(draft, item.variantId))}>{t('remove')}</Button></View>
            </View>)}
            <ThemedText type="subtitle" accessibilityRole="header">{t('customer')}</ThemedText>
            <ThemedText>{draft.customer.kind === "contact" ? draft.customer.name ?? draft.customer.phone : t('generalPublic')}</ThemedText>
            {draft.customer.kind === "contact" ? <Button variant="ghost" onPress={() => setDraft(setDraftCustomer(draft, { kind: "general_public" }))}>{t('removeContact')}</Button> : null}
            <Input value={contactSearch} onChangeText={setContactSearch} accessibilityLabel={t('searchContact')} placeholder={t('searchContactByNameOrPhone')} />
            {contacts.map((contact) => <ListRow key={contact.id} title={contact.name ?? contact.phone} description={contact.name ? contact.phone : undefined}
              onPress={() => { setDraft(setDraftCustomer(draft, { kind: "contact", contactId: contact.id, name: contact.name, phone: contact.phone })); setContactSearch(""); setContacts([]); }} />)}
            <ThemedText type="subtitle" accessibilityRole="header">{t('payments')}</ThemedText>
            {(draft.payments ?? []).map((payment, index) => <View key={payment.paymentId} style={styles.section}>
              <ThemedText type="smallBold">{t('initialPayment', { number: index + 1 })}</ThemedText>
              <PaymentFields value={payment} currency={productTotal.success ? productTotal.data.shownTotal.currency : ""} busy={sending}
                onChange={value => setDraft(current => ({ ...current, payments: current.payments?.map(row => row.paymentId === payment.paymentId ? { ...value, paymentId: row.paymentId } : row) }))} />
              <Button variant="ghost" disabled={sending} onPress={() => setDraft(current => ({ ...current, payments: current.payments?.filter(row => row.paymentId !== payment.paymentId) }))}>{t('remove')}</Button>
            </View>)}
            {!draft.payments?.length ? <ThemedText themeColor="textSecondary">{t('noInitialPayments')}</ThemedText> : null}
            <Button variant="secondary" disabled={sending} onPress={() => setDraft(current => ({ ...current, payments: [...current.payments ?? [], { paymentId: Crypto.randomUUID(), amount: "", method: "digital_wallet", deductStockIfPartial: false }] }))}>{t('addInitialPayment')}</Button>
            <ThemedText type="subtitle" accessibilityRole="header">{t('delivery')}</ThemedText>
            {settings && (initialDelivery || settings.home.enabled || settings.store.enabled || settings.agency.enabled) ? <>
              <View style={styles.toggle}><ThemedText style={styles.toggleLabel}>{t('configureInitialDelivery')}</ThemedText><Switch disabled={sending} value={!!initialDelivery} accessibilityLabel={t('configureInitialDelivery')} onValueChange={enabled => {
                if (!enabled) { setInitialDelivery(null); setQuoteAttempt(value => value + 1); return; }
                const { name, phone, documentType, document, method, address, instructions } = deliveryDraftFromOrder({ delivery: null,
                  buyer: draft.customer.kind === "contact" ? { contactId: draft.customer.contactId, name: draft.customer.name, phone: draft.customer.phone } : null,
                  deliveryCharge: { amount: 0, currency: "PEN" } }, settings);
                setInitialDelivery({ name, phone, documentType, document, method, address, instructions, rateId: "", price: null, districtCode: "",
                  currency: productTotal.success ? productTotal.data.shownTotal.currency : "PEN" });
                setQuoteAttempt(value => value + 1);
              }} /></View>
              {initialDelivery ? <DeliveryFields value={initialDelivery} onChange={next => {
                if (next.method !== initialDelivery.method || next.districtCode !== initialDelivery.districtCode) setQuoteAttempt(value => value + 1);
                setInitialDelivery(next);
              }} settings={settings} busy={sending} language={orderLanguage(state.company.country, i18n.language)}
                rates={rates} quoting={quoting} quoteError={quoteError} onRetry={retryQuotation} /> : null}
            </> : <ThemedText themeColor="textSecondary">{t(settings ? 'orderDeliveryDisabled' : 'loadOrderDeliveryError')}</ThemedText>}
            <View style={styles.toggle}><ThemedText style={styles.toggleLabel}>{t('deliverImmediately')}</ThemedText><Switch disabled={sending} value={draft.deliverImmediately ?? false} accessibilityLabel={t('deliverImmediately')} onValueChange={deliverImmediately => setDraft(current => ({ ...current, deliverImmediately }))} /></View>
            <ThemedText type="small" themeColor="textSecondary">{t('immediateRequirements')}</ThemedText>
            <ThemedText type="subtitle" accessibilityRole="header">{t('creationSummary')}</ThemedText>
            {productTotal.success ? <>
              <ThemedText>{t('initialPaid')}: {money(paidAmount, productTotal.data.shownTotal.currency, locale)}</ThemedText>
              {reviewedTotal?.success ? <ThemedText>{t('estimatedBalance')}: {money(Math.max(0, reviewedTotal.data.amount - paidAmount), reviewedTotal.data.currency, locale)}</ThemedText> : null}
            </> : null}
            {productTotal.success ? <ThemedText>{t("orderDeliveryProductsAmount", { amount: money(productTotal.data.shownTotal.amount, productTotal.data.shownTotal.currency, locale) })}</ThemedText> : null}
            {reviewedPrice && reviewedTotal?.success ? <><ThemedText>{t("orderDeliveryAmount", { amount: money(reviewedPrice.amount, reviewedPrice.currency, locale) })}</ThemedText>
              <ThemedText>{t("orderDeliveryTotalAmount", { amount: money(reviewedTotal.data.amount, reviewedTotal.data.currency, locale) })}</ThemedText></> : null}
            <ThemedText themeColor="textSecondary">{t('creationPriceHint')}</ThemedText>
          </View>}
      {error ? <ThemedText accessibilityRole="alert" style={[styles.error, { color: theme.error }]}>{error}</ThemedText> : null}
      {pendingStatus === "none" ? <View style={styles.bottom}>
        {productTotal.success ? <ThemedText type="subtitle">{t('itemCount', { count: draft.items.length })} · {money(productTotal.data.shownTotal.amount, productTotal.data.shownTotal.currency, locale)}</ThemedText> : null}
        {stage === "products" ? <Button disabled={draft.kind === "empty"} onPress={() => { setStage("review"); setError(""); }}>{t('reviewOrder')}</Button>
          : <View style={styles.section}><Button variant="secondary" onPress={() => { setCatalogLoading(true); setStage("products"); }}>{t('editProducts')}</Button>
            <Button disabled={!prepared.success || !deliveryReady || offline} loading={sending} onPress={() => void complete()}>{t('saveOrder')}</Button>
            {offline ? <ThemedText type="small" accessibilityRole="alert">{t('offlineEditing')}</ThemedText> : null}
          </View>}
      </View> : null}
    </ScrollView>
  </SafeAreaView></ThemedView>;
}

const styles = StyleSheet.create({ page: { flex: 1 }, content: { gap: 20, padding: 16, paddingBottom: 40, maxWidth: 640, width: "100%", alignSelf: "center" },
  toggle: { flexDirection: "row", alignItems: "center", gap: 16, minHeight: 48 }, toggleLabel: { flex: 1 },
  heading: { gap: 4 }, section: { gap: 12 }, item: { gap: 8, paddingVertical: 12 }, row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  bottom: { gap: 12, paddingTop: 16 }, error: { padding: 12 } });
