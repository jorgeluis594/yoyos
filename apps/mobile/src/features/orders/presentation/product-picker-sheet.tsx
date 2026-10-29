import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import type { z } from "zod";
import type { orderCatalogSchema } from "@shared/contracts/orders";
import { ThemedText } from "@mobile/components/themed-text";
import { Button } from "@mobile/components/ui/button";
import { Input } from "@mobile/components/ui/input";
import { ListRow } from "@mobile/components/ui/list-row";
import { ScreenState } from "@mobile/components/ui/screen-state";
import { useTheme } from "@mobile/hooks/use-theme";
import tokens from "../../../../../../docs/design-tokens.json";

type Product = z.infer<typeof orderCatalogSchema>[number];
type Variant = Product["variants"][number];
type Props = {
  visible: boolean;
  search: string;
  loading: boolean;
  catalog: readonly Product[];
  selected: Product | null;
  addedVariantIds: readonly string[];
  error: string;
  format: (amount: number, currency: string) => string;
  onSearchChange: (value: string) => void;
  onSelect: (product: Product | null) => void;
  onAdd: (product: Product, variant: Variant) => void;
  onClose: () => void;
};

/** Floating product selector: search, product list and variant choice stay inside the sheet so the sale underneath keeps its layout. */
export function ProductPickerSheet({ visible, search, loading, catalog, selected, addedVariantIds, error, format, onSearchChange, onSelect, onAdd, onClose }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <Pressable style={styles.scrim} accessible={false} importantForAccessibility="no" accessibilityElementsHidden onPress={onClose} />
      <SafeAreaView edges={["bottom"]} style={[styles.sheet, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
        <View style={[styles.grab, { backgroundColor: theme.input }]} />
        <View style={styles.header}>
          <ThemedText type="subtitle" accessibilityRole="header" style={styles.flex}>{t('addProducts')}</ThemedText>
          <Button variant="ghost" onPress={onClose}>{t('detailClose')}</Button>
        </View>
        <View style={styles.search}>
          <Input value={search} onChangeText={onSearchChange} accessibilityLabel={t('searchProductsByName')} placeholder={t('searchProductsByName')} />
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.list}>
          {loading ? <ScreenState status="loading" title={t('searchingProducts')} /> : selected ? <View style={styles.variants}>
            <Button variant="ghost" onPress={() => onSelect(null)}>{t('backToProducts')}</Button>
            <ThemedText type="subtitle">{selected.name}</ThemedText>
            {selected.variants.map(variant => <View key={variant.id} style={styles.variant}>
              <View style={styles.flex}>
                <ThemedText type="smallBold">{Object.entries(variant.attributes).map(([key, value]) => `${key}: ${value}`).join(" · ") || variant.sku || t('variant')}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">{format(variant.price, selected.currency)} · {t('stockCount', { count: variant.stock })}</ThemedText>
              </View>
              <Button variant="secondary" disabled={addedVariantIds.includes(variant.id)} onPress={() => onAdd(selected, variant)}>{t('add')}</Button>
            </View>)}
          </View> : catalog.length ? catalog.map(product => <ListRow key={product.id} title={product.name}
            description={t('variantCount', { count: product.variants.length })} onPress={() => onSelect(product)} />)
            : <ScreenState status={search ? "no-results" : "empty"} title={search ? t('noProductsFound') : t('noProductsAvailable')} />}
        </ScrollView>
        {error ? <ThemedText accessibilityRole="alert" accessibilityLiveRegion="polite" style={[styles.error, { color: theme.error }]}>{error}</ThemedText> : null}
      </SafeAreaView>
    </KeyboardAvoidingView>
  </Modal>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)" },
  sheet: { height: "85%", borderTopLeftRadius: tokens.radius.overlay, borderTopRightRadius: tokens.radius.overlay, borderTopWidth: tokens.sizing.borderWidth },
  grab: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginTop: 8 },
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingTop: 8 },
  search: { paddingHorizontal: 16, paddingVertical: 8 },
  list: { paddingHorizontal: 8, paddingBottom: 16 },
  variants: { gap: 8, paddingHorizontal: 8 },
  variant: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
  error: { padding: 16 },
});
