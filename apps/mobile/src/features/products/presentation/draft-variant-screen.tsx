import { useState } from "react";
import { ScrollView, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { SafeAreaView } from "react-native-safe-area-context";
import { removeRow, rowLabel, setRow, type EditorDraft, type EditorRow } from "@shared/product-variants";
import { Button } from "@mobile/components/ui/button";
import { Field, FieldError, FieldLabel } from "@mobile/components/ui/field";
import { Input } from "@mobile/components/ui/input";
import { ThemedText } from "@mobile/components/themed-text";
import { ThemedView } from "@mobile/components/themed-view";
import { useTheme } from "@mobile/hooks/use-theme";
import { formEdges } from "./form-edges";
import { ProductTopBar } from "./product-top-bar";
import { useProductEditor } from "./product-editor-state";
import { QuantityStepper } from "@mobile/components/ui/quantity-stepper";
import tokens from "../../../../../../docs/design-tokens.json";

const amountText = (value: number | null) => value === null || value === 0 ? "" : String(value);
const money = (text: string) => /^\d+(?:\.\d{1,2})?$/.test(text.trim()) ? Number(text) : null;

export default function DraftVariantScreen() {
  const { draft } = useProductEditor();
  const { ref } = useLocalSearchParams<{ ref?: string }>();
  const row = draft?.rows.find((candidate) => candidate.ref === ref && candidate.id === null);
  return draft && row ? <DraftVariant draft={draft} row={row} /> : null;
}

/** A variant that is not saved yet: its fields apply to the row with Listo and are dropped with Cancelar. */
function DraftVariant({ draft, row }: { draft: EditorDraft; row: EditorRow }) {
  const router = useRouter();
  const { t } = useTranslation();
  const theme = useTheme();
  const editor = useProductEditor();
  const [salePrice, setSalePrice] = useState(amountText(row.salePrice));
  const [purchasePrice, setPurchasePrice] = useState(amountText(row.purchasePrice));
  const [stock, setStock] = useState(String(row.stock));
  const [sku, setSku] = useState(row.sku ?? "");
  const [errors, setErrors] = useState<Readonly<{ salePrice?: string; purchasePrice?: string; stock?: string; sku?: string }>>({});
  const title = rowLabel(draft, row);
  const rejected = editor.errors.rows[row.ref];

  const done = () => {
    const invalid = {
      ...(money(salePrice) === null || Number(salePrice) <= 0 ? { salePrice: t("salePriceInvalid") } : {}),
      ...(purchasePrice.trim() && money(purchasePrice) === null ? { purchasePrice: t("purchasePriceInvalid") } : {}),
      ...(!/^\d+$/.test(stock.trim() || "0") ? { stock: t("initialStockInvalid") } : {}),
      ...(sku.trim().length > 100 ? { sku: t("maxCharacters", { count: 100 }) } : {}),
    };
    if (Object.keys(invalid).length) { setErrors(invalid); return; }
    editor.setDraft(setRow(draft, row.ref, {
      salePrice: Number(salePrice), purchasePrice: purchasePrice.trim() ? Number(purchasePrice) : null, stock: Number(stock.trim() || "0"), sku: sku.trim() || null,
    }));
    router.back();
  };
  const remove = () => {
    const result = removeRow(draft, row.ref);
    if (result.success) { editor.setDraft(result.data); editor.setSelection(editor.selection.filter((ref) => ref !== row.ref)); }
    router.back();
  };

  return <ThemedView style={styles.page}><SafeAreaView edges={formEdges} style={styles.safe}>
    <ProductTopBar title={title} onClose={() => router.back()} back />
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {rejected ? <ThemedText type="small" accessibilityRole="alert" style={{ color: theme.error }}>{rejected}</ThemedText> : null}
      <Field required invalid={!!errors.salePrice}>
        <FieldLabel>{t("salePrice")}</FieldLabel>
        <Input value={salePrice} onChangeText={(value) => { setSalePrice(value); setErrors({ ...errors, salePrice: undefined }); }} keyboardType="decimal-pad" placeholder="0.00" accessibilityLabel={t("salePrice")} />
        {errors.salePrice ? <FieldError>{errors.salePrice}</FieldError> : null}
      </Field>
      <Field invalid={!!errors.purchasePrice}>
        <FieldLabel>{t("purchasePrice")}</FieldLabel>
        <Input value={purchasePrice} onChangeText={(value) => { setPurchasePrice(value); setErrors({ ...errors, purchasePrice: undefined }); }} keyboardType="decimal-pad" placeholder="0.00" accessibilityLabel={t("purchasePrice")} />
        {errors.purchasePrice ? <FieldError>{errors.purchasePrice}</FieldError> : null}
      </Field>
      <Field invalid={!!errors.stock}>
        <FieldLabel>{t("stock")}</FieldLabel>
        <QuantityStepper value={stock} onChange={(value) => { setStock(value); setErrors({ ...errors, stock: undefined }); }} disabled={false}
          accessibilityLabel={t("stock")} decreaseLabel={t("decreaseStock")} increaseLabel={t("increaseStock")} />
        {errors.stock ? <FieldError>{errors.stock}</FieldError> : null}
      </Field>
      <Field invalid={!!errors.sku}>
        <FieldLabel>SKU</FieldLabel>
        <Input value={sku} onChangeText={(value) => { setSku(value); setErrors({ ...errors, sku: undefined }); }} maxLength={100} placeholder={t("optional")} accessibilityLabel={t("optionalSku")} autoCapitalize="characters" />
        {errors.sku ? <FieldError>{errors.sku}</FieldError> : null}
      </Field>
      <ThemedText type="small" themeColor="textSecondary">{t("qrCreatedOnSave")}</ThemedText>
      <Button onPress={done}>{t("done")}</Button>
      <Button variant="secondary" onPress={() => router.back()}>{t("cancel")}</Button>
      <Button variant="destructive" onPress={remove}>{t("removeVariant")}</Button>
    </ScrollView>
  </SafeAreaView></ThemedView>;
}

const styles = StyleSheet.create({
  page: { flex: 1 }, safe: { flex: 1 }, scroll: { flex: 1 },
  content: { gap: tokens.spacing["4"], padding: tokens.spacing["4"], paddingBottom: tokens.spacing["8"] },
});
