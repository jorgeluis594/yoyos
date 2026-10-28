import { useEffect, useRef, type ReactNode } from "react";
import { ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import type { EditorDraft } from "@shared/product-variants";
import type { Currency } from "@shared/money";
import { Button } from "@mobile/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@mobile/components/ui/field";
import { Input } from "@mobile/components/ui/input";
import { ThemedText } from "@mobile/components/themed-text";
import { useTheme } from "@mobile/hooks/use-theme";
import { ProductPhotosStrip } from "@mobile/features/products/presentation/product-photos-strip";
import type { PhotoFieldController } from "@mobile/features/products/presentation/use-photo-field";
import { ProductTopBar } from "@mobile/features/products/presentation/product-top-bar";
import { QuantityStepper } from "@mobile/features/products/presentation/quantity-stepper";
import type { Product } from "@mobile/features/products/domain/product";
import { VariantsCard } from "./variants-card";
import { editorSummary } from "./product-editor-summary";
import tokens from "../../../../../../docs/design-tokens.json";

export type ProductFormValues = Readonly<{ name: string; description: string; sku: string; salePrice: string; purchasePrice: string; stock: string }>;
export type ProductFormField = keyof ProductFormValues | "form";

export { formEdges } from "./form-edges";

export function ProductForm({
  title, headerAction, values, setValue, currency, current, draft, errorCount, photos, errors, disabled, onSave, onClose, onReviewCatalog, onReload, onEditOptions, onOpenVariants, saving, conflict, uncertain, changed,
}: {
  title: string;
  headerAction?: ReactNode;
  values: ProductFormValues;
  setValue: (field: keyof ProductFormValues, value: string) => void;
  currency: Currency;
  current?: Product;
  draft: EditorDraft;
  /** Rows the last rejected save marked. */
  errorCount: number;
  photos: PhotoFieldController;
  errors: Partial<Record<ProductFormField, string>>;
  disabled: boolean;
  onSave: () => void;
  onClose: () => void;
  onReviewCatalog: () => void;
  /** Reloads the saved product, after the discard confirmation. */
  onReload?: () => void;
  onEditOptions: () => void;
  onOpenVariants: () => void;
  saving: boolean;
  conflict?: boolean;
  uncertain?: boolean;
  /** The save was rejected because the product changed since it was opened. */
  changed?: boolean;
}) {
  const page = useRef<ScrollView>(null);
  const revealNonce = photos.focus?.reveal ? photos.focus.nonce : null;
  // A save that the photos block shows its message above the strip, so the form returns to its top.
  useEffect(() => { if (revealNonce !== null) page.current?.scrollTo({ y: 0, animated: true }); }, [revealNonce]);
  const hasOptions = draft.options.length > 0;
  const summary = editorSummary(draft);
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  // Paired fields wrap their labels under enlarged text, so they stack to keep each input aligned with its label.
  const { fontScale } = useWindowDimensions();
  const fieldColumn = [styles.column, fontScale > 1.15 && styles.stacked];
  const locale = i18n.language === 'pt-BR' ? 'pt-BR' : 'es-PE';
  const price = new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const card = [styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }];
  return <View style={styles.layout}>
    <ProductTopBar title={title} onClose={onClose} closeDisabled={saving}>
      {headerAction}
      <Button onPress={onSave} loading={saving} disabled={disabled}>{t('save')}</Button>
    </ProductTopBar>
    <ScrollView ref={page} style={styles.scroll} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      {errors.form ? <ThemedText accessibilityRole="alert" style={{ color: theme.error }}>{errors.form}</ThemedText> : null}
      <ProductPhotosStrip photos={photos} disabled={disabled} />
      <FieldGroup style={card}>
        <Field required invalid={!!errors.name} disabled={disabled}>
          <FieldLabel>{t('name')}</FieldLabel><Input value={values.name} onChangeText={(value) => setValue("name", value)} maxLength={200} placeholder={t('productNamePlaceholder')} accessibilityLabel={t('name')} />
          {errors.name ? <FieldError>{errors.name}</FieldError> : null}
        </Field>
        <Field invalid={!!errors.description} disabled={disabled}>
          <FieldLabel>{t('descriptionLabel')}</FieldLabel><Input multiline style={styles.descriptionInput} value={values.description} onChangeText={(value) => setValue("description", value)} maxLength={5000} placeholder={t('optionalDescription')} accessibilityLabel={t('descriptionLabel')} />
          {errors.description ? <FieldError>{errors.description}</FieldError> : null}
        </Field>
      </FieldGroup>
      {!hasOptions ? <View style={card}>
        <View style={styles.cardTitle}>
          <ThemedText type="small" accessibilityRole="header" style={styles.cardHeading}>{t('price')}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{currency}</ThemedText>
        </View>
        <FieldGroup style={styles.columns}>
          <Field style={fieldColumn} required invalid={!!errors.salePrice} disabled={disabled}>
            <FieldLabel>{t('salePrice')}</FieldLabel><Input value={values.salePrice} onChangeText={(value) => setValue("salePrice", value)} keyboardType="decimal-pad" placeholder="0.00" accessibilityLabel={t('salePriceLabel', { currency })} style={styles.amount} />
            {errors.salePrice ? <FieldError>{errors.salePrice}</FieldError> : null}
          </Field>
          <Field style={fieldColumn} invalid={!!errors.purchasePrice} disabled={disabled}>
            <FieldLabel>{t('costShort')}</FieldLabel><Input value={values.purchasePrice} onChangeText={(value) => setValue("purchasePrice", value)} keyboardType="decimal-pad" placeholder="0.00" accessibilityLabel={t('purchasePriceLabel', { currency })} style={styles.amount} />
            {errors.purchasePrice ? <FieldError>{errors.purchasePrice}</FieldError> : null}
          </Field>
        </FieldGroup>
      </View> : null}
      {draft.saved && hasOptions && summary.active === 0 ? <View style={[styles.notice, { backgroundColor: theme.warningSurface }]}>
        <ThemedText type="small" style={{ color: theme.warning }}>{t('noVariantOnSale')}</ThemedText>
      </View> : null}
      <VariantsCard draft={draft} disabled={disabled} errorCount={errorCount} formatPrice={(amount) => price.format(amount)} onEditOptions={onEditOptions} onOpenVariants={onOpenVariants} />
      <View style={card}>
        <ThemedText type="small" accessibilityRole="header" style={styles.cardHeading}>{t('inventory')}</ThemedText>
        {hasOptions ? <Field disabled>
          <FieldLabel>{t('stock')}</FieldLabel>
          <QuantityStepper value={String(summary.stock)} onChange={() => {}} disabled
            accessibilityLabel={t('readonlyStock', { count: summary.stock })} decreaseLabel={t('decreaseStock')} increaseLabel={t('increaseStock')} />
          <ThemedText type="small" themeColor="textSecondary">{draft.saved ? t('stockSumActive') : t('stockSum')}</ThemedText>
        </Field> : <FieldGroup style={styles.columns}>
          <Field style={fieldColumn} invalid={!!errors.sku} disabled={disabled}>
            <FieldLabel>SKU</FieldLabel><Input value={values.sku} onChangeText={(value) => setValue("sku", value)} maxLength={100} placeholder={t('optional')} accessibilityLabel={t('optionalSku')} autoCapitalize="characters" />
            {errors.sku ? <FieldError>{errors.sku}</FieldError> : null}
          </Field>
          {current ? <Field style={fieldColumn} disabled>
            <FieldLabel>{t('stock')}</FieldLabel>
            <QuantityStepper value={String(current.variants[0]?.stock ?? 0)} onChange={() => {}} disabled
              accessibilityLabel={t('readonlyStock', { count: current.variants[0]?.stock ?? 0 })} decreaseLabel={t('decreaseStock')} increaseLabel={t('increaseStock')} />
          </Field> : <Field style={fieldColumn} invalid={!!errors.stock} disabled={disabled}>
            <FieldLabel>{t('initialStock')}</FieldLabel>
            <QuantityStepper value={values.stock} onChange={(value) => setValue("stock", value)} disabled={disabled}
              accessibilityLabel={t('optionalInitialStock')} decreaseLabel={t('decreaseStock')} increaseLabel={t('increaseStock')} />
            {errors.stock ? <FieldError>{errors.stock}</FieldError> : null}
          </Field>}
        </FieldGroup>}
      </View>
      {conflict ? <Button variant="secondary" onPress={onReviewCatalog}>{t('backToCatalog')}</Button> : null}
      {(uncertain || changed) && onReload ? <Button variant="secondary" onPress={onReload}>{t('reloadProduct')}</Button> : null}
      <SafeAreaView edges={["bottom"]} />
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  layout: { flex: 1 }, scroll: { flex: 1 },
  page: { gap: tokens.spacing["3"], padding: tokens.spacing["4"], paddingBottom: tokens.spacing["8"] },
  card: { borderWidth: tokens.sizing.borderWidth, borderRadius: tokens.radius.card, padding: tokens.spacing["4"], gap: tokens.spacing["4"] },
  cardTitle: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: tokens.spacing["2"] },
  cardHeading: { fontWeight: 600 },
  descriptionInput: { minHeight: 88, textAlignVertical: "top" },
  columns: { flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing["3"] },
  column: { flexGrow: 1, flexBasis: 136, minWidth: 0 },
  stacked: { flexBasis: "100%" },
  amount: { fontVariant: ["tabular-nums"] },
  notice: { borderRadius: tokens.radius.control, padding: tokens.spacing["3"] },
});
