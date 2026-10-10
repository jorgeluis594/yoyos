import type { ReactNode } from "react";
import { ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import type { Currency } from "@shared/money";
import { Button } from "@mobile/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@mobile/components/ui/field";
import { Input } from "@mobile/components/ui/input";
import { ThemedText } from "@mobile/components/themed-text";
import { useTheme } from "@mobile/hooks/use-theme";
import { products } from "@mobile/features/products/composition";
import { ProductPhoto } from "@mobile/features/products/presentation/product-photo";
import { ProductTopBar } from "@mobile/features/products/presentation/product-top-bar";
import { QuantityStepper } from "@mobile/features/products/presentation/quantity-stepper";
import type { Product, PhotoSelection } from "@mobile/features/products/domain/product";
import tokens from "../../../../../../docs/design-tokens.json";

export type ProductFormValues = Readonly<{ name: string; description: string; sku: string; salePrice: string; purchasePrice: string; stock: string }>;
export type ProductFormField = keyof ProductFormValues | "form";

// The bottom inset is scrolled content, so the form uses the full height when the tab bar is hidden.
export const formEdges: readonly Edge[] = ["top", "left", "right"];

export function ProductForm({
  title, headerAction, values, setValue, currency, current, photo, onPhotoChange, errors, disabled, photoBusy, onPhotoBusy, onSave, onClose, onReviewCatalog, onCheckStatus, saving, conflict, uncertain,
}: {
  title: string;
  headerAction?: ReactNode;
  values: ProductFormValues;
  setValue: (field: keyof ProductFormValues, value: string) => void;
  currency: Currency;
  current?: Product;
  photo: PhotoSelection;
  onPhotoChange: (value: PhotoSelection) => void;
  errors: Partial<Record<ProductFormField, string>>;
  disabled: boolean;
  photoBusy: boolean;
  onPhotoBusy: (busy: boolean) => void;
  onSave: () => void;
  onClose: () => void;
  onReviewCatalog: () => void;
  onCheckStatus?: () => void;
  saving: boolean;
  conflict?: boolean;
  uncertain?: boolean;
}) {
  const multiVariant = (current?.variants.length ?? 1) > 1;
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  // Paired fields wrap their labels under enlarged text, so they stack to keep each input aligned with its label.
  const { fontScale } = useWindowDimensions();
  const fieldColumn = [styles.column, fontScale > 1.15 && styles.stacked];
  const locale = i18n.language === 'pt-BR' ? 'pt-BR' : 'es-PE';
  const price = new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const card = [styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }];
  return <View style={styles.layout}>
    <ProductTopBar title={title} onClose={onClose} closeDisabled={saving || photoBusy}>
      {headerAction}
      <Button onPress={onSave} loading={saving} disabled={disabled || photoBusy}>{t('save')}</Button>
    </ProductTopBar>
    <ScrollView style={styles.scroll} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      {errors.form ? <ThemedText accessibilityRole="alert" style={{ color: theme.error }}>{errors.form}</ThemedText> : null}
      <ProductPhoto
        value={photo}
        original={current?.photo}
        upload={products.uploadImage}
        disabled={disabled}
        onChange={onPhotoChange}
        onBusy={onPhotoBusy}
      />
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
      {!multiVariant ? <View style={card}>
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
      <View style={card}>
        <ThemedText type="small" accessibilityRole="header" style={styles.cardHeading}>{multiVariant ? t('variants') : t('inventory')}</ThemedText>
        {multiVariant ? <View style={styles.variants}>
          {current?.variants.map((variant, index) => <View key={variant.id} style={[styles.variant, { borderColor: theme.border }]}>
            <ThemedText type="smallBold">{Object.entries(variant.attributes).map(([key, value]) => `${key}: ${value}`).join(" · ") || t('numberedVariant', { count: index + 1 })}</ThemedText>
            <ThemedText themeColor="textSecondary">{variant.sku ?? t('noSku')} · {t('saleAmount', { amount: price.format(variant.salePrice.amount) })}{variant.purchasePrice ? ` · ${t('purchaseAmount', { amount: price.format(variant.purchasePrice.amount) })}` : ""}</ThemedText>
            <ThemedText themeColor="textSecondary">{t('stockCount', { count: variant.stock })}</ThemedText>
          </View>)}
        </View> : <FieldGroup style={styles.columns}>
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
      {uncertain && onCheckStatus ? <Button variant="secondary" onPress={onCheckStatus}>{t('checkProductStatus')}</Button> : null}
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
  variants: { gap: 10 }, variant: { borderWidth: 1, borderRadius: 12, padding: 14, gap: 4 },
});
