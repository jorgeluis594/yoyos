/** @jsxImportSource react */
import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Platform, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
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
import type { ProductListItem } from "@mobile/features/products/domain/product";
import translations from "@mobile/i18n";

const PAGE_SIZE = 20;
const formatMoney = (amount: number, currency: string, locale: string) => new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);

export default function CatalogScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'pt-BR' ? 'pt-BR' : 'es-PE';
  const { state } = useAccess();
  const { showPrinterPicker } = usePrint();
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<readonly ProductListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loadedSearch, setLoadedSearch] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryMode, setRetryMode] = useState<"refresh" | "more">("refresh");
  const requestId = useRef(0);
  const itemsRef = useRef(items);
  const hasLoadedRef = useRef(false);
  const loadingMoreRef = useRef(false);
  const searchRef = useRef(search);
  useEffect(() => { itemsRef.current = items; searchRef.current = search; }, [items, search]);
  const invalidateRequests = useCallback(() => { requestId.current++; }, []);

  const reload = useCallback(async (query: string, preserve: boolean) => {
    const ticket = ++requestId.current;
    const oldItems = preserve ? itemsRef.current : [];
    const count = Math.max(1, Math.ceil(oldItems.length / PAGE_SIZE));
    setError(null);
    setRetryMode("refresh");
    if (!preserve) setLoading(true);
    else setRefreshing(true);
    const pages: ProductListItem[] = [];
    let pageTotal = 0;
    for (let page = 1; page <= count; page++) {
      const result = await products.loadProducts({ search: query || undefined, page, pageSize: PAGE_SIZE });
      if (ticket !== requestId.current) return;
      if (!result.success) {
        setError(translations.t('catalogLoadError'));
        if (!preserve) { setItems([]); setTotal(0); }
        setLoadedSearch(query);
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
    setLoadedSearch(query);
    setLoading(false);
    setRefreshing(false);
    hasLoadedRef.current = true;
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => { void reload(search.trim(), false); }, 250);
    return () => { clearTimeout(timer); invalidateRequests(); };
  }, [search, reload, invalidateRequests]);

  useFocusEffect(useCallback(() => {
    if (hasLoadedRef.current) void reload(searchRef.current.trim(), true);
    return undefined;
  }, [reload]));

  const loadMore = async () => {
    const query = searchRef.current.trim();
    const ticket = requestId.current;
    const loadedCount = itemsRef.current.length;
    if (loadingMoreRef.current || loadedCount >= total) return;
    const page = Math.floor(loadedCount / PAGE_SIZE) + 1;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setRetryMode("more");
    const result = await products.loadProducts({ search: query || undefined, page, pageSize: PAGE_SIZE });
    if (ticket !== requestId.current || query !== searchRef.current.trim()) {
      loadingMoreRef.current = false;
      setLoadingMore(false);
      return;
    }
    if (result.success) {
      setItems((current) => current.length === loadedCount ? [...current, ...result.data.items] : current);
      setTotal(result.data.total);
      setError(null);
    } else setError(t('catalogMoreError'));
    loadingMoreRef.current = false;
    setLoadingMore(false);
  };

  if (state.status !== "ready") return null;
  const normalizedSearch = search.trim();
  const queryPending = loadedSearch !== normalizedSearch;
  return <ThemedView style={styles.page}><SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
    <View style={styles.header}>
      <ThemedText type="title" accessibilityRole="header">{t('products')}</ThemedText>
      <ThemedText themeColor="textSecondary">{state.company.name}</ThemedText>
    </View>
    <Button onPress={() => router.push("/products/new")}>{t('addProduct')}</Button>
    {Platform.OS === "android" ? <Button variant="secondary" onPress={showPrinterPicker}>{t('configurePrinter')}</Button> : null}
    <View style={styles.search}>
      <ThemedText type="small">{t('searchProducts')}</ThemedText>
      <Input value={search} onChangeText={setSearch} placeholder={t('nameOrSku')} accessibilityLabel={t('searchProducts')} returnKeyType="search" autoCapitalize="none" />
    </View>
    {loading || queryPending ? <ScreenState status="loading" title={t('loadingProducts')} /> : error && !items.length
      ? <ScreenState status="error" title={t('catalogLoadTitle')} description={t('retryConnection')} onRetry={() => void reload(search.trim(), false)} />
      : !items.length ? <ScreenState status={normalizedSearch ? "no-results" : "empty"} title={normalizedSearch ? t('noResults') : t('noProducts')} description={normalizedSearch ? t('searchOtherProduct') : t('createFirstProduct')} action={normalizedSearch ? <Button variant="secondary" onPress={() => setSearch("")}>{t('clearSearch')}</Button> : undefined} />
      : <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void reload(searchRef.current.trim(), true)} />}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ListHeaderComponent={<ThemedText type="small" themeColor="textSecondary">{t('productCount', { count: total })}</ThemedText>}
          renderItem={({ item }) => <Pressable
            accessibilityRole="button"
            accessibilityHint={t('viewEditProduct')}
            onPress={() => router.push(`/products/${item.id}`)}
            style={({ pressed }) => [styles.product, { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement }]}
          >
            <ThemedText type="smallBold">{item.name}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{item.variantCount > 1 ? t('variantCount', { count: item.variantCount }) : item.sku ? `SKU ${item.sku}` : t('noSku')}</ThemedText>
            <View style={styles.productSummary}>
              <ThemedText style={styles.amount}>{item.priceFrom ? t('priceFrom', { amount: formatMoney(item.price.amount, item.price.currency, locale) }) : formatMoney(item.price.amount, item.price.currency, locale)}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{t('stockLabel', { count: item.stock })}</ThemedText>
            </View>
          </Pressable>}
          ListFooterComponent={error ? <View style={styles.footer}><ThemedText accessibilityRole="alert" style={[styles.error, { color: theme.error }]}>{error}</ThemedText><Button variant="secondary" loading={loadingMore || refreshing} onPress={() => retryMode === "more" ? void loadMore() : void reload(searchRef.current.trim(), true)}>{t('retry')}</Button></View> : items.length < total ? <Button variant="secondary" loading={loadingMore} onPress={() => void loadMore()}>{t('loadMore')}</Button> : null}
          contentContainerStyle={styles.list}
        />}
  </SafeAreaView></ThemedView>;
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  safe: { flex: 1, gap: 16, padding: 16, width: "100%", maxWidth: 640, alignSelf: "center" },
  header: { gap: 4, paddingTop: 8 },
  search: { gap: 8 },
  product: { padding: 16, gap: 4, borderRadius: 8 },
  productSummary: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 8 },
  amount: { fontVariant: ["tabular-nums"], fontWeight: "600" },
  list: { gap: 8, paddingBottom: 24 },
  footer: { alignItems: "center", gap: 8 },
  error: { padding: 12 },
});
