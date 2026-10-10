/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { SymbolView } from "expo-symbols";
import { useFocusEffect, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { ThemedText } from "@mobile/components/themed-text";
import { ThemedView } from "@mobile/components/themed-view";
import { Button } from "@mobile/components/ui/button";
import { Input } from "@mobile/components/ui/input";
import { useTheme } from "@mobile/hooks/use-theme";
import { ScreenState } from "@mobile/components/ui/screen-state";
import { products } from "@mobile/features/products/composition";
import { useAccess } from "@mobile/features/users/presentation/access-provider";
import { usePrint } from "@mobile/features/printing/presentation/print-provider";
import type { ProductListItem, ProductSort, StockFilter } from "@mobile/features/products/domain/product";
import translations from "@mobile/i18n";

const PAGE_SIZE = 20;
const STOCK_FILTERS = ["all", "in_stock", "sold_out"] as const;
type Filter = (typeof STOCK_FILTERS)[number];
type Query = Readonly<{ search: string; stock: Filter; sort: ProductSort }>;
const queryKey = (query: Query) => `${query.stock}:${query.sort}:${query.search}`;
const criteriaOf = (query: Query, page: number) => ({
  ...(query.search ? { search: query.search } : {}),
  ...(query.stock === "all" ? {} : { stock: query.stock as StockFilter }),
  ...(query.sort === "recent" ? {} : { sort: query.sort }),
  page, pageSize: PAGE_SIZE,
} as const);
const formatMoney = (amount: number, currency: string, locale: string) => new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);

