/** @jsxImportSource react */
// Preserve native Pressable style callbacks outside NativeWind interop.
import { SymbolView } from "expo-symbols";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, SectionList, StyleSheet, View } from "react-native";
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
import { orderLanguage, deliveryStatusLabel } from "@mobile/features/orders/presentation/order-labels";
import type { OrderListCriteria } from "@mobile/features/orders/application/order-operations";
import translations from "@mobile/i18n";

type Summary = ListOrderAggregatesResponse["items"][number];
const money = (amount: number, currency: string, locale: string) => new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
const dayKey = (value: string | Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
const timeLabel = (value: string, locale: string) => new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone: "America/Lima" }).format(new Date(value));

export default function OrderHistoryScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'pt-BR' ? 'pt-BR' : 'es-PE';
  const { state } = useAccess();
  const { show } = useOrderResult();
  const [criteria, setCriteria] = useState<OrderListCriteria>({ page: 1, customer: { kind: "all" } });
  const [now, setNow] = useState(() => new Date());
  const [search, setSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterError, setFilterError] = useState("");
  const previousCriteria = useRef(criteria);
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
    setNow(new Date());
    if (previousCriteria.current !== criteria) { setItems([]); previousCriteria.current = criteria; }
    if (companyId) void reload(companyId, criteria);
    return () => { activeRequest.current += 1; };
  }, [companyId, criteria, reload]));

  useEffect(() => {
    const timer = setTimeout(() => setCriteria((current) => current.search === search.trim() || (!current.search && !search.trim())
      ? current : { ...current, page: 1, search: search.trim() }), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!companyId || !filtersOpen || customerKind !== "contact") return;
    let active = true;
    const timer = setTimeout(() => {
      void orders.searchOrderContacts(contactSearch.trim()).then((result) => {
        if (active) setContacts(result.success ? result.data : []);
      });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [companyId, filtersOpen, customerKind, contactSearch]);

  if (state.status !== "ready") return null;
  const language = orderLanguage(state.company.country, i18n.language);

  const apply = () => {
    if ((customerKind === "contact" && !contactId) || (fromDay && !z.iso.date().safeParse(fromDay).success) ||
      (throughDay && !z.iso.date().safeParse(throughDay).success) || (fromDay && throughDay && fromDay > throughDay)) {
      setFilterError(t('orderListFilterError')); return;
    }
    setCriteria({ search: criteria.search, view: criteria.view, page: 1, customer: customerKind === "contact" ? { kind: "contact", contactId } : { kind: customerKind },
      ...(fromDay ? { fromDay } : {}), ...(throughDay ? { throughDay } : {}) });
    setFiltersOpen(false); setFilterError("");
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

  const advanced = criteria.customer.kind !== "all" || !!criteria.fromDay || !!criteria.throughDay;
  const filtered = advanced || !!criteria.search || (!!criteria.view && criteria.view !== "all");
  const openFilters = () => {
    setCustomerKind(criteria.customer.kind);
    setContactId(criteria.customer.kind === "contact" ? criteria.customer.contactId : "");
    setFromDay(criteria.fromDay ?? ""); setThroughDay(criteria.throughDay ?? "");
    setFilterError(""); setFiltersOpen(true);
  };
  const sections: { title: string; data: Summary[] }[] = [];
  for (const item of items) {
    const title = dayKey(item.createdAt);
    const last = sections[sections.length - 1];
    if (last?.title === title) last.data.push(item);
    else sections.push({ title, data: [item] });
  }
  const sectionTitle = (date: string) => {
    const label = new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", ...(date.slice(0, 4) !== dayKey(now).slice(0, 4) ? { year: "numeric" } : {}), timeZone: "America/Lima" }).format(new Date(`${date}T12:00:00Z`));
    const relative = date === dayKey(now) ? t('orderListToday') : date === dayKey(new Date(now.getTime() - 86400000)) ? t('orderListYesterday') : "";
    return relative ? `${relative} · ${label}` : label;
  };
  const header = <View style={styles.header}>
    <View style={styles.business}><SymbolView name={{ ios: "storefront", android: "storefront" }} size={20} tintColor={theme.primary} /><ThemedText type="small" themeColor="textSecondary" style={styles.customer}>{state.company.name}</ThemedText></View>
    <View style={styles.heading}><ThemedText accessibilityRole="header" style={styles.title}>{t('orders')}</ThemedText>
      <Pressable accessibilityRole="button" accessibilityLabel={t('orderListNewLabel')} onPress={() => router.push("/orders/new")}
        style={({ pressed }) => [styles.newButton, { backgroundColor: pressed ? theme.primaryPressed : theme.primary }]}>
        <SymbolView name={{ ios: "plus", android: "add" }} size={22} tintColor={theme.primaryForeground} />
        <ThemedText style={{ color: theme.primaryForeground, fontWeight: "600" }}>{t('orderListNew')}</ThemedText>
      </Pressable>
    </View>
    <View style={styles.search}>
      <Input value={search} onChangeText={setSearch} maxLength={120} accessibilityLabel={t('orderListSearch')} placeholder={t('orderListSearch')}
        returnKeyType="search" autoCorrect={false} style={styles.searchInput} />
      <View pointerEvents="none" style={styles.searchIcon}><SymbolView name={{ ios: "magnifyingglass", android: "search" }} size={22} tintColor={theme.textSecondary} /></View>
      {search ? <Pressable accessibilityRole="button" accessibilityLabel={t('orderListClearSearch')} onPress={() => setSearch("")} style={styles.clearSearch}>
        <SymbolView name={{ ios: "xmark.circle.fill", android: "cancel" }} size={20} tintColor={theme.textSecondary} />
      </Pressable> : null}
    </View>
    <View style={styles.filterBar}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterChips}>
        {(["all", "unpaid", "undelivered"] as const).map((view) => <Pressable key={view} accessibilityRole="button"
          accessibilityState={{ selected: (criteria.view ?? "all") === view }} onPress={() => setCriteria({ ...criteria, page: 1, view })}
          style={({ pressed }) => [styles.chip, { borderColor: theme.border, backgroundColor: (criteria.view ?? "all") === view || pressed ? theme.backgroundSelected : theme.background }]}>
          <ThemedText type="small" style={{ color: (criteria.view ?? "all") === view ? theme.primary : theme.textSecondary, fontWeight: (criteria.view ?? "all") === view ? "600" : "400" }}>{t(view === "all" ? 'all' : view === "unpaid" ? 'orderListUnpaid' : 'orderListUndelivered')}</ThemedText>
        </Pressable>)}
      </ScrollView>
      <Pressable accessibilityRole="button" accessibilityLabel={t('orderListFilters')} accessibilityState={{ selected: advanced }} onPress={openFilters}
        style={[styles.filterButton, { borderColor: theme.border, backgroundColor: advanced ? theme.backgroundSelected : theme.background }]}>
        <SymbolView name={{ ios: "slider.horizontal.3", android: "tune" }} size={22} tintColor={advanced ? theme.primary : theme.textSecondary} />
      </Pressable>
    </View>
    {advanced ? <Pressable accessibilityRole="button" accessibilityLabel={t('orderListClear')} onPress={() => setCriteria({ page: 1, customer: { kind: "all" }, search: criteria.search, view: criteria.view })} style={styles.applied}>
      <ThemedText type="small" style={{ color: theme.primary }}>{t('orderListFiltered')} · {t('orderListClear')}</ThemedText>
    </Pressable> : null}
    {pendingState !== "none" ? <View style={[styles.notice, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText type="smallBold">{pendingState === "error" ? t('pendingReadError') : t('pendingOrder')}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{pendingState === "error" ? t('pendingReadHint') : t('pendingOrderHint')}</ThemedText>
      <Button variant="secondary" loading={verifying} onPress={() => pendingState === "error" ? void reload(companyId, criteria) : void verify()}>{pendingState === "error" ? t('retry') : t('verifyOrder')}</Button>
      {verifyMessage ? <ThemedText type="small" accessibilityRole="alert">{verifyMessage}</ThemedText> : null}
    </View> : null}
  </View>;

  const filterForm = <View style={styles.filters}>
      <ThemedText type="subtitle" accessibilityRole="header">{t('orderListCustomer')}</ThemedText>
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
      <ThemedText type="subtitle" accessibilityRole="header">{t('orderListCreated')}</ThemedText>
      <View style={styles.row}>
        <View style={styles.date}><OrderDayField label={t('from')} value={fromDay} onChange={setFromDay} /></View>
        <View style={styles.date}><OrderDayField label={t('through')} value={throughDay} onChange={setThroughDay} /></View>
      </View>
      {filterError ? <ThemedText accessibilityRole="alert" style={{ color: theme.error }}>{filterError}</ThemedText> : null}
      <Button onPress={apply}>{t('applyFilters')}</Button>
      <Button variant="ghost" onPress={() => { setFromDay(""); setThroughDay(""); setCustomerKind("all"); setContactId(""); setContactSearch(""); setFilterError(""); }}>{t('orderListClear')}</Button>
    </View>;

  return <ThemedView style={styles.page}><SafeAreaView style={styles.page} edges={["top", "left", "right"]}>
    <View style={styles.container}>{header}
      <SectionList sections={error ? [] : sections} keyExtractor={(item) => item.id} style={styles.page}
        keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" stickySectionHeadersEnabled={false}
        refreshing={loading && items.length > 0} onRefresh={() => void reload(companyId, criteria)}
        contentContainerStyle={styles.content}
        renderSectionHeader={({ section }) => <ThemedText type="small" themeColor="textSecondary" accessibilityRole="header" style={styles.day}>{sectionTitle(section.title)}</ThemedText>}
        ListEmptyComponent={<ScreenState status={loading ? "loading" : error ? "error" : filtered ? "no-results" : "empty"}
          title={loading ? t('loadingOrders') : error ? t('loadOrdersTitle') : filtered ? t('noResults') : t('noOrders')}
          description={error || (!loading ? t('ordersEmptyHint') : undefined)} onRetry={error ? () => void reload(companyId, criteria) : undefined} />}
        renderItem={({ item }) => <Pressable accessibilityRole="button" onPress={() => router.push(`/orders/${item.id}`)}
          style={({ pressed }) => [styles.order, { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement, borderBottomColor: theme.border }]}>
          <View style={styles.orderHeading}><ThemedText style={styles.customerName}>{item.buyer ? item.buyer.name ?? item.buyer.phone : t('generalPublic')}</ThemedText>
            <ThemedText style={styles.amount}>{money(item.total.amount, item.total.currency, locale)}</ThemedText></View>
          <ThemedText type="small" themeColor="textSecondary">#{item.number} · {timeLabel(item.createdAt, locale)}</ThemedText>
          <View style={styles.badges}>
            {item.status === "cancelled" || item.status === "completed" ? <View style={[styles.badge, { backgroundColor: item.status === "completed" ? theme.successSurface : theme.secondary }]}>
              <ThemedText type="small" style={{ color: item.status === "completed" ? theme.success : theme.textSecondary }}>{t(item.status === "completed" ? 'orderListCompleted' : 'orderListCancelled')}</ThemedText>
            </View> : <>
              <View style={[styles.badge, { backgroundColor: item.paymentStatus === "paid" ? theme.successSurface : theme.warningSurface }]}><ThemedText type="small" style={{ color: item.paymentStatus === "paid" ? theme.success : theme.warning }}>{t(item.paymentStatus === "paid" ? 'orderListPaid' : 'orderListPaymentPending')}</ThemedText></View>
              <View style={[styles.badge, { backgroundColor: theme.secondary }]}><ThemedText type="small" themeColor="textSecondary">{deliveryStatusLabel(item.deliveryStatus, language)}</ThemedText></View>
            </>}
          </View>
          {item.checkoutEnabledAt ? <ThemedText type="small" themeColor="textSecondary">{t(item.status === "cancelled" ? "checkoutCancelled" : item.checkoutConfirmedAt ? "checkoutConfirmed" : "checkoutPending")}</ThemedText> : null}
        </Pressable>}
        ListFooterComponent={!error && items.length ? <View style={styles.footer}>
          <ThemedText type="small" themeColor="textSecondary">{t('orderCount', { count: total })}</ThemedText>
          <View style={styles.row}>
            {criteria.page > 1 ? <Button variant="secondary" onPress={() => setCriteria({ ...criteria, page: criteria.page - 1 })}>{t('previous')}</Button> : null}
            {criteria.page * 20 < total ? <Button variant="secondary" onPress={() => setCriteria({ ...criteria, page: criteria.page + 1 })}>{t('next')}</Button> : null}
          </View>
        </View> : null} />
    </View>
    <Modal visible={filtersOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setFiltersOpen(false)}>
      <SafeAreaView style={[styles.page, { backgroundColor: theme.background }]}>
        <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={styles.modalHeader}><ThemedText type="title" accessibilityRole="header">{t('orderListFilters')}</ThemedText>
            <Pressable accessibilityRole="button" accessibilityLabel={t('orderListClose')} onPress={() => setFiltersOpen(false)} style={styles.filterButton}>
              <SymbolView name={{ ios: "xmark", android: "close" }} size={24} tintColor={theme.text} />
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.modalContent}>{filterForm}</ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  </SafeAreaView></ThemedView>;
}

const styles = StyleSheet.create({
  page: { flex: 1 }, container: { flex: 1, width: "100%", maxWidth: 640, alignSelf: "center" }, content: { paddingBottom: 24 },
  header: { gap: 8, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 4 },
  business: { flexDirection: "row", alignItems: "center", gap: 8 }, customer: { flex: 1 },
  heading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" },
  title: { fontSize: 30, lineHeight: 36, fontWeight: "700", letterSpacing: -0.6 },
  newButton: { minHeight: 48, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 28, flexDirection: "row", alignItems: "center", gap: 6 },
  search: { position: "relative" }, searchInput: { paddingLeft: 44, paddingRight: 44, borderRadius: 12 },
  searchIcon: { position: "absolute", left: 14, top: 0, bottom: 0, justifyContent: "center" },
  clearSearch: { position: "absolute", right: 0, top: 0, bottom: 0, width: 48, alignItems: "center", justifyContent: "center" },
  filterBar: { flexDirection: "row", gap: 8, alignItems: "center" }, filterChips: { gap: 8 },
  chip: { minHeight: 48, borderWidth: 1, borderRadius: 28, paddingHorizontal: 14, paddingVertical: 8, justifyContent: "center" },
  filterButton: { minHeight: 48, minWidth: 48, borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center" },
  applied: { minHeight: 48, justifyContent: "center" },
  day: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10 },
  order: { paddingHorizontal: 16, paddingVertical: 8, gap: 4, borderBottomWidth: StyleSheet.hairlineWidth },
  orderHeading: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "baseline", columnGap: 12 },
  customerName: { fontWeight: "700", flexGrow: 1, flexShrink: 1, flexBasis: 160 }, amount: { fontWeight: "700", fontVariant: ["tabular-nums"] },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 2 }, badge: { borderRadius: 20, paddingHorizontal: 9, paddingVertical: 2 },
  footer: { gap: 8, padding: 16 }, filters: { gap: 16 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  field: { gap: 8 }, date: { flex: 1, minWidth: 130, gap: 4 }, notice: { gap: 8, padding: 16, borderRadius: 8 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16 },
  modalContent: { padding: 16, paddingBottom: 32, width: "100%", maxWidth: 640, alignSelf: "center" },
});
