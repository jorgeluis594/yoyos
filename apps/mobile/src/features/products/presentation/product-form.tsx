import { ScrollView, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@mobile/hooks/use-theme";
import { products } from "@mobile/features/products/composition";
import { ProductPhoto } from "./product-photo";
import type { Product, PhotoSelection } from "../domain/product";

export type ProductFormValues = Readonly<{ name: string; description: string; sku: string; salePrice: string; purchasePrice: string; stock: string }>;
export type ProductFormField = keyof ProductFormValues | "form";

export function ProductForm({
  values, setValue, currency, current, photo, onPhotoChange, errors, disabled, photoBusy, onPhotoBusy, onSave, onCancel, onReviewCatalog, onCheckStatus, saving, conflict, uncertain, copies, onCopiesChange,
}: {
  values: ProductFormValues;
  setValue: (field: keyof ProductFormValues, value: string) => void;
  currency: string;
  current?: Product;
  photo: PhotoSelection;
  onPhotoChange: (value: PhotoSelection) => void;
  errors: Partial<Record<ProductFormField, string>>;
  disabled: boolean;
  photoBusy: boolean;
  onPhotoBusy: (busy: boolean) => void;
  onSave: () => void;
  onCancel: () => void;
  onReviewCatalog: () => void;
  onCheckStatus?: () => void;
  saving: boolean;
  conflict?: boolean;
  uncertain?: boolean;
  copies?: string;
  onCopiesChange?: (value: string) => void;
}) {
  const multiVariant = (current?.variants.length ?? 1) > 1;
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const price = new Intl.NumberFormat(i18n.language === 'pt-BR' ? 'pt-BR' : 'es-PE', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return <View style={styles.layout}><ScrollView style={styles.scroll} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
    {errors.form ? <ThemedText accessibilityRole="alert" style={{ color: theme.error }}>{errors.form}</ThemedText> : null}
    <ProductPhoto
      value={photo}
      original={current?.photo}
      upload={products.uploadImage}
      disabled={disabled}
      onChange={onPhotoChange}
      onBusy={onPhotoBusy}
    />
    <FieldGroup style={styles.details}>
      <Field required invalid={!!errors.name} disabled={disabled}>
        <FieldLabel>{t('name')}</FieldLabel><Input value={values.name} onChangeText={(value) => setValue("name", value)} maxLength={200} placeholder={t('productNamePlaceholder')} accessibilityLabel={t('name')} />
        {errors.name ? <FieldError>{errors.name}</FieldError> : null}
      </Field>
      <Field invalid={!!errors.description} disabled={disabled}>
        <FieldLabel>{t('descriptionLabel')}</FieldLabel><Input multiline style={styles.descriptionInput} value={values.description} onChangeText={(value) => setValue("description", value)} maxLength={5000} placeholder={t('optionalDescription')} accessibilityLabel={t('descriptionLabel')} />
        {errors.description ? <FieldError>{errors.description}</FieldError> : null}
      </Field>
    </FieldGroup>
    {!multiVariant ? <View style={[styles.section, { backgroundColor: theme.backgroundElement }]}>
      <View style={[styles.sectionHeader, { backgroundColor: theme.secondary }]}><ThemedText type="smallBold">{t('prices')} · {currency}</ThemedText></View>
      <View style={styles.sectionBody}><FieldGroup style={styles.columns}>
        <Field style={styles.column} required invalid={!!errors.salePrice} disabled={disabled}>
          <FieldLabel>{t('salePrice')}</FieldLabel><Input value={values.salePrice} onChangeText={(value) => setValue("salePrice", value)} keyboardType="decimal-pad" placeholder="0.00" accessibilityLabel={t('salePriceLabel', { currency })} />
          {errors.salePrice ? <FieldError>{errors.salePrice}</FieldError> : null}
        </Field>
        <Field style={styles.column} invalid={!!errors.purchasePrice} disabled={disabled}>
          <FieldLabel>{t('purchasePriceShort')}</FieldLabel><Input value={values.purchasePrice} onChangeText={(value) => setValue("purchasePrice", value)} keyboardType="decimal-pad" placeholder="0.00" accessibilityLabel={t('purchasePriceLabel', { currency })} />
          {errors.purchasePrice ? <FieldError>{errors.purchasePrice}</FieldError> : null}
        </Field>
      </FieldGroup></View>
    </View> : null}
    <View style={[styles.section, { backgroundColor: theme.backgroundElement }]}>
      <View style={[styles.sectionHeader, { backgroundColor: theme.secondary }]}><ThemedText type="smallBold">{multiVariant ? t('variants') : t('inventory')}</ThemedText></View>
      <View style={styles.sectionBody}>
      {multiVariant ? <View style={styles.variants}>
      {current?.variants.map((variant, index) => <View key={variant.id} style={[styles.variant, { borderColor: theme.border }]}>
        <ThemedText type="smallBold">{Object.entries(variant.attributes).map(([key, value]) => `${key}: ${value}`).join(" · ") || t('numberedVariant', { count: index + 1 })}</ThemedText>
        <ThemedText themeColor="textSecondary">{variant.sku ?? t('noSku')} · {t('saleAmount', { amount: price.format(variant.salePrice.amount) })}{variant.purchasePrice ? ` · ${t('purchaseAmount', { amount: price.format(variant.purchasePrice.amount) })}` : ""}</ThemedText>
        <ThemedText themeColor="textSecondary">{t('stockCount', { count: variant.stock })}</ThemedText>
      </View>)}
      </View> : <FieldGroup style={styles.columns}>
      <Field style={styles.column} invalid={!!errors.sku} disabled={disabled}>
        <FieldLabel>{t('optionalSku')}</FieldLabel><Input value={values.sku} onChangeText={(value) => setValue("sku", value)} maxLength={100} placeholder="SKU" accessibilityLabel="SKU" autoCapitalize="characters" />
        {errors.sku ? <FieldError>{errors.sku}</FieldError> : null}
      </Field>
      {current ? <Field style={styles.column} disabled><FieldLabel>{t('stockReadOnly')}</FieldLabel><Input value={String(current.variants[0]?.stock ?? 0)} onChangeText={() => {}} accessibilityLabel={t('readonlyStock', { count: current.variants[0]?.stock ?? 0 })} /></Field> : <Field style={styles.column} invalid={!!errors.stock} disabled={disabled}>
        <FieldLabel>{t('initialStockShort')}</FieldLabel><Input value={values.stock} onChangeText={(value) => setValue("stock", value)} keyboardType="number-pad" placeholder="0" accessibilityLabel={t('optionalInitialStock')} />
        {errors.stock ? <FieldError>{errors.stock}</FieldError> : null}
      </Field>}
      </FieldGroup>}
      {onCopiesChange ? <Field><FieldLabel>{t('labelCopies')}</FieldLabel><Input value={copies ?? "1"} onChangeText={onCopiesChange} keyboardType="number-pad" accessibilityLabel={t('labelCopies')} /></Field> : null}
      </View>
    </View>
    <Button variant="ghost" onPress={onCancel} disabled={saving || photoBusy}>{t('cancel')}</Button>
    {conflict ? <Button variant="ghost" onPress={onReviewCatalog}>{t('backToCatalog')}</Button> : null}
    {uncertain && onCheckStatus ? <Button variant="ghost" onPress={onCheckStatus}>{t('checkProductStatus')}</Button> : null}
  </ScrollView><View style={[styles.footer, { backgroundColor: theme.background, borderTopColor: theme.border }]}>
    <Button onPress={onSave} loading={saving} disabled={disabled || photoBusy}>{t('save')}</Button>
  </View></View>;
}

const styles = StyleSheet.create({
  layout: { flex: 1 }, scroll: { flex: 1 },
  page: { gap: 12, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16 },
  footer: { borderTopWidth: 1, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8 },
  details: { gap: 12 },
  descriptionInput: { minHeight: 72, textAlignVertical: "top" },
  section: { borderRadius: 10, overflow: "hidden" },
  sectionHeader: { paddingHorizontal: 12, paddingVertical: 8 },
  sectionBody: { gap: 12, padding: 12 },
  columns: { flexDirection: "row", gap: 12 },
  column: { flex: 1, minWidth: 0 },
  variants: { gap: 10 }, variant: { borderWidth: 1, borderRadius: 12, padding: 14, gap: 4 },
});
