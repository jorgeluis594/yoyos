/** @jsxImportSource react */
// Preserve native Pressable style callbacks outside NativeWind interop.
import { useEffect, useRef, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { SafeAreaView } from "react-native-safe-area-context";
import { ScreenState } from "@/components/ui/screen-state";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Button } from "@/components/ui/button";
import { useTheme } from "@mobile/hooks/use-theme";
import { products } from "@mobile/features/products/composition";
import { useAccess } from "@/features/users/presentation/access-provider";
import type { PhotoSelection, Product, ProductId, VariantId } from "../domain/product";
import { ProductForm } from "./product-form";
import type { ProductFormField, ProductFormValues } from "./product-form";
import { productErrors, validateProductForm, valuesForProduct } from "./product-form-state";
import { useProductNavigationGuard } from "./use-product-navigation-guard";
import { useProductDraft } from "./draft-guard";
import { usePrint } from "@mobile/features/printing/presentation/print-provider";
import { makeCopyCount } from "@mobile/features/printing/composition";
import { productPrintWork } from "./product-print-work";
import translations from '@mobile/i18n';

function applySaved(current: Product, values: ProductFormValues, photo: PhotoSelection): Product {
  const variants = current.variants.length !== 1 ? current.variants : current.variants.map((variant) => ({
    ...variant,
    ...(values.sku.trim() ? { sku: values.sku.trim() } : { sku: undefined }),
    salePrice: { amount: Number(values.salePrice), currency: current.currency },
    ...(values.purchasePrice.trim() ? { purchasePrice: { amount: Number(values.purchasePrice), currency: current.currency } } : { purchasePrice: undefined }),
  }));
  return {
    ...current,
    name: values.name.trim(),
    ...(values.description ? { description: values.description } : { description: undefined }),
    ...(photo.kind === "remove" ? { photo: undefined } : photo.kind === "set" ? { photo: { id: photo.imageId, url: photo.previewUrl ?? current.photo?.url ?? "" } } : {}),
    variants,
  };
}

function sameProduct(left: Product, right: Product) {
  return left.name === right.name && left.description === right.description && left.currency === right.currency &&
    left.photo?.id === right.photo?.id && left.variants.length === right.variants.length &&
    left.variants.every((variant, index) => {
      const other = right.variants[index];
      return variant.id === other.id && JSON.stringify(variant.attributes) === JSON.stringify(other.attributes) &&
        variant.sku === other.sku && variant.salePrice.amount === other.salePrice.amount &&
        variant.salePrice.currency === other.salePrice.currency && variant.purchasePrice?.amount === other.purchasePrice?.amount &&
        variant.purchasePrice?.currency === other.purchasePrice?.currency && variant.stock === other.stock;
    });
}

function mergeDraft(current: Product, fresh: Product, values: ProductFormValues): ProductFormValues {
  const original = valuesForProduct(current);
  const latest = valuesForProduct(fresh);
  return {
    name: values.name === original.name ? latest.name : values.name,
    description: values.description === original.description ? latest.description : values.description,
    sku: values.sku === original.sku ? latest.sku : values.sku,
    salePrice: values.salePrice === original.salePrice ? latest.salePrice : values.salePrice,
    purchasePrice: values.purchasePrice === original.purchasePrice ? latest.purchasePrice : values.purchasePrice,
    stock: values.stock === original.stock ? latest.stock : values.stock,
  };
}

