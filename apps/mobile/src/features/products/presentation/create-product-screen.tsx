import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import * as Crypto from "expo-crypto";
import { countryCurrencies } from "@shared/country";
import { SafeAreaView } from "react-native-safe-area-context";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { products } from "@mobile/features/products/composition";
import { useAccess } from "@/features/users/presentation/access-provider";
import type { ProductId, PhotoSelection } from "../domain/product";
import { ProductForm } from "./product-form";
import type { ProductFormField, ProductFormValues } from "./product-form";
import { emptyProductForm, productErrors, validateProductForm } from "./product-form-state";
import { useProductNavigationGuard } from "./use-product-navigation-guard";
import { useProductDraft } from "./draft-guard";
import { usePrint } from "@mobile/features/printing/presentation/print-provider";
import { makeCopyCount } from "@mobile/features/printing/composition";
import { productPrintWork } from "./product-print-work";

export default function CreateProductScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { state } = useAccess();
  const { startAttempt } = usePrint();
  const [values, setValues] = useState<ProductFormValues>(emptyProductForm);
  const [photo, setPhoto] = useState<PhotoSelection>({ kind: "keep" });
  const [errors, setErrors] = useState<Partial<Record<ProductFormField, string>>>({});
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [copies, setCopies] = useState("1");
  const productId = useRef<ProductId | null>(null);
  const { discardVersion } = useProductDraft();
  const setDirty = useProductNavigationGuard(
    values.name !== emptyProductForm.name || values.description !== emptyProductForm.description || values.sku !== emptyProductForm.sku ||
    values.salePrice !== emptyProductForm.salePrice || values.purchasePrice !== emptyProductForm.purchasePrice || values.stock !== emptyProductForm.stock || photo.kind !== "keep" || photoBusy,
  );
  const discardVersionRef = useRef(discardVersion);
  useEffect(() => {
    if (discardVersionRef.current === discardVersion) return;
    discardVersionRef.current = discardVersion;
    setValues(emptyProductForm);
    setPhoto({ kind: "keep" });
    setErrors({});
    setConflict(false);
    productId.current = null;
  }, [discardVersion]);

  if (state.status !== "ready") return null;
  const setValue = (field: keyof ProductFormValues, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined, form: undefined }));
  };
  const save = async (printAfter = false) => {
    const quantity = makeCopyCount(Number(copies));
    if (printAfter && (!quantity.success || quantity.data > 99)) { setErrors((current) => ({ ...current, form: t('copyCountError') })); return; }
    const invalid = validateProductForm(values, true, true);
    if (Object.keys(invalid).length) { setErrors(invalid); return; }
    if (saving || photoBusy) return;
    setSaving(true);
    productId.current ??= Crypto.randomUUID() as ProductId;
    const result = await products.createProduct({
      id: productId.current,
      country: state.company.country,
      name: values.name,
      ...(values.description === "" ? {} : { description: values.description }),
      photo,
      ...(values.sku.trim() ? { sku: values.sku } : {}),
      salePrice: Number(values.salePrice),
      ...(values.purchasePrice.trim() ? { purchasePrice: Number(values.purchasePrice) } : {}),
      ...(values.stock.trim() ? { initialStock: Number(values.stock) } : {}),
    });
    setSaving(false);
    if (!result.success) {
      setErrors(productErrors(result.error));
      setConflict(result.error.code === "PRODUCT_ID_CONFLICT");
      return;
    }
    setDirty(false);
    if (printAfter && quantity.success) startAttempt(productPrintWork({ kind: "created-product", productId: result.data }, quantity.data));
    router.replace({ pathname: "/products/[productId]", params: { productId: result.data } });
  };

  return <ThemedView style={styles.page}><SafeAreaView style={styles.safe}>
    <View style={styles.header}><ThemedText type="subtitle">{t('newProduct')}</ThemedText><ThemedText themeColor="textSecondary">{t('currencyLabel', { currency: countryCurrencies[state.company.country] })}</ThemedText></View>
    <ProductForm
      values={values}
      setValue={setValue}
      currency={countryCurrencies[state.company.country]}
      photo={photo}
      onPhotoChange={(value) => { setPhoto(value); setErrors((current) => ({ ...current, form: undefined })); }}
      errors={errors}
      disabled={saving || conflict}
      photoBusy={photoBusy}
      onPhotoBusy={setPhotoBusy}
      onSave={() => void save()}
      onPrint={() => void save(true)}
      copies={copies}
      onCopiesChange={setCopies}
      onCancel={() => router.replace("/products")}
      onReviewCatalog={() => { setDirty(false); router.replace("/products"); }}
      saving={saving}
      conflict={conflict}
    />
  </SafeAreaView></ThemedView>;
}

const styles = StyleSheet.create({ page: { flex: 1 }, safe: { flex: 1 }, header: { paddingHorizontal: 20, paddingTop: 8, gap: 4 } });
