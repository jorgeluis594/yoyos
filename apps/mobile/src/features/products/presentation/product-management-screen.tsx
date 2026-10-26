/** @jsxImportSource react */
// Preserve native Pressable style callbacks outside NativeWind interop.
import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet } from "react-native";
import { SymbolView } from "expo-symbols";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { SafeAreaView } from "react-native-safe-area-context";
import { removalOf, orderedRows, setRow } from "@shared/product-variants";
import { ScreenState } from "@/components/ui/screen-state";
import { ThemedView } from "@/components/themed-view";
import { showConfirmation } from "@mobile/components/ui/show-confirmation";
import { useTheme } from "@mobile/hooks/use-theme";
import { products } from "@mobile/features/products/composition";
import { useAccess } from "@/features/users/presentation/access-provider";
import type { PhotoSelection, Product, ProductId, VariantId } from "../domain/product";
import { editorDraftOf } from "../domain/product-editor";
import { formEdges, ProductForm } from "./product-form";
import { ProductTopBar } from "@mobile/features/products/presentation/product-top-bar";
import { ProductPrintSheet } from "@mobile/features/products/presentation/product-print-sheet";
import type { CopyCount } from "@mobile/features/printing/composition";
import type { ProductFormField, ProductFormValues } from "./product-form";
import { baseOf, productErrors, rowErrors, validateProductForm, valuesForProduct } from "./product-form-state";
import { editorErrorsOf, rowErrorCount } from "./product-editor-messages";
import { noEditorErrors, useProductEditor } from "./product-editor-state";
import { productPath } from "./product-routes";
import { useProductNavigationGuard } from "./use-product-navigation-guard";
import { useProductDraft } from "./draft-guard";
import { usePrint } from "@mobile/features/printing/presentation/print-provider";
import { productPrintWork } from "./product-print-work";
import translations from '@mobile/i18n';
import tokens from "../../../../../../docs/design-tokens.json";

const uncertainCodes = ["NETWORK_ERROR", "SERVER_ERROR", "SERVICE_UNAVAILABLE"];