export default function ProductManagementScreen() {
  const { productId } = useLocalSearchParams<{ productId: string }>();
  const router = useRouter();
  const { t } = useTranslation();
  const theme = useTheme();
  const { state } = useAccess();
  const { startAttempt } = usePrint();
  const [product, setProduct] = useState<Product | null>(null);
  const [values, setValues] = useState<ProductFormValues | null>(null);
  const [photo, setPhoto] = useState<PhotoSelection>({ kind: "keep" });
  const [errors, setErrors] = useState<Partial<Record<ProductFormField, string>>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [copies, setCopies] = useState("1");
  const [choosingVariant, setChoosingVariant] = useState(false);
  const { discardVersion } = useProductDraft();
  const discardVersionRef = useRef(discardVersion);
  const requestKey = `${productId}:${reloadKey}`;
  const loading = loadedKey !== requestKey;
  const dirty = !!product && !!values && (
    values.name !== product.name || values.description !== (product.description ?? "") ||
    (product.variants.length === 1 && (values.sku !== (product.variants[0].sku ?? "") || values.salePrice !== product.variants[0].salePrice.amount.toString() || values.purchasePrice !== (product.variants[0].purchasePrice?.amount.toString() ?? ""))) ||
    photo.kind === "remove" && !!product.photo || photo.kind === "set" && photo.imageId !== product.photo?.id || photoBusy
  );
  const setDirty = useProductNavigationGuard(dirty);

  useEffect(() => {
    if (discardVersionRef.current === discardVersion) return;
    discardVersionRef.current = discardVersion;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- discard is an explicit user event from the global navigation guard.
    if (product) setValues(valuesForProduct(product));
    setPhoto({ kind: "keep" });
    setErrors({});
  }, [discardVersion, product]);

  useEffect(() => {
    let active = true;
    void products.loadProduct(productId as ProductId).then((result) => {
      if (!active) return;
      setLoadedKey(requestKey);
      if (!result.success) {
        setLoadError(result.error.code === "PRODUCT_NOT_FOUND" ? translations.t('productNotFound') : translations.t('loadProductError'));
        return;
      }
      setLoadError(null);
      setProduct(result.data);
      setValues(valuesForProduct(result.data));
      setPhoto({ kind: "keep" });
    });
    return () => { active = false; };
  }, [productId, reloadKey, requestKey]);

  if (state.status !== "ready") return null;
  if (loading) return <ThemedView style={styles.page}><ScreenState status="loading" title={t('loadingProduct')} /></ThemedView>;
  if (loadError || !product || !values) return <ThemedView style={styles.page}><SafeAreaView style={styles.safe}>
    <ScreenState status="error" title={loadError ?? t('productNotFound')} onRetry={() => { setLoadError(null); setReloadKey((value) => value + 1); }} />
  </SafeAreaView></ThemedView>;

  const setValue = (field: keyof ProductFormValues, value: string) => {
    setValues((current) => current ? { ...current, [field]: value } : current);
    setErrors((current) => ({ ...current, [field]: undefined, form: undefined }));
  };
  const save = async () => {
    const invalid = validateProductForm(values, product.variants.length === 1);
    if (Object.keys(invalid).length) { setErrors(invalid); return; }
    if (saving || photoBusy) return;
    setSaving(true);
    const original = valuesForProduct(product);
    const variant = product.variants.length === 1 ? product.variants[0] : undefined;
    const variantPatch = variant && (
      values.sku !== original.sku || values.salePrice !== original.salePrice || values.purchasePrice !== original.purchasePrice
    ) ? {
      id: variant.id,
      ...(values.sku === original.sku ? {} : { sku: values.sku.trim() || null }),
      ...(values.salePrice === original.salePrice ? {} : { salePrice: Number(values.salePrice) }),
      ...(values.purchasePrice === original.purchasePrice ? {} : { purchasePrice: values.purchasePrice.trim() ? Number(values.purchasePrice) : null }),
    } : undefined;
    const result = await products.updateProduct({
      current: product,
      ...(values.name === original.name ? {} : { name: values.name }),
      ...(values.description === original.description ? {} : { description: values.description || null }),
      photo,
      ...(variantPatch ? { variant: variantPatch } : {}),
    });
    setSaving(false);
    if (!result.success) {
      if (result.error.code === "PRODUCT_NOT_FOUND") { setProduct(null); setValues(null); setLoadError(t('productNotFound')); }
      else {
        setErrors(productErrors(result.error));
        setUncertain(["NETWORK_ERROR", "SERVER_ERROR", "SERVICE_UNAVAILABLE"].includes(result.error.code));
      }
      return;
    }
    const local = applySaved(product, values, photo);
    setProduct(local);
    setValues(valuesForProduct(local));
    setPhoto({ kind: "keep" });
    setErrors({});
    setUncertain(false);
    setDirty(false);
    Alert.alert(t('savedChanges'), t('productUpdated'));
    const refreshed = await products.loadProduct(product.id);
    if (refreshed.success) { setProduct(refreshed.data); setValues(valuesForProduct(refreshed.data)); }
  };
  const checkStatus = async () => {
    const result = await products.loadProduct(product.id);
    if (!result.success) {
      if (result.error.code === "PRODUCT_NOT_FOUND") { setProduct(null); setValues(null); setLoadError(t('productNotFound')); }
      else setErrors({ form: t('checkProductError') });
      return;
    }
    const expected = applySaved(product, values, photo);
    const saved = sameProduct(expected, result.data);
    setProduct(result.data);
    if (saved) {
      setValues(valuesForProduct(result.data));
      setPhoto({ kind: "keep" });
      setErrors({});
      setDirty(false);
      Alert.alert(t('savedChanges'), t('productChangesConfirmed'));
    } else {
      setValues(mergeDraft(product, result.data, values));
      setErrors({ form: t('changesNotVisible') });
    }
    setUncertain(false);
  };
  const printVariant = (variantId: VariantId) => {
    const quantity = makeCopyCount(Number(copies));
    if (!quantity.success || quantity.data > 99) { setErrors((current) => ({ ...current, form: t('copyCountError') })); Alert.alert(t('copyCountError')); return; }
    startAttempt(productPrintWork({ kind: "saved-product", product, variantId }, quantity.data));
    setChoosingVariant(false);
  };
  const print = () => {
    if (product.variants.length === 1) printVariant(product.variants[0].id);
    else setChoosingVariant(true);
  };

  return <ThemedView style={styles.page}><SafeAreaView style={styles.safe}>
    <View style={styles.header}>
      <View style={styles.heading}><ThemedText type="subtitle" style={styles.title}>{t('manageProduct')}</ThemedText>
        {product.variants.length > 0 ? <Pressable accessibilityRole="button" accessibilityLabel={t('printLabel')}
          accessibilityState={{ disabled: saving || photoBusy || uncertain }} disabled={saving || photoBusy || uncertain}
          onPress={print} style={({ pressed }) => [styles.printAction, { backgroundColor: pressed ? theme.accent : theme.secondary, opacity: saving || photoBusy || uncertain ? 0.5 : 1 }]}>
          <SymbolView name={{ ios: "printer", android: "print" }} size={24} tintColor={theme.secondaryForeground} />
        </Pressable> : null}
      </View>
    </View>
    {dirty ? <ThemedText themeColor="textSecondary" style={styles.printNote}>{t('printSavedDataHint')}</ThemedText> : null}
    <ProductForm
      values={values}
      setValue={setValue}
      currency={product.currency}
      current={product}
      photo={photo}
      onPhotoChange={(value) => { setPhoto(value); setErrors((current) => ({ ...current, form: undefined })); }}
      errors={errors}
      disabled={saving || uncertain}
      photoBusy={photoBusy}
      onPhotoBusy={setPhotoBusy}
      onSave={() => void save()}
      copies={copies}
      onCopiesChange={setCopies}
      onCancel={() => router.replace("/products")}
      onReviewCatalog={() => { setDirty(false); router.replace("/products"); }}
      onCheckStatus={() => void checkStatus()}
      saving={saving}
      uncertain={uncertain}
    />
    <Modal visible={choosingVariant} transparent animationType="fade" onRequestClose={() => setChoosingVariant(false)}>
      <View style={styles.scrim}><View style={[styles.picker, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="subtitle">{t('selectVariantToPrint')}</ThemedText>
        <ScrollView contentContainerStyle={styles.variantChoices}>
          {product.variants.map((variant, index) => <Button key={variant.id} variant="secondary" onPress={() => printVariant(variant.id)}>
            {Object.entries(variant.attributes).map(([key, value]) => `${key}: ${value}`).join(" · ") || t('numberedVariant', { count: index + 1 })}
          </Button>)}
        </ScrollView>
        <Button variant="ghost" onPress={() => setChoosingVariant(false)}>{t('cancel')}</Button>
      </View></View>
    </Modal>
  </SafeAreaView></ThemedView>;
}

const styles = StyleSheet.create({
  page: { flex: 1 }, safe: { flex: 1 }, header: { minHeight: 52, justifyContent: "center", paddingHorizontal: 16 },
  heading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  title: { flexShrink: 1 }, printAction: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  printNote: { paddingHorizontal: 20, paddingTop: 8 },
  scrim: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: "#0008" },
  picker: { maxHeight: "75%", borderRadius: 12, padding: 20, gap: 16 }, variantChoices: { gap: 8 },
});
