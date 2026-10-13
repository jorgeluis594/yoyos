/** @jsxImportSource react */
// Preserve native Pressable style callbacks outside NativeWind interop.
import { SymbolView } from "expo-symbols";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useRef, useState } from "react";
import { BackHandler, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, SectionList, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import type { ListOrderAggregatesResponse } from "@shared/contracts/orders";
import { orders } from "@mobile/features/orders/composition";
import { deliverySettings } from "@mobile/features/delivery-settings/composition";
import { ThemedText } from "@mobile/components/themed-text";
import { ThemedView } from "@mobile/components/themed-view";
import { Button } from "@mobile/components/ui/button";
import { Input } from "@mobile/components/ui/input";
import { ScreenState } from "@mobile/components/ui/screen-state";
import { useAccess } from "@mobile/features/users/presentation/access-provider";
import { usePendingOrders } from "@mobile/features/orders/presentation/pending-order-sync-provider";
import { useDispatchPrint } from "@mobile/features/orders/presentation/dispatch-print-review";
import { useOrderSelection } from "@mobile/features/orders/presentation/use-order-selection";
import { OrderBuyerName } from "@mobile/features/orders/presentation/order-buyer";
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
  const [criteria, setCriteria] = useState<OrderListCriteria>({ page: 1, customer: { kind: "all" } });
  const [now, setNow] = useState(() => new Date());
  const [search, setSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterError, setFilterError] = useState("");
  const previousCriteria = useRef(criteria);
  const [fromDay, setFromDay] = useState("");
  const [throughDay, setThroughDay] = useState("");
  const [customerKind, setCustomerKind] = useState<"all" | "general_public">("all");
  const [deliveryStatus, setDeliveryStatus] = useState<NonNullable<OrderListCriteria["deliveryStatus"]> | "">("");
  const [courierId, setCourierId] = useState("");
  const [couriers, setCouriers] = useState<{ id: string; name: string }[]>([]);
  const [unscheduled, setUnscheduled] = useState(false);
  const [scheduledFrom, setScheduledFrom] = useState("");
  const [scheduledThrough, setScheduledThrough] = useState("");
  const [shippedFromDay, setShippedFromDay] = useState("");
  const [shippedThroughDay, setShippedThroughDay] = useState("");
  const [items, setItems] = useState<Summary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const { pending } = usePendingOrders();
  const activeRequest = useRef(0);
  const companyId = state.status === "ready" ? state.company.id : "";
  const dispatchPrint = useDispatchPrint();
  const selection = useOrderSelection(`${companyId}|${JSON.stringify({ ...criteria, page: 0 })}`);
  const clearSelection = selection.clear;
  useFocusEffect(useCallback(() => {
    if (!selection.count) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => { clearSelection(); return true; });
    return () => subscription.remove();
  }, [selection.count, clearSelection]));

  const reload = useCallback(async (_company: string, filters: OrderListCriteria) => {
    const request = ++activeRequest.current;
    setLoading(true);
    const list = await orders.loadMixedOrders(filters);
    if (request !== activeRequest.current) return;
    if (list.success) { setItems(list.data.items); setTotal(list.data.total); setError(""); }
    else setError(list.error.code === "INVALID_INPUT" ? translations.t('filterInputError') : translations.t('loadOrdersError'));
    setLoading(false);
  }, []);
  const waiting = pending?.success ? pending.data.filter(sale => !sale.rejection).length : 0;
  const rejectedCount = pending?.success ? pending.data.length - waiting : 0;
  const sent = useRef(waiting);
  // A queued sale that reached core shows up in the list without a manual refresh.
  useEffect(() => {
    if (waiting < sent.current && companyId) void reload(companyId, criteria);
    sent.current = waiting;
  }, [waiting, companyId, criteria, reload]);
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
    if (!companyId || !filtersOpen) return;
    let active = true;
    // Includes disabled couriers: past orders keep their courier snapshot.
    void deliverySettings.get().then((result) => { if (active && result.success) setCouriers(result.data.couriers.map(({ id, name }) => ({ id, name }))); });
    return () => { active = false; };
  }, [companyId, filtersOpen]);

  if (state.status !== "ready") return null;
  const language = orderLanguage(state.company.country, i18n.language);

  const apply = () => {
    if ((fromDay && !z.iso.date().safeParse(fromDay).success) ||
      (throughDay && !z.iso.date().safeParse(throughDay).success) || (fromDay && throughDay && fromDay > throughDay) ||
      (scheduledFrom && scheduledThrough && scheduledFrom > scheduledThrough) || (shippedFromDay && shippedThroughDay && shippedFromDay > shippedThroughDay)) {
      setFilterError(t('orderListFilterError')); return;
    }
    setCriteria({ search: criteria.search, view: criteria.view, page: 1, customer: { kind: customerKind },
      ...(fromDay ? { fromDay } : {}), ...(throughDay ? { throughDay } : {}),
      ...(deliveryStatus ? { deliveryStatus } : {}), ...(courierId ? { courierId } : {}),
      ...(unscheduled ? { unscheduled: true as const } : { ...(scheduledFrom ? { scheduledFrom } : {}), ...(scheduledThrough ? { scheduledThrough } : {}) }),
      ...(shippedFromDay ? { shippedFromDay } : {}), ...(shippedThroughDay ? { shippedThroughDay } : {}) });
    setFiltersOpen(false); setFilterError("");
  };

  const advanced = criteria.customer.kind !== "all" || !!criteria.fromDay || !!criteria.throughDay ||
    !!criteria.deliveryStatus || !!criteria.courierId || !!criteria.unscheduled || !!criteria.scheduledFrom || !!criteria.scheduledThrough || !!criteria.shippedFromDay || !!criteria.shippedThroughDay;
  const filtered = advanced || !!criteria.search || (!!criteria.view && criteria.view !== "all");
  const openFilters = () => {
    setCustomerKind(criteria.customer.kind);
    setFromDay(criteria.fromDay ?? ""); setThroughDay(criteria.throughDay ?? "");
    setDeliveryStatus(criteria.deliveryStatus ?? ""); setCourierId(criteria.courierId ?? ""); setUnscheduled(!!criteria.unscheduled);
    setScheduledFrom(criteria.scheduledFrom ?? ""); setScheduledThrough(criteria.scheduledThrough ?? "");
    setShippedFromDay(criteria.shippedFromDay ?? ""); setShippedThroughDay(criteria.shippedThroughDay ?? "");
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
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll} contentContainerStyle={styles.filterChips}>
        {(["all", "unpaid", "undelivered"] as const).map((view) => <Pressable key={view} accessibilityRole="button"
          accessibilityState={{ selected: (criteria.view ?? "all") === view }} onPress={() => setCriteria({ ...criteria, page: 1, view })}
          style={({ pressed }) => [styles.chip, { borderColor: theme.input, backgroundColor: (criteria.view ?? "all") === view || pressed ? theme.backgroundSelected : theme.background }]}>
          {(criteria.view ?? "all") === view ? <SymbolView name={{ ios: "checkmark", android: "check" }} size={18} tintColor={theme.primary} /> : null}
          <ThemedText type="small" style={{ flexShrink: 1, color: (criteria.view ?? "all") === view ? theme.primary : theme.textSecondary, fontWeight: (criteria.view ?? "all") === view ? "600" : "400" }}>{t(view === "all" ? 'all' : view === "unpaid" ? 'orderListUnpaid' : 'orderListUndelivered')}</ThemedText>
        </Pressable>)}
      </ScrollView>
      <Pressable accessibilityRole="button" accessibilityLabel={t('orderListFilters')} accessibilityState={{ selected: advanced }} onPress={openFilters}
        style={[styles.filterAction, { backgroundColor: advanced ? theme.backgroundSelected : theme.background }]}>
        <SymbolView name={{ ios: "slider.horizontal.3", android: "tune" }} size={22} tintColor={advanced ? theme.primary : theme.textSecondary} />
      </Pressable>
    </View>
    {advanced ? <Pressable accessibilityRole="button" accessibilityLabel={t('orderListClear')} onPress={() => setCriteria({ page: 1, customer: { kind: "all" }, search: criteria.search, view: criteria.view })} style={styles.applied}>
      <ThemedText type="small" style={{ color: theme.primary }}>{t('orderListFiltered')} · {t('orderListClear')}</ThemedText>
    </Pressable> : null}
    {selection.count ? <View style={styles.selectionBar}>
        <ThemedText type="small" accessibilityRole="summary">{t('orderListSelected', { count: selection.count, total: money(selection.total.amount, selection.total.currency, locale) })}</ThemedText>
        <Button variant="ghost" onPress={selection.clear}>{t('orderListClearSelection')}</Button>
        {Platform.OS === "android" ? <Button disabled={dispatchPrint.active} onPress={() => dispatchPrint.open([...selection.orders.values()])}>{t('orderListPrintLabels')}</Button> : null}
    </View> : null}
    {Platform.OS === "android" && dispatchPrint.active ? <Button variant="secondary" onPress={dispatchPrint.show}>{t('dispatchViewBatch')}</Button> : null}
    {waiting ? <ThemedText type="small" themeColor="textSecondary" accessibilityLiveRegion="polite">{t('salesSending', { count: waiting })}</ThemedText> : null}
    {rejectedCount || (pending && !pending.success) ? <View style={[styles.notice, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText type="smallBold">{pending && !pending.success ? t('pendingReadError') : t('rejectedSalesHint', { count: rejectedCount })}</ThemedText>
      <Button variant="secondary" onPress={() => router.push("/orders/new")}>{t('reviewRejectedSale')}</Button>
    </View> : null}
  </View>;

  const filterForm = <View style={styles.filters}>
      <ThemedText type="subtitle" accessibilityRole="header">{t('orderListCustomer')}</ThemedText>
      <View style={styles.row}>
        <Button variant={customerKind === "all" ? "default" : "secondary"} onPress={() => setCustomerKind("all")}>{t('all')}</Button>
        <Button variant={customerKind === "general_public" ? "default" : "secondary"} onPress={() => setCustomerKind("general_public")}>{t('generalPublic')}</Button>
      </View>
      <ThemedText type="subtitle" accessibilityRole="header">{t('orderListCreated')}</ThemedText>
      <View style={styles.row}>
        <View style={styles.date}><OrderDayField label={t('from')} value={fromDay} onChange={setFromDay} /></View>
        <View style={styles.date}><OrderDayField label={t('through')} value={throughDay} onChange={setThroughDay} /></View>
      </View>
      <ThemedText type="subtitle" accessibilityRole="header">{t('orderListDispatchStatus')}</ThemedText>
      <View style={styles.row}>
        {(["", "pending", "shipped", "delivered"] as const).map((status) => <Button key={status || "all"} variant={deliveryStatus === status ? "default" : "secondary"}
          onPress={() => setDeliveryStatus(status)}>{status ? deliveryStatusLabel(status, language) : t('all')}</Button>)}
      </View>
      <ThemedText type="subtitle" accessibilityRole="header">{t('orderListCourier')}</ThemedText>
      <View style={styles.row}>
        <Button variant={!courierId ? "default" : "secondary"} onPress={() => setCourierId("")}>{t('all')}</Button>
        {couriers.map((courier) => <Button key={courier.id} variant={courierId === courier.id ? "default" : "secondary"} onPress={() => setCourierId(courier.id)}>{courier.name}</Button>)}
      </View>
      <ThemedText type="subtitle" accessibilityRole="header">{t('orderListScheduled')}</ThemedText>
      <Button variant={unscheduled ? "default" : "secondary"} onPress={() => { setUnscheduled(!unscheduled); setScheduledFrom(""); setScheduledThrough(""); }}>{t('orderListUnscheduled')}</Button>
      {unscheduled ? null : <View style={styles.row}>
        <View style={styles.date}><OrderDayField label={t('orderListScheduledFrom')} value={scheduledFrom} onChange={setScheduledFrom} /></View>
        <View style={styles.date}><OrderDayField label={t('orderListScheduledThrough')} value={scheduledThrough} onChange={setScheduledThrough} /></View>
      </View>}
      <ThemedText type="subtitle" accessibilityRole="header">{t('orderListShipped')}</ThemedText>
      <View style={styles.row}>
        <View style={styles.date}><OrderDayField label={t('orderListShippedFrom')} value={shippedFromDay} onChange={setShippedFromDay} /></View>
        <View style={styles.date}><OrderDayField label={t('orderListShippedThrough')} value={shippedThroughDay} onChange={setShippedThroughDay} /></View>
      </View>
      {filterError ? <ThemedText accessibilityRole="alert" style={{ color: theme.error }}>{filterError}</ThemedText> : null}
      <Button onPress={apply}>{t('applyFilters')}</Button>
      <Button variant="ghost" onPress={() => { setFromDay(""); setThroughDay(""); setDeliveryStatus(""); setCourierId(""); setUnscheduled(false);
        setScheduledFrom(""); setScheduledThrough(""); setShippedFromDay(""); setShippedThroughDay(""); setCustomerKind("all"); setFilterError(""); }}>{t('orderListClear')}</Button>
    </View>;

  return <ThemedView style={styles.page}><SafeAreaView style={styles.page} edges={["top", "left", "right"]}>
    <View style={styles.container}>
      <SectionList sections={error ? [] : sections} keyExtractor={(item) => item.id} style={styles.page}
        keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" stickySectionHeadersEnabled={false}
        refreshing={loading && items.length > 0} onRefresh={() => void reload(companyId, criteria)}
        contentContainerStyle={styles.content} ListHeaderComponent={header}
        renderSectionHeader={({ section }) => <ThemedText type="small" themeColor="textSecondary" accessibilityRole="header" style={styles.day}>{sectionTitle(section.title)}</ThemedText>}
        ListEmptyComponent={<ScreenState status={loading ? "loading" : error ? "error" : filtered ? "no-results" : "empty"}
          title={loading ? t('loadingOrders') : error ? t('loadOrdersTitle') : filtered ? t('noResults') : t('noOrders')}
          description={error || (!loading ? t('ordersEmptyHint') : undefined)} onRetry={error ? () => void reload(companyId, criteria) : undefined} />}
        renderItem={({ item, index, section }) => {
          const selected = selection.orders.has(item.id);
          const first = index === 0, last = index === section.data.length - 1;
          return <Pressable accessibilityRole="button" accessibilityState={{ selected }} accessibilityHint={t('orderListSelectHint')}
            accessibilityActions={[{ name: "select", label: t('orderListSelect', { number: item.number }) }]} onAccessibilityAction={() => selection.toggle(item)}
            onPress={() => selection.count ? selection.toggle(item) : router.push(`/orders/${item.id}`)} onLongPress={() => { if (!selected) selection.toggle(item); }}
            style={({ pressed }) => [styles.order, {
              backgroundColor: selected || pressed ? theme.backgroundSelected : theme.backgroundElement, borderColor: theme.border,
              borderTopWidth: first ? StyleSheet.hairlineWidth : 0,
              borderTopLeftRadius: first ? 12 : 0, borderTopRightRadius: first ? 12 : 0,
              borderBottomLeftRadius: last ? 12 : 0, borderBottomRightRadius: last ? 12 : 0,
            }]}>
          {selection.count ? <SymbolView name={{ ios: selected ? "checkmark.circle.fill" : "circle", android: selected ? "check_circle" : "radio_button_unchecked" }} size={24} tintColor={selected ? theme.primary : theme.textSecondary} /> : null}
          <View style={styles.orderText}>
            <OrderBuyerName buyer={item.buyer} source={item.source} style={styles.customerName} />
            <ThemedText type="small" themeColor="textSecondary">#{item.number} · {timeLabel(item.createdAt, locale)}</ThemedText>
            {item.status === "cancelled" || item.status === "completed" ? <View style={[styles.badge, { backgroundColor: item.status === "completed" ? theme.successSurface : theme.secondary }]}>
              <ThemedText type="small" style={{ color: item.status === "completed" ? theme.success : theme.textSecondary }}>{t(item.status === "completed" ? 'orderListCompleted' : 'orderListCancelled')}</ThemedText>
            </View> : <View style={styles.badges}>
              <View style={styles.statusLine}>
                <SymbolView name={{ ios: item.paymentStatus === "paid" ? "checkmark.circle.fill" : "clock", android: item.paymentStatus === "paid" ? "check_circle" : "schedule" }} size={16} tintColor={item.paymentStatus === "paid" ? theme.success : theme.warning} />
                <ThemedText type="small" style={{ flexShrink: 1, color: item.paymentStatus === "paid" ? theme.success : theme.warning }}>{t(item.paymentStatus === "paid" ? 'orderListPaid' : 'orderListPaymentPending')}</ThemedText>
              </View>
              <View style={styles.statusLine}>
                <SymbolView name={{ ios: "shippingbox", android: "local_shipping" }} size={16} tintColor={theme.textSecondary} />
                <ThemedText type="small" themeColor="textSecondary" style={styles.statusText}>{deliveryStatusLabel(item.deliveryStatus, language)}</ThemedText>
              </View>
            </View>}
            {item.scheduledDispatchDate || item.courier ? <ThemedText type="small" themeColor="textSecondary">{[item.scheduledDispatchDate && t('orderListScheduledOn', { date: item.scheduledDispatchDate }), item.courier?.name].filter(Boolean).join(" · ")}</ThemedText> : null}
            {item.checkoutEnabledAt ? <ThemedText type="small" themeColor="textSecondary">{t(item.status === "cancelled" ? "checkoutCancelled" : item.checkoutConfirmedAt ? "checkoutConfirmed" : "checkoutPending")}</ThemedText> : null}
          </View>
          <ThemedText style={styles.amount}>{money(item.total.amount, item.total.currency, locale)}</ThemedText>
        </Pressable>;
        }}
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
  filterBar: { flexDirection: "row", alignItems: "center", gap: 8 },
  filterScroll: { flex: 1, minWidth: 0 },
  filterAction: { minHeight: 48, width: 48, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  filterChips: { alignItems: "center", gap: 8 },
  chip: { minHeight: 48, borderWidth: 1, borderRadius: 28, paddingHorizontal: 8, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0, justifyContent: "center" },
  filterButton: { minHeight: 48, minWidth: 48, borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center" },
  applied: { minHeight: 48, justifyContent: "center" },
  day: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10 },
  selectionBar: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  order: { marginHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, paddingVertical: 10, minHeight: 72, borderBottomWidth: StyleSheet.hairlineWidth, borderLeftWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth },
  orderText: { flex: 1, minWidth: 0, gap: 2 },
  customerName: { fontWeight: "600" }, amount: { fontWeight: "600", fontVariant: ["tabular-nums"], textAlign: "right", maxWidth: "40%" },
  badges: { flexDirection: "row", flexWrap: "wrap", columnGap: 12, rowGap: 2 }, badge: { alignSelf: "flex-start", borderRadius: 20, paddingHorizontal: 9, paddingVertical: 2 },
  statusLine: { flexDirection: "row", alignItems: "center", gap: 4 }, statusText: { flexShrink: 1 },
  footer: { gap: 8, padding: 16 }, filters: { gap: 16 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  field: { gap: 8 }, date: { flex: 1, minWidth: 130, gap: 4 }, notice: { gap: 8, padding: 16, borderRadius: 8 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16 },
  modalContent: { padding: 16, paddingBottom: 32, width: "100%", maxWidth: 640, alignSelf: "center" },
});
