import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import type { ListOrderAggregatesResponse } from "@shared/contracts/orders";
import { orders } from "@mobile/features/orders/composition";
import { ThemedText } from "@mobile/components/themed-text";
import { ThemedView } from "@mobile/components/themed-view";
import { Button } from "@mobile/components/ui/button";
import { Input } from "@mobile/components/ui/input";
import { ListRow } from "@mobile/components/ui/list-row";
import { ScreenState } from "@mobile/components/ui/screen-state";
import { useAccess } from "@mobile/features/users/presentation/access-provider";
import { useOrderResult } from "@mobile/features/orders/presentation/order-result";
import { OrderDayField } from "@mobile/features/orders/presentation/order-day-field";
import { useTheme } from "@mobile/hooks/use-theme";
import { orderLanguage, orderStatusLabel } from "@mobile/features/orders/presentation/order-labels";
import type { OrderListCriteria } from "@mobile/features/orders/application/order-operations";
import translations from "@mobile/i18n";

type Summary = ListOrderAggregatesResponse["items"][number];
const money = (amount: number, currency: string, locale: string) => new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
const limaDate = (value: string, locale: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "America/Lima" }).format(new Date(value));

export default function OrderHistoryScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'pt-BR' ? 'pt-BR' : 'es-PE';
  const { state } = useAccess();
  const { show } = useOrderResult();
  const [criteria, setCriteria] = useState<OrderListCriteria>({ page: 1, customer: { kind: "all" } });
  const [fromDay, setFromDay] = useState("");
  const [throughDay, setThroughDay] = useState("");
  const [customerKind, setCustomerKind] = useState<"all" | "general_public" | "contact">("all");
  const [contactSearch, setContactSearch] = useState("");
  const [contactId, setContactId] = useState("");
  const [contacts, setContacts] = useState<{ id: string; name: string | null; phone: string }[]>([]);
  const [items, setItems] = useState<Summary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pendingState, setPendingState] = useState<"none" | "pending" | "error">("none");
  const [verifyMessage, setVerifyMessage] = useState("");
  const [verifying, setVerifying] = useState(false);
  const activeRequest = useRef(0);
  const companyId = state.status === "ready" ? state.company.id : "";

  const reload = useCallback(async (company: string, filters: OrderListCriteria) => {
    const request = ++activeRequest.current;
    setLoading(true);
    const [list, pending] = await Promise.all([orders.loadMixedOrders(filters), orders.readPendingOrderConfirmation(company)]);
    if (request !== activeRequest.current) return;
    if (list.success) { setItems(list.data.items); setTotal(list.data.total); setError(""); }
    else setError(list.error.code === "INVALID_INPUT" ? translations.t('filterInputError') : translations.t('loadOrdersError'));
    setPendingState(!pending.success ? "error" : pending.data ? "pending" : "none");
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => {
    if (companyId) void reload(companyId, criteria);
    return () => { activeRequest.current += 1; };
  }, [companyId, criteria, reload]));

  useEffect(() => {
    if (!companyId || customerKind !== "contact") return;
    let active = true;
    const timer = setTimeout(() => {
      void orders.searchOrderContacts(contactSearch.trim()).then((result) => {
        if (active) setContacts(result.success ? result.data : []);
      });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [companyId, customerKind, contactSearch]);

  if (state.status !== "ready") return null;
  const language = orderLanguage(state.company.country, i18n.language);

  const apply = () => {
    if (customerKind === "contact" && !contactId) { setError(t('selectContactError')); return; }
    setCriteria({ page: 1, customer: customerKind === "contact" ? { kind: "contact", contactId } : { kind: customerKind },
      ...(fromDay ? { fromDay } : {}), ...(throughDay ? { throughDay } : {}) });
  };
  const verify = async () => {
    if (verifying) return;
    setVerifying(true);
    const result = await orders.resolvePendingOrderConfirmation(companyId);
    setVerifying(false);
    if (!result.success) { setVerifyMessage(t('verifyOrderError')); return; }
    if (!result.data) { setPendingState("none"); setVerifyMessage(""); return; }
    if (result.data.kind === "uncertain") { setVerifyMessage(t('orderStillMissing')); return; }
    show({ id: result.data.order.id, shownTotal: result.data.shownTotal });
    router.push(`/orders/${result.data.order.id}`);
  };

  const header = <View style={styles.header}>
    <View style={styles.heading}><ThemedText type="title" accessibilityRole="header">{t('orders')}</ThemedText><ThemedText themeColor="textSecondary">{state.company.name}</ThemedText></View>
    {pendingState !== "none" ? <View style={[styles.notice, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText type="smallBold">{pendingState === "error" ? t('pendingReadError') : t('pendingOrder')}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{pendingState === "error" ? t('pendingReadHint') : t('pendingOrderHint')}</ThemedText>
      <Button variant="secondary" loading={verifying} onPress={() => pendingState === "error" ? void reload(companyId, criteria) : void verify()}>{pendingState === "error" ? t('retry') : t('verifyOrder')}</Button>
      {verifyMessage ? <ThemedText type="small" accessibilityRole="alert">{verifyMessage}</ThemedText> : null}
    </View> : null}
    <Button onPress={() => router.push("/orders/new")}>{t('newOrder')}</Button>
    <View style={styles.filters}>
      <ThemedText type="subtitle" accessibilityRole="header">{t('filterCreationDate')}</ThemedText>
      <View style={styles.row}>
        <Button variant={customerKind === "all" ? "default" : "secondary"} onPress={() => { setCustomerKind("all"); setContactId(""); }}>{t('all')}</Button>
        <Button variant={customerKind === "general_public" ? "default" : "secondary"} onPress={() => { setCustomerKind("general_public"); setContactId(""); }}>{t('generalPublic')}</Button>
        <Button variant={customerKind === "contact" ? "default" : "secondary"} onPress={() => setCustomerKind("contact")}>{t('contact')}</Button>
      </View>
      {customerKind === "contact" ? <View style={styles.field}>
        <Input value={contactSearch} onChangeText={(value) => { setContactSearch(value); setContactId(""); }} accessibilityLabel={t('searchContact')} placeholder={t('nameOrPhone')} />
        {contactId ? <ThemedText type="small">{t('selectedContact')}</ThemedText> : contacts.map((contact) =>
          <ListRow key={contact.id} title={contact.name ?? contact.phone} description={contact.name ? contact.phone : undefined}
            onPress={() => { setContactId(contact.id); setContactSearch(contact.name ?? contact.phone); }} />)}
      </View> : null}
      <View style={styles.row}>
        <View style={styles.date}><OrderDayField label={t('from')} value={fromDay} onChange={setFromDay} /></View>
        <View style={styles.date}><OrderDayField label={t('through')} value={throughDay} onChange={setThroughDay} /></View>
      </View>
      <Button variant="secondary" onPress={apply}>{t('applyFilters')}</Button>
    </View>
    {!loading && !error && items.length ? <ThemedText type="small" themeColor="textSecondary">{t('orderCount', { count: total })}</ThemedText> : null}
  </View>;

  return <ThemedView style={styles.page}><SafeAreaView style={styles.page} edges={["top", "left", "right"]}>
    {loading ? <ScrollView contentContainerStyle={styles.content}>{header}<ScreenState status="loading" title={t('loadingOrders')} /></ScrollView>
      : error ? <ScrollView contentContainerStyle={styles.content}>{header}<ScreenState status="error" title={t('loadOrdersTitle')} description={error} onRetry={() => void reload(companyId, criteria)} /></ScrollView>
      : <FlatList data={items} keyExtractor={(item) => item.id} contentContainerStyle={styles.content}
          ListHeaderComponent={header}
          ListEmptyComponent={<ScreenState status={criteria.page === 1 && criteria.customer.kind === "all" && !criteria.fromDay && !criteria.throughDay ? "empty" : "no-results"}
            title={criteria.page === 1 && criteria.customer.kind === "all" && !criteria.fromDay && !criteria.throughDay ? t('noOrders') : t('noResults')}
            description={t('ordersEmptyHint')} />}
          renderItem={({ item }) => <ListRow title={item.buyer !== null ? item.buyer.name ?? item.buyer.phone : t('generalPublic')}
            description={`${t("orderNumber", { number: item.number })}${item.checkoutEnabledAt ? ` · ${t(item.status === "cancelled" ? "checkoutCancelled" : item.checkoutConfirmedAt ? "checkoutConfirmed" : "checkoutPending")}` : ""} · ${orderStatusLabel(item.status, language)} · ${limaDate(item.createdAt, locale)}`}
            trailing={<ThemedText type="smallBold">{money(item.total.amount, item.total.currency, locale)}</ThemedText>}
            onPress={() => router.push(`/orders/${item.id}`)} />}
          ListFooterComponent={items.length ? <View style={styles.row}>
            {criteria.page > 1 ? <Button variant="secondary" onPress={() => setCriteria({ ...criteria, page: criteria.page - 1 })}>{t('previous')}</Button> : null}
            {criteria.page * 20 < total ? <Button variant="secondary" onPress={() => setCriteria({ ...criteria, page: criteria.page + 1 })}>{t('next')}</Button> : null}
          </View> : null} />}
  </SafeAreaView></ThemedView>;
}

const styles = StyleSheet.create({
  page: { flex: 1 }, content: { gap: 12, padding: 16, paddingBottom: 32, width: "100%", maxWidth: 640, alignSelf: "center" },
  header: { gap: 16 }, heading: { gap: 4, paddingTop: 8 }, filters: { gap: 12 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  field: { gap: 8 }, date: { flex: 1, minWidth: 130, gap: 4 }, notice: { gap: 8, padding: 16, borderRadius: 8 },
});