export default function CatalogScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'pt-BR' ? 'pt-BR' : 'es-PE';
  const { state } = useAccess();
  const { showPrinterPicker } = usePrint();
  const [search, setSearch] = useState("");
  const [stock, setStock] = useState<Filter>("all");
  const [sort, setSort] = useState<ProductSort>("recent");
  const [items, setItems] = useState<readonly ProductListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryMode, setRetryMode] = useState<"refresh" | "more">("refresh");
  const requestId = useRef(0);
  const itemsRef = useRef(items);
  const hasLoadedRef = useRef(false);
  const loadingMoreRef = useRef(false);
  const query = useMemo<Query>(() => ({ search: search.trim(), stock, sort }), [search, stock, sort]);
  const currentKey = queryKey(query);
  const queryRef = useRef(query);
  useEffect(() => { itemsRef.current = items; }, [items]);
  useEffect(() => { queryRef.current = query; }, [query]);
  const invalidateRequests = useCallback(() => { requestId.current++; }, []);

  const reload = useCallback(async (current: Query, preserve: boolean) => {
    const ticket = ++requestId.current;
    const oldItems = preserve ? itemsRef.current : [];
    const count = Math.max(1, Math.ceil(oldItems.length / PAGE_SIZE));
    setError(null);
    setRetryMode("refresh");
    if (!preserve) setLoading(true);
    setRefreshing(preserve);
    const pages: ProductListItem[] = [];
    let pageTotal = 0;
    for (let page = 1; page <= count; page++) {
      const result = await products.loadProducts(criteriaOf(current, page));
      if (ticket !== requestId.current) return;
      if (!result.success) {
        setError(translations.t('catalogLoadError'));
        if (!preserve) { setItems([]); setTotal(0); }
        setLoadedKey(queryKey(current));
        setLoading(false);
        setRefreshing(false);
        hasLoadedRef.current = true;
        return;
      }
      pages.push(...result.data.items);
      pageTotal = result.data.total;
      if (pages.length >= pageTotal || result.data.items.length < PAGE_SIZE) break;
    }
    if (ticket !== requestId.current) return;
    setItems(pages);
    setTotal(pageTotal);
    setLoadedKey(queryKey(current));
    setLoading(false);
    setRefreshing(false);
    hasLoadedRef.current = true;
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => { void reload(query, false); }, 250);
    return () => { clearTimeout(timer); invalidateRequests(); setRefreshing(false); };
  }, [query, reload, invalidateRequests]);

  useFocusEffect(useCallback(() => {
    if (hasLoadedRef.current) void reload(queryRef.current, true);
    return undefined;
  }, [reload]));

  const loadMore = async () => {
    const current = queryRef.current;
    const ticket = requestId.current;
    const loadedCount = itemsRef.current.length;
    if (loadingMoreRef.current || loadedCount >= total) return;
    const page = Math.floor(loadedCount / PAGE_SIZE) + 1;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setRetryMode("more");
    const result = await products.loadProducts(criteriaOf(current, page));
    if (ticket !== requestId.current || queryKey(current) !== queryKey(queryRef.current)) {
      loadingMoreRef.current = false;
      setLoadingMore(false);
      return;
    }
    if (result.success) {
      setItems((existing) => existing.length === loadedCount ? [...existing, ...result.data.items] : existing);
      setTotal(result.data.total);
      setError(null);
    } else setError(t('catalogMoreError'));
    loadingMoreRef.current = false;
    setLoadingMore(false);
  };

  if (state.status !== "ready") return null;
  const pending = loading || loadedKey !== currentKey;
  const filtered = stock !== "all";
  const price = (item: ProductListItem) => formatMoney(item.price.amount, item.price.currency, locale);
  const detail = (item: ProductListItem) => item.variantCount > 1 ? t('variantCount', { count: item.variantCount }) : item.sku ? `SKU ${item.sku}` : t('noSku');

  const header = <View style={styles.header}>
    <View style={styles.business}>
      <SymbolView name={{ ios: "storefront", android: "storefront" }} size={20} tintColor={theme.primary} />
      <ThemedText type="small" themeColor="textSecondary" style={styles.flexText}>{state.company.name}</ThemedText>
    </View>
    <View style={styles.heading}>
      <ThemedText accessibilityRole="header" style={styles.title}>{t('products')}</ThemedText>
      <View style={styles.actions}>
        {Platform.OS === "android" ? <Pressable accessibilityRole="button" accessibilityLabel={t('configurePrinter')} onPress={showPrinterPicker}
          style={({ pressed }) => [styles.iconButton, pressed ? { backgroundColor: theme.backgroundSelected } : null]}>
          <SymbolView name={{ ios: "printer", android: "print" }} size={24} tintColor={theme.text} />
        </Pressable> : null}
        <Pressable accessibilityRole="button" accessibilityLabel={t('addProduct')} onPress={() => router.push("/products/new")}
          style={({ pressed }) => [styles.newButton, { backgroundColor: pressed ? theme.primaryPressed : theme.primary }]}>
          <SymbolView name={{ ios: "plus", android: "add" }} size={22} tintColor={theme.primaryForeground} />
          <ThemedText style={{ color: theme.primaryForeground, fontWeight: "600" }}>{t('catalogNew')}</ThemedText>
        </Pressable>
      </View>
    </View>
    <View>
      <Input value={search} onChangeText={setSearch} accessibilityLabel={t('searchProducts')} placeholder={t('nameOrSku')}
        returnKeyType="search" autoCapitalize="none" autoCorrect={false} style={styles.searchInput} />
      <View pointerEvents="none" style={styles.searchIcon}><SymbolView name={{ ios: "magnifyingglass", android: "search" }} size={22} tintColor={theme.textSecondary} /></View>
      {search ? <Pressable accessibilityRole="button" accessibilityLabel={t('clearSearchText')} onPress={() => setSearch("")} style={styles.clearSearch}>
        <SymbolView name={{ ios: "xmark.circle.fill", android: "cancel" }} size={20} tintColor={theme.textSecondary} />
      </Pressable> : null}
    </View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      {STOCK_FILTERS.map((filter) => {
        const selected = stock === filter;
        return <Pressable key={filter} accessibilityRole="button" accessibilityState={{ selected }} onPress={() => setStock(filter)}
          style={({ pressed }) => [styles.chip, { borderColor: selected ? theme.backgroundSelected : theme.input, backgroundColor: selected || pressed ? theme.backgroundSelected : theme.background }]}>
          {selected ? <SymbolView name={{ ios: "checkmark", android: "check" }} size={18} tintColor={theme.primary} /> : null}
          <ThemedText type="small" style={{ color: selected ? theme.primary : theme.text, fontWeight: selected ? "600" : "400" }}>
            {t(filter === "all" ? 'catalogFilterAll' : filter === "in_stock" ? 'catalogFilterInStock' : 'catalogFilterSoldOut')}
          </ThemedText>
        </Pressable>;
      })}
    </ScrollView>
    <View style={styles.toolbar}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.flexText}>{pending ? " " : t('productCount', { count: total })}</ThemedText>
      <Pressable accessibilityRole="button" accessibilityLabel={t('catalogSortLabel', { sort: t(sort === "recent" ? 'catalogSortRecent' : 'catalogSortName') })}
        accessibilityHint={t('catalogSortHint')} onPress={() => setSort(sort === "recent" ? "name" : "recent")}
        style={({ pressed }) => [styles.sort, pressed ? { backgroundColor: theme.backgroundSelected } : null]}>
        <SymbolView name={{ ios: "arrow.up.arrow.down", android: "swap_vert" }} size={18} tintColor={theme.text} />
        <ThemedText type="small" style={{ fontWeight: "600" }}>{t(sort === "recent" ? 'catalogSortRecent' : 'catalogSortName')}</ThemedText>
      </Pressable>
    </View>
  </View>;

  const empty = pending ? <ScreenState status="loading" title={t('loadingProducts')} />
    : error ? <ScreenState status="error" title={t('catalogLoadTitle')} description={t('retryConnection')} onRetry={() => void reload(queryRef.current, false)} />
    : query.search && filtered ? <ScreenState status="no-results" title={t('catalogSearchFilterEmpty')} description={t('catalogSearchFilterEmptyHint')} action={<Button variant="secondary" onPress={() => { setSearch(""); setStock("all"); }}>{t('catalogClearFilters')}</Button>} />
    : query.search ? <ScreenState status="no-results" title={t('noResults')} description={t('searchOtherProduct')} action={<Button variant="secondary" onPress={() => setSearch("")}>{t('clearSearch')}</Button>} />
    : filtered ? <ScreenState status="no-results" title={t('catalogFilterEmpty')} description={t('catalogFilterEmptyHint')} action={<Button variant="secondary" onPress={() => setStock("all")}>{t('catalogShowAll')}</Button>} />
    : <ScreenState status="empty" title={t('noProducts')} description={t('createFirstProduct')} />;

  const data = pending || (error && !items.length) ? [] : items;
  return <ThemedView style={styles.page}><SafeAreaView style={styles.page} edges={["top", "left", "right"]}>
    <View style={styles.container}>
      <FlatList
        data={data}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void reload(queryRef.current, true)} />}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListHeaderComponent={header}
        ListEmptyComponent={<View style={styles.state}>{empty}</View>}
        renderItem={({ item, index }) => <Pressable
          accessibilityRole="button"
          accessibilityHint={t('viewEditProduct')}
          onPress={() => router.push(`/products/${item.id}`)}
          style={({ pressed }) => [styles.product, {
            backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement, borderColor: theme.border,
            borderTopWidth: index === 0 ? StyleSheet.hairlineWidth : 0,
            borderTopLeftRadius: index === 0 ? 12 : 0, borderTopRightRadius: index === 0 ? 12 : 0,
            borderBottomLeftRadius: index === data.length - 1 ? 12 : 0, borderBottomRightRadius: index === data.length - 1 ? 12 : 0,
          }]}
        >
          {item.photo ? <Image source={{ uri: item.photo.url }} style={[styles.thumb, { backgroundColor: theme.backgroundSelected }]} contentFit="cover" accessible={false} />
            : <View style={[styles.thumb, styles.noPhoto, { borderColor: theme.border, backgroundColor: theme.background }]}>
              <SymbolView name={{ ios: "photo", android: "image" }} size={22} tintColor={theme.textSecondary} />
            </View>}
          <View style={styles.productText}>
            <ThemedText style={styles.productName}>{item.name}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {item.stock === 0 ? <ThemedText type="small" style={{ color: theme.error, fontWeight: "600" }}>{t('catalogSoldOut')}</ThemedText> : t('catalogStock', { count: item.stock })}
              {` · ${detail(item)}`}
            </ThemedText>
          </View>
          <View style={styles.price}>
            {item.priceFrom ? <ThemedText type="small" themeColor="textSecondary">{t('catalogFrom')}</ThemedText> : null}
            <ThemedText style={styles.amount}>{price(item)}</ThemedText>
          </View>
        </Pressable>}
        ListFooterComponent={error && items.length ? <View style={styles.footer}><ThemedText accessibilityRole="alert" style={{ color: theme.error }}>{error}</ThemedText><Button variant="secondary" loading={loadingMore || refreshing} onPress={() => retryMode === "more" ? void loadMore() : void reload(queryRef.current, true)}>{t('retry')}</Button></View>
          : !pending && items.length < total ? <View style={styles.footer}><Button variant="secondary" loading={loadingMore} onPress={() => void loadMore()}>{t('loadMore')}</Button></View> : null}
        contentContainerStyle={styles.list}
      />
    </View>
  </SafeAreaView></ThemedView>;
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  container: { flex: 1, width: "100%", maxWidth: 640, alignSelf: "center" },
  list: { paddingHorizontal: 16, paddingBottom: 24 },
  header: { gap: 12, paddingTop: 4, paddingBottom: 8 },
  business: { flexDirection: "row", alignItems: "center", gap: 8 },
  flexText: { flex: 1 },
  heading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" },
  title: { fontSize: 30, lineHeight: 36, fontWeight: "700", letterSpacing: -0.6 },
  actions: { flexDirection: "row", alignItems: "center", gap: 8 },
  iconButton: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  newButton: { minHeight: 48, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 28, flexDirection: "row", alignItems: "center", gap: 6 },
  searchInput: { paddingLeft: 44, paddingRight: 44, borderRadius: 12 },
  searchIcon: { position: "absolute", left: 14, top: 0, bottom: 0, justifyContent: "center" },
  clearSearch: { position: "absolute", right: 0, top: 0, bottom: 0, width: 48, alignItems: "center", justifyContent: "center" },
  chips: { gap: 8, alignItems: "center" },
  chip: { minHeight: 48, borderWidth: 1, borderRadius: 28, paddingHorizontal: 14, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 6 },
  toolbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  sort: { minHeight: 48, paddingHorizontal: 8, borderRadius: 6, flexDirection: "row", alignItems: "center", gap: 6 },
  state: { paddingVertical: 24 },
  product: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, paddingVertical: 10, minHeight: 72, borderBottomWidth: StyleSheet.hairlineWidth, borderLeftWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth },
  thumb: { width: 48, height: 48, borderRadius: 8 },
  noPhoto: { borderWidth: 1, borderStyle: "dashed", alignItems: "center", justifyContent: "center" },
  productText: { flex: 1, minWidth: 0, gap: 2 },
  productName: { fontWeight: "600" },
  price: { alignItems: "flex-end", maxWidth: "40%" },
  amount: { fontVariant: ["tabular-nums"], fontWeight: "600", textAlign: "right" },
  footer: { alignItems: "center", gap: 8, paddingTop: 16 },
});
