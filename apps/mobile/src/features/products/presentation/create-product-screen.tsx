import { useEffect, useRef, useState } from "react";
import { StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import * as Crypto from "expo-crypto";
import { countryCurrencies } from "@shared/country";
import { createDraft } from "@shared/product-variants";
import { SafeAreaView } from "react-native-safe-area-context";
import { ThemedView } from "@/components/themed-view";
import { products } from "@mobile/features/products/composition";
import { useAccess } from "@/features/users/presentation/access-provider";
import type { ProductId, PhotoSelection } from "../domain/product";
import { formEdges, ProductForm } from "./product-form";
import type { ProductFormField, ProductFormValues } from "./product-form";
import { baseOf, emptyProductForm, productErrors, rowErrors, uncertainCodes, validateProductForm } from "./product-form-state";
import { editorErrorsOf, errorSummary, rowErrorCount } from "./product-editor-messages";
import { editorSummary } from "./product-editor-summary";
import { noEditorErrors, useProductEditor } from "./product-editor-state";
import { isOnline } from "./is-online";
import { productPath } from "./product-routes";
import { useProductNavigationGuard } from "./use-product-navigation-guard";
import { useProductDraft } from "./draft-guard";

const emptyDraft = () => createDraft(baseOf(emptyProductForm));

export default function CreateProductScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { state } = useAccess();
  const currency = state.status === "ready" ? countryCurrencies[state.company.country] : null;
  const [values, setValues] = useState<ProductFormValues>(emptyProductForm);
  const [photo, setPhoto] = useState<PhotoSelection>({ kind: "keep" });
  const [errors, setErrors] = useState<Partial<Record<ProductFormField, string>>>({});
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const productId = useRef<ProductId | null>(null);
  const editor = useProductEditor();
  const [started, setStarted] = useState(false);
  const { discardVersion } = useProductDraft();
  const setDirty = useProductNavigationGuard(
    values.name !== emptyProductForm.name || values.description !== emptyProductForm.description || values.sku !== emptyProductForm.sku ||
    values.salePrice !== emptyProductForm.salePrice || values.purchasePrice !== emptyProductForm.purchasePrice || values.stock !== emptyProductForm.stock || photo.kind !== "keep" || photoBusy || editor.dirty,
  );
  const discardVersionRef = useRef(discardVersion);
  useEffect(() => {
    if (!currency) return;
    editor.reset(emptyDraft(), currency);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the editor session starts once, when the screen opens with its currency.
    setStarted(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currency]);
  useEffect(() => {
    if (discardVersionRef.current === discardVersion) return;
    discardVersionRef.current = discardVersion;
    setValues(emptyProductForm);
    setPhoto({ kind: "keep" });
    setErrors({});
    setConflict(false);
    productId.current = null;
    if (currency) editor.reset(emptyDraft(), currency);
  }, [discardVersion, editor, currency]);

  if (state.status !== "ready" || !currency || !started || !editor.draft) return null;
  const draft = editor.draft;
  const hasOptions = draft.options.length > 0;
  // The form opens above the tabs; going back returns to wherever it was opened from.
  const close = () => router.canGoBack() ? router.back() : router.replace("/products");
  const setValue = (field: keyof ProductFormValues, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined, form: undefined }));
  };
  const openEditor = (route: "options" | "variants") => {
    if (!hasOptions && route === "options") editor.setDraft({ ...draft, base: baseOf(values) });
    router.push(productPath(undefined, route));
  };
  const save = async () => {
    const invalid = validateProductForm(values, !hasOptions, true);
    if (Object.keys(invalid).length) { setErrors(invalid); return; }
    if (saving || photoBusy) return;
    const next = hasOptions ? draft : { ...draft, base: baseOf(values) };
    if (hasOptions) {
      const rows = rowErrors(next);
      if (Object.keys(rows).length) {
        editor.setErrors({ ...noEditorErrors, rows });
        setErrors({ form: t('reviewMarkedVariants', { count: Object.keys(rows).length }) });
        return;
      }
      if (editorSummary(next).count === 0) { setErrors({ form: t('noVariantsToSave') }); return; }
    }
    setSaving(true);
    if (!await isOnline()) {
      setSaving(false);
      setErrors({ form: t('saveProductError') });
      return;
    }
    productId.current ??= Crypto.randomUUID() as ProductId;
    const result = await products.createProduct({
      id: productId.current,
      country: state.company.country,
      name: values.name,
      ...(values.description === "" ? {} : { description: values.description }),
      photo,
      draft: next,
    });
    setSaving(false);
    if (!result.success) {
      const mapped = editorErrorsOf(result.error, next);
      editor.setErrors(mapped);
      const summary = errorSummary(mapped);
      setErrors(summary ? { form: summary } : uncertainCodes.includes(result.error.code) ? { form: t('productCreationUncertain') } : productErrors(result.error, hasOptions));
      setConflict(result.error.code === "PRODUCT_ID_CONFLICT");
      return;
    }
    setDirty(false);
    router.replace({ pathname: "/products/[productId]", params: { productId: result.data } });
  };

  return <ThemedView style={styles.page}><SafeAreaView edges={formEdges} style={styles.safe}>
    <ProductForm
      title={t('newProduct')}
      values={values}
      setValue={setValue}
      currency={currency}
      draft={draft}
      errorCount={rowErrorCount(editor.errors)}
      photo={photo}
      onPhotoChange={(value) => { setPhoto(value); setErrors((current) => ({ ...current, form: undefined })); }}
      errors={errors}
      disabled={saving || conflict}
      photoBusy={photoBusy}
      onPhotoBusy={setPhotoBusy}
      onSave={() => void save()}
      onClose={close}
      onReviewCatalog={() => { setDirty(false); router.replace("/products"); }}
      onEditOptions={() => openEditor("options")}
      onOpenVariants={() => openEditor("variants")}
      saving={saving}
      conflict={conflict}
    />
  </SafeAreaView></ThemedView>;
}

const styles = StyleSheet.create({ page: { flex: 1 }, safe: { flex: 1 } });