export default function ProductManagementScreen() {
  const { productId } = useLocalSearchParams<{ productId: string }>();
  const router = useRouter();
  const { t } = useTranslation();
  const theme = useTheme();
  const { state } = useAccess();
  const { startAttempt } = usePrint();
  const editor = useProductEditor();
  const [product, setProduct] = useState<Product | null>(null);
  const [values, setValues] = useState<ProductFormValues | null>(null);
  const [photo, setPhoto] = useState<PhotoSelection>({ kind: "keep" });
  const [errors, setErrors] = useState<Partial<Record<ProductFormField, string>>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [changed, setChanged] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [printing, setPrinting] = useState(false);
  const { discardVersion } = useProductDraft();
  const discardVersionRef = useRef(discardVersion);
  const requestKey = `${productId}:${reloadKey}`;
  const loading = loadedKey !== requestKey;
  const original = product ? valuesForProduct(product) : null;
  const draft = editor.draft;
  const simple = !!product && product.options.length === 0;
  const dirty = !!product && !!values && !!original && (
    values.name !== original.name || values.description !== original.description ||
    (simple && (values.sku !== original.sku || values.salePrice !== original.salePrice || values.purchasePrice !== original.purchasePrice)) ||
    photo.kind === "remove" && !!product.photo || photo.kind === "set" && photo.imageId !== product.photo?.id || photoBusy || editor.dirty
  );
  const setDirty = useProductNavigationGuard(dirty);

  useEffect(() => {
    if (discardVersionRef.current === discardVersion) return;
    discardVersionRef.current = discardVersion;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- discard is an explicit user event from the global navigation guard.
    if (product) { setValues(valuesForProduct(product)); editor.reset(editorDraftOf(product), product.currency); }
    setPhoto({ kind: "keep" });
    setErrors({});
    setChanged(false);
  }, [discardVersion, product, editor]);

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
      editor.reset(editorDraftOf(result.data), result.data.currency);
      setPhoto({ kind: "keep" });
    });
    return () => { active = false; };
  // The editor session restarts with each load; its identity changes with its own state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, reloadKey, requestKey]);

  if (state.status !== "ready") return null;
  // The form opens above the tabs; going back returns to wherever it was opened from.
  const close = () => router.canGoBack() ? router.back() : router.replace("/products");
  if (loading) return <ThemedView style={styles.page}><SafeAreaView style={styles.safe}>
    <ProductTopBar title={t('editProduct')} onClose={close} />
    <ScreenState status="loading" title={t('loadingProduct')} />
  </SafeAreaView></ThemedView>;
  if (loadError || !product || !values || !draft) return <ThemedView style={styles.page}><SafeAreaView style={styles.safe}>
    <ProductTopBar title={t('editProduct')} onClose={close} />
    <ScreenState status="error" title={loadError ?? t('productNotFound')} onRetry={() => { setLoadError(null); setReloadKey((value) => value + 1); }} />
  </SafeAreaView></ThemedView>;

  const setValue = (field: keyof ProductFormValues, value: string) => {
    setValues((current) => current ? { ...current, [field]: value } : current);
    setErrors((current) => ({ ...current, [field]: undefined, form: undefined }));
  };
  const lone = () => orderedRows(draft).find((row) => removalOf(draft, row) === null);
  /** A product without options edits its one variant in the form: the draft takes those values before options or a save use it. */
  const withFormVariant = () => {
    const row = simple ? draft.rows[0] : undefined;
    if (!row) return draft;
    return setRow(draft, row.ref, {
      sku: values.sku.trim() || null, salePrice: baseOf(values).salePrice, purchasePrice: baseOf(values).purchasePrice,
    });
  };
  const openEditor = (route: "options" | "variants") => {
    if (simple && route === "options") editor.setDraft(withFormVariant());
    router.push({ pathname: productPath(product.id, route), params: { productId: product.id } });
  };
  const save = async () => {
    const invalid = validateProductForm(values, simple);
    if (Object.keys(invalid).length) { setErrors(invalid); return; }
    if (saving || photoBusy) return;
    const next = withFormVariant();
    const rows = draft.options.length > 0 ? rowErrors(next) : {};
    if (draft.options.length > 0 && !lone()) { setErrors({ form: t('noVariantsToSave') }); return; }
    if (Object.keys(rows).length) {
      editor.setErrors({ ...noEditorErrors, rows });
      setErrors({ form: t('reviewMarkedVariants', { count: Object.keys(rows).length }) });
      return;
    }
    setSaving(true);
    const result = await products.saveProduct({ current: product, name: values.name, description: values.description || null, photo, draft: next });
    setSaving(false);
    if (!result.success) {
      if (result.error.code === "PRODUCT_NOT_FOUND") { setProduct(null); setValues(null); setLoadError(t('productNotFound')); return; }
      const mapped = editorErrorsOf(result.error, next);
      editor.setErrors(mapped);
      const marked = rowErrorCount(mapped);
      const isUncertain = uncertainCodes.includes(result.error.code);
      setErrors(marked > 0 ? { form: t('reviewMarkedVariants', { count: marked }) } : isUncertain ? { form: t('saveUncertain') } : productErrors(result.error));
      setUncertain(isUncertain);
      setChanged(result.error.code === "PRODUCT_CHANGED");
      return;
    }
    // The response is the saved detail: the screen takes it as is, with no follow-up read.
    setProduct(result.data);
    setValues(valuesForProduct(result.data));
    editor.reset(editorDraftOf(result.data), result.data.currency);
    setPhoto({ kind: "keep" });
    setErrors({});
    setUncertain(false);
    setChanged(false);
    setDirty(false);
    Alert.alert(t('savedChanges'), t('productUpdated'));
  };
  const reload = () => {
    const run = async () => {
      const result = await products.loadProduct(product.id);
      if (!result.success) {
        if (result.error.code === "PRODUCT_NOT_FOUND") { setProduct(null); setValues(null); setLoadError(t('productNotFound')); }
        else setErrors({ form: t('checkProductError') });
        return;
      }
      setProduct(result.data);
      setValues(valuesForProduct(result.data));
      editor.reset(editorDraftOf(result.data), result.data.currency);
      setPhoto({ kind: "keep" });
      setErrors({});
      setUncertain(false);
      setChanged(false);
      setDirty(false);
    };
    if (!dirty) { void run(); return; }
    showConfirmation({ title: t('discardChanges'), description: t('discardDescription'), confirmLabel: t('discard'), cancelLabel: t('keepEditing'), destructive: true, onConfirm: () => void run() });
  };
  const printVariant = (variantId: VariantId, copies: CopyCount) => {
    startAttempt(productPrintWork({ kind: "saved-product", product, variantId }, copies));
    setPrinting(false);
  };

  return <ThemedView style={styles.page}><SafeAreaView edges={formEdges} style={styles.safe}>
    <ProductForm
      title={t('editProduct')}
      headerAction={product.variants.length > 0 ? <Pressable accessibilityRole="button" accessibilityLabel={t('printLabel')}
        accessibilityState={{ disabled: saving || photoBusy || uncertain }} disabled={saving || photoBusy || uncertain}
        onPress={() => setPrinting(true)} style={({ pressed }) => [styles.printAction, { backgroundColor: pressed ? theme.accent : "transparent", opacity: saving || photoBusy || uncertain ? 0.5 : 1 }]}>
        <SymbolView name={{ ios: "printer", android: "print" }} size={24} tintColor={theme.text} />
      </Pressable> : undefined}
      values={values}
      setValue={setValue}
      currency={product.currency}
      current={product}
      draft={draft}
      errorCount={rowErrorCount(editor.errors)}
      photo={photo}
      onPhotoChange={(value) => { setPhoto(value); setErrors((current) => ({ ...current, form: undefined })); }}
      errors={errors}
      disabled={saving || uncertain}
      photoBusy={photoBusy}
      onPhotoBusy={setPhotoBusy}
      onSave={() => void save()}
      onClose={close}
      onReviewCatalog={() => { setDirty(false); router.replace("/products"); }}
      onReload={reload}
      onEditOptions={() => openEditor("options")}
      onOpenVariants={() => openEditor("variants")}
      saving={saving}
      uncertain={uncertain}
      changed={changed}
    />
    {printing ? <ProductPrintSheet visible product={product} unsavedChanges={dirty} onClose={() => setPrinting(false)} onPrint={printVariant} /> : null}
  </SafeAreaView></ThemedView>;
}

const styles = StyleSheet.create({
  page: { flex: 1 }, safe: { flex: 1 },
  printAction: { width: tokens.sizing.touchTargetMinSize, height: tokens.sizing.touchTargetMinSize, borderRadius: tokens.sizing.touchTargetMinSize / 2, alignItems: "center", justifyContent: "center" },
});
