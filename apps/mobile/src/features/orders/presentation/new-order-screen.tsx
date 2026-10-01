import { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
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
import type { PendingOrderConfirmation, ConfirmOrderOutcome } from "@mobile/features/orders/application/order-operations";
import { useOrderDraft } from "@mobile/features/orders/presentation/order-draft-guard";
import { useOrderResult } from "@mobile/features/orders/presentation/order-result";
import { useTheme } from "@mobile/hooks/use-theme";
import translations from "@mobile/i18n";

type Catalog = z.infer<typeof orderCatalogSchema>;
type Contacts = z.infer<typeof orderContactsSchema>;
const money = (amount: number, currency: string, locale: string) => new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
const errorKeys: Record<string, string> = {
  INSUFFICIENT_STOCK: 'insufficientStock', VARIANT_NOT_FOUND: 'variantNotFound',
  CONTACT_NOT_FOUND: 'contactNotFound', CURRENCY_MISMATCH: 'currencyMismatch',
  INVALID_ORDER: 'invalidOrder', PENDING_STORAGE_UNAVAILABLE: 'pendingStorageUnavailable',
  INVALID_PENDING_DATA: 'invalidPendingData', PENDING_CONFIRMATION: 'pendingConfirmation',
};

export default function NewOrderScreen() {
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
  const [pendingStatus, setPendingStatus] = useState<"loading" | "none" | "uncertain" | "error">("loading");
  const [checks, setChecks] = useState(0);
  const [checking, setChecking] = useState(false);
  const [sending, setSending] = useState(false);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [problemVariantId, setProblemVariantId] = useState<string | null>(null);
  const [rebuildId, setRebuildId] = useState<string | null>(null);
  const submitted = useRef<OrderDraft | null>(null);
  const leaveAllowed = useRef(false);
  const version = useRef(discardVersion);
  const companyId = state.status === "ready" ? state.company.id : "";
  const offline = network.isConnected === false || network.isInternetReachable === false;
  const prepared = prepareOrder(draft);

  useEffect(() => {
    if (draft.kind === "empty") leaveAllowed.current = false;
    setDirty(draft.kind === "items" && !leaveAllowed.current);
  }, [draft, setDirty]);
  useEffect(() => () => setDirty(false), [setDirty]);
  useEffect(() => {
    if (version.current === discardVersion) return;
    version.current = discardVersion;
    leaveAllowed.current = true;
    setDraft(emptyOrderDraft());
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
    if (!result.data) { setPending(null); setPendingStatus("none"); setChecks(0); return; }
    if (result.data.kind === "completed") { openCompleted(result.data); return; }
    setPending(result.data.pending);
    setChecks((current) => current + 1);
    setError(t('orderMissingHistory'));
  };
  const complete = async (selectedDraft: OrderDraft) => {
    if (sending) return;
    const connection = await Network.getNetworkStateAsync().catch(() => null);
    if (connection?.isConnected === false || connection?.isInternetReachable === false) {
      setError(t('offlineDraftSaved')); return;
    }
    setSending(true);
    submitted.current = selectedDraft;
    setHasSubmitted(true);
    const result = await orders.completeOrder(selectedDraft, companyId);
    setSending(false);
    if (!result.success) {
      setError(translations.t(errorKeys[result.error.code] ?? 'confirmOrderError'));
      setProblemVariantId("issues" in result.error ? result.error.issues?.find((issue) => issue.variantId)?.variantId ?? null : null);
      const current = await orders.readPendingOrderConfirmation(companyId);
      if (!current.success) setPendingStatus("error");
      else if (!current.data) { setPending(null); setPendingStatus("none"); submitted.current = null; }
      else { setPending(current.data); setPendingStatus("uncertain"); }
      return;
    }
    if (result.data.kind === "completed") { openCompleted(result.data); return; }
    setPending(result.data.pending);
    setPendingStatus("uncertain");
    setChecks(0);
    setError(t('uncertainOrder'));
  };
  const addVariant = (product: Catalog[number], variant: Catalog[number]["variants"][number]) => {
    const result = addDraftItem(draft, { variantId: variant.id, productName: product.name, variantAttributes: variant.attributes,
      sku: variant.sku, shownUnitPrice: { amount: variant.price, currency: product.currency }, shownStock: variant.stock, quantity: 1 },
      () => rebuildId ?? Crypto.randomUUID());
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
            <Button loading={checking} onPress={() => void verify()}>{t('verifyOrder')}</Button>
            {checks >= 2 && pending ? <Button variant="secondary" onPress={() => {
              if (submitted.current) { void complete(submitted.current); return; }
              setRebuildId(pending.id); setDraft(emptyOrderDraft()); setPendingStatus("none"); setError("");
            }}>{hasSubmitted ? t('resendAttempt') : t('rebuildOrder')}</Button> : null}
          </View>
        : stage === "products" ? <View style={styles.section}>
            <Input value={search} onChangeText={(value) => { setCatalogLoading(true); setSearch(value); }} accessibilityLabel={t('searchProductsByName')} placeholder={t('searchProductsByName')} />
            {catalogLoading ? <ScreenState status="loading" title={t('searchingProducts')} /> : selected ? <View style={styles.section}>
              <Button variant="ghost" onPress={() => setSelected(null)}>{t('backToProducts')}</Button>
              <ThemedText type="subtitle">{selected.name}</ThemedText>
              {selected.variants.map((variant) => <View key={variant.id} style={styles.item}>
                <ThemedText type="smallBold">{Object.entries(variant.attributes).map(([key, value]) => `${key}: ${value}`).join(" · ") || variant.sku || t('variant')}</ThemedText>
                <ThemedText>{money(variant.price, selected.currency, locale)} · {t('stockCount', { count: variant.stock })}</ThemedText>
                <Button variant="secondary" disabled={variant.stock === 0 || draft.items.some((item) => item.variantId === variant.id)} onPress={() => addVariant(selected, variant)}>{t('add')}</Button>
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
              {problemVariantId === item.variantId ? <ThemedText accessibilityRole="alert">{t('reviewVariant')}</ThemedText> : null}
              <View style={styles.row}><Button variant="secondary" disabled={item.quantity <= 1} onPress={() => changeQuantity(item.variantId, item.quantity - 1)}>−</Button>
                <Button variant="secondary" disabled={item.quantity >= item.shownStock} onPress={() => changeQuantity(item.variantId, item.quantity + 1)}>+</Button>
                <Button variant="ghost" onPress={() => setDraft(removeDraftItem(draft, item.variantId))}>{t('remove')}</Button></View>
            </View>)}
            <ThemedText type="subtitle" accessibilityRole="header">{t('customer')}</ThemedText>
            <ThemedText>{draft.customer.kind === "contact" ? draft.customer.name ?? draft.customer.phone : t('generalPublic')}</ThemedText>
            {draft.customer.kind === "contact" ? <Button variant="ghost" onPress={() => setDraft(setDraftCustomer(draft, { kind: "general_public" }))}>{t('removeContact')}</Button> : null}
            <Input value={contactSearch} onChangeText={setContactSearch} accessibilityLabel={t('searchContact')} placeholder={t('searchContactByNameOrPhone')} />
            {contacts.map((contact) => <ListRow key={contact.id} title={contact.name ?? contact.phone} description={contact.name ? contact.phone : undefined}
              onPress={() => { setDraft(setDraftCustomer(draft, { kind: "contact", contactId: contact.id, name: contact.name, phone: contact.phone })); setContactSearch(""); setContacts([]); }} />)}
            <ThemedText>{t('confirmPaymentHint')}</ThemedText>
          </View>}
      {error ? <ThemedText accessibilityRole="alert" style={[styles.error, { color: theme.error }]}>{error}</ThemedText> : null}
      {pendingStatus === "none" ? <View style={styles.bottom}>
        {prepared.success ? <ThemedText type="subtitle">{t('itemCount', { count: draft.items.length })} · {money(prepared.data.shownTotal.amount, prepared.data.shownTotal.currency, locale)}</ThemedText> : null}
        {stage === "products" ? <Button disabled={draft.kind === "empty"} onPress={() => { setStage("review"); setError(""); }}>{t('reviewOrder')}</Button>
          : <View style={styles.section}><Button variant="secondary" onPress={() => { setCatalogLoading(true); setStage("products"); }}>{t('editProducts')}</Button>
            <Button disabled={!prepared.success || offline} loading={sending} onPress={() => void complete(draft)}>{t('confirmPaymentAndDelivery')}</Button>
            {offline ? <ThemedText type="small" accessibilityRole="alert">{t('offlineEditing')}</ThemedText> : null}
          </View>}
      </View> : null}
    </ScrollView>
  </SafeAreaView></ThemedView>;
}

const styles = StyleSheet.create({ page: { flex: 1 }, content: { gap: 20, padding: 16, paddingBottom: 40, maxWidth: 640, width: "100%", alignSelf: "center" },
  heading: { gap: 4 }, section: { gap: 12 }, item: { gap: 8, paddingVertical: 12 }, row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  bottom: { gap: 12, paddingTop: 16 }, error: { padding: 12 } });
