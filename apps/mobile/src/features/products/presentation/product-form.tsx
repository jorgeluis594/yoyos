import { ScrollView, StyleSheet, View } from "react-native";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ThemedText } from "@/components/themed-text";
import { products } from "@mobile/features/products/composition";
import { ProductPhoto } from "./product-photo";
import type { Product, PhotoSelection, VariantId } from "../domain/product";

export type ProductFormValues = Readonly<{ name: string; description: string; sku: string; salePrice: string; purchasePrice: string; stock: string }>;
export type ProductFormField = keyof ProductFormValues | "form";

export function ProductForm({
  values, setValue, currency, current, photo, onPhotoChange, errors, disabled, photoBusy, onPhotoBusy, onSave, onCancel, onReviewCatalog, onCheckStatus, saving, conflict, uncertain, copies, onCopiesChange, onPrint, onPrintVariant,
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
  onPrint?: () => void;
  onPrintVariant?: (variantId: VariantId) => void;
}) {
  const multiVariant = (current?.variants.length ?? 1) > 1;
  return <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
    {errors.form ? <ThemedText accessibilityRole="alert" style={styles.error}>{errors.form}</ThemedText> : null}
    <FieldGroup>
      <Field required invalid={!!errors.name} disabled={disabled}>
        <FieldLabel>Nombre</FieldLabel><Input value={values.name} onChangeText={(value) => setValue("name", value)} maxLength={200} placeholder="Nombre del producto" accessibilityLabel="Nombre" />
        {errors.name ? <FieldError>{errors.name}</FieldError> : null}
      </Field>
      <Field invalid={!!errors.description} disabled={disabled}>
        <FieldLabel>Descripción</FieldLabel><Input multiline value={values.description} onChangeText={(value) => setValue("description", value)} maxLength={5000} placeholder="Descripción opcional" accessibilityLabel="Descripción" />
        {errors.description ? <FieldError>{errors.description}</FieldError> : null}
      </Field>
    </FieldGroup>
    <ProductPhoto
      value={photo}
      original={current?.photo}
      upload={products.uploadImage}
      disabled={disabled}
      onChange={onPhotoChange}
      onBusy={onPhotoBusy}
    />
    {multiVariant ? <View style={styles.variants}>
      <ThemedText type="subtitle">Variantes</ThemedText>
      {current?.variants.map((variant, index) => <View key={variant.id} style={styles.variant}>
        <ThemedText type="smallBold">{Object.entries(variant.attributes).map(([key, value]) => `${key}: ${value}`).join(" · ") || `Variante ${index + 1}`}</ThemedText>
        <ThemedText themeColor="textSecondary">{variant.sku ?? "Sin SKU"} · Venta {variant.salePrice.amount.toFixed(2)} {currency}{variant.purchasePrice ? ` · Compra ${variant.purchasePrice.amount.toFixed(2)} ${currency}` : ""}</ThemedText>
        <ThemedText themeColor="textSecondary">Stock {variant.stock}</ThemedText>
        {onPrintVariant ? <Button variant="secondary" onPress={() => onPrintVariant(variant.id)}>Imprimir etiqueta</Button> : null}
      </View>)}
    </View> : <FieldGroup>
      <Field invalid={!!errors.sku} disabled={disabled}>
        <FieldLabel>SKU (opcional)</FieldLabel><Input value={values.sku} onChangeText={(value) => setValue("sku", value)} maxLength={100} placeholder="SKU" accessibilityLabel="SKU" autoCapitalize="characters" />
        {errors.sku ? <FieldError>{errors.sku}</FieldError> : null}
      </Field>
      <Field required invalid={!!errors.salePrice} disabled={disabled}>
        <FieldLabel>Precio de venta ({currency})</FieldLabel><Input value={values.salePrice} onChangeText={(value) => setValue("salePrice", value)} keyboardType="decimal-pad" placeholder="0.00" accessibilityLabel="Precio de venta" />
        {errors.salePrice ? <FieldError>{errors.salePrice}</FieldError> : null}
      </Field>
      <Field invalid={!!errors.purchasePrice} disabled={disabled}>
        <FieldLabel>Precio de compra ({currency}, opcional)</FieldLabel><Input value={values.purchasePrice} onChangeText={(value) => setValue("purchasePrice", value)} keyboardType="decimal-pad" placeholder="0.00" accessibilityLabel="Precio de compra" />
        {errors.purchasePrice ? <FieldError>{errors.purchasePrice}</FieldError> : null}
      </Field>
      {current ? <ThemedText themeColor="textSecondary">Stock: {current.variants[0]?.stock ?? 0} · Solo lectura</ThemedText> : <Field invalid={!!errors.stock} disabled={disabled}>
        <FieldLabel>Stock inicial (opcional)</FieldLabel><Input value={values.stock} onChangeText={(value) => setValue("stock", value)} keyboardType="number-pad" placeholder="0" accessibilityLabel="Stock inicial" />
        {errors.stock ? <FieldError>{errors.stock}</FieldError> : null}
      </Field>}
    </FieldGroup>}
    {onCopiesChange ? <Field><FieldLabel>Copias de la etiqueta</FieldLabel><Input value={copies ?? "1"} onChangeText={onCopiesChange} keyboardType="number-pad" accessibilityLabel="Copias de la etiqueta" /></Field> : null}
    <View style={styles.actions}>
      {!current && onPrint ? <Button onPress={onPrint} loading={saving} disabled={disabled || photoBusy}>Guardar e imprimir</Button> : null}
      <Button variant={current ? "default" : "secondary"} onPress={onSave} loading={saving} disabled={disabled || photoBusy}>{current ? "Guardar" : onPrint ? "Solo guardar" : "Guardar"}</Button>
      {current && onPrint ? <Button variant="secondary" onPress={onPrint} disabled={saving || photoBusy || !!conflict}>Imprimir etiqueta</Button> : null}
      <Button variant="secondary" onPress={onCancel} disabled={saving || photoBusy}>Cancelar</Button>
    </View>
    {conflict ? <Button variant="ghost" onPress={onReviewCatalog}>Volver al catálogo</Button> : null}
    {uncertain && onCheckStatus ? <Button variant="ghost" onPress={onCheckStatus}>Consultar estado del producto</Button> : null}
  </ScrollView>;
}

const styles = StyleSheet.create({
  page: { gap: 24, padding: 20, paddingBottom: 48 }, error: { color: "#b42318" },
  variants: { gap: 10 }, variant: { borderWidth: 1, borderColor: "#ddd", borderRadius: 12, padding: 14, gap: 4 },
  actions: { flexDirection: "row", gap: 12, justifyContent: "flex-end" },
});
