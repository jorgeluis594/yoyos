/** @jsxImportSource react */
// Preserve native Pressable style callbacks outside NativeWind interop.
import { useState } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SymbolView } from "expo-symbols";
import { useTranslation } from "react-i18next";
import { Button } from "@mobile/components/ui/button";
import { Field, FieldError, FieldLabel } from "@mobile/components/ui/field";
import { ThemedText } from "@mobile/components/themed-text";
import { useTheme } from "@mobile/hooks/use-theme";
import { makeCopyCount, type CopyCount } from "@mobile/features/printing/composition";
import { usePrint } from "@mobile/features/printing/presentation/print-provider";
import { QuantityStepper } from "@mobile/features/products/presentation/quantity-stepper";
import type { Product, VariantId } from "@mobile/features/products/domain/product";
import tokens from "../../../../../../docs/design-tokens.json";

const maxCopies = 99;

function variantName(variant: Product["variants"][number], index: number, numbered: (count: number) => string) {
  return Object.entries(variant.attributes).map(([key, value]) => `${key}: ${value}`).join(" · ") || numbered(index + 1);
}

/** Everything about printing this product's label right now: what prints, how many copies and on which printer. */
export function ProductPrintSheet({ visible, product, unsavedChanges, onClose, onPrint }: {
  visible: boolean;
  product: Product;
  unsavedChanges: boolean;
  onClose: () => void;
  onPrint: (variantId: VariantId, copies: CopyCount) => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { showPrinterPicker, printerName } = usePrint();
  const single = product.variants.length === 1 ? product.variants[0] : undefined;
  const [variantId, setVariantId] = useState<VariantId | null>(single?.id ?? null);
  const [copies, setCopies] = useState("1");
  const [copiesError, setCopiesError] = useState<string | null>(null);
  const numbered = (count: number) => t('numberedVariant', { count });
  const print = () => {
    const quantity = makeCopyCount(Number(copies));
    if (!/^\d+$/.test(copies) || !quantity.success || quantity.data > maxCopies) { setCopiesError(t('copyCountError')); return; }
    if (variantId) onPrint(variantId, quantity.data);
  };
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
    <View style={styles.scrim}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('close')} style={styles.dismiss} onPress={onClose} />
      <SafeAreaView edges={["bottom"]} style={[styles.sheet, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
        <View style={styles.header}>
          <ThemedText type="subtitle" accessibilityRole="header" style={styles.title}>{t('printLabel')}</ThemedText>
          <Pressable accessibilityRole="button" accessibilityLabel={t('close')} onPress={onClose}
            style={({ pressed }) => [styles.iconAction, { backgroundColor: pressed ? theme.accent : "transparent" }]}>
            <SymbolView name={{ ios: "xmark", android: "close" }} size={tokens.sizing.iconNavigation} tintColor={theme.text} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {unsavedChanges ? <View style={[styles.notice, { backgroundColor: theme.warningSurface }]}>
            <ThemedText type="small" style={{ color: theme.warning }}>{t('printSavedDataHint')}</ThemedText>
          </View> : null}
          {single ? <View style={styles.group}>
            <ThemedText type="small" themeColor="textSecondary">{t('labelContent')}</ThemedText>
            <ThemedText type="smallBold">{product.name}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{single.sku ?? t('noSku')}</ThemedText>
          </View> : <View style={styles.group} accessibilityRole="radiogroup" accessibilityLabel={t('selectVariantToPrint')}>
            <ThemedText type="small" style={styles.heading}>{t('selectVariantToPrint')}</ThemedText>
            {product.variants.map((variant, index) => {
              const selected = variant.id === variantId;
              return <Pressable key={variant.id} accessibilityRole="radio" accessibilityState={{ checked: selected }} accessibilityLabel={variantName(variant, index, numbered)}
                onPress={() => setVariantId(variant.id)}
                style={({ pressed }) => [styles.option, { borderColor: selected ? theme.ring : theme.border, backgroundColor: selected ? theme.accent : pressed ? theme.secondary : "transparent" }]}>
                <View style={styles.optionText}>
                  <ThemedText type="small" style={styles.heading}>{variantName(variant, index, numbered)}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">{variant.sku ?? t('noSku')}</ThemedText>
                </View>
                {selected ? <SymbolView name={{ ios: "checkmark", android: "check" }} size={tokens.sizing.iconAction} tintColor={theme.primary} /> : null}
              </Pressable>;
            })}
          </View>}
          <Field invalid={!!copiesError}>
            <FieldLabel>{t('labelCopies')}</FieldLabel>
            <QuantityStepper value={copies} onChange={(value) => { setCopies(value); setCopiesError(null); }} disabled={false} min={1} max={maxCopies}
              accessibilityLabel={t('labelCopies')} decreaseLabel={t('decreaseCopies')} increaseLabel={t('increaseCopies')} />
            {copiesError ? <FieldError>{copiesError}</FieldError> : null}
          </Field>
          {Platform.OS === "android" ? <View style={[styles.printer, { borderColor: theme.border }]}>
            <View style={styles.optionText}>
              <ThemedText type="small" themeColor="textSecondary">{t('printer')}</ThemedText>
              <ThemedText type="small" style={styles.heading}>{printerName ?? t('noPrinterSelected')}</ThemedText>
            </View>
            <Button variant="secondary" onPress={showPrinterPicker}>{printerName ? t('changePrinter') : t('choosePrinterAction')}</Button>
          </View> : <ThemedText type="small" themeColor="textSecondary">{t('printingAndroidOnly')}</ThemedText>}
        </ScrollView>
        <View style={styles.actions}>
          <Button onPress={print} disabled={!variantId}>{t('print')}</Button>
        </View>
      </SafeAreaView>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0, 0, 0, 0.5)" },
  dismiss: { flex: 1 },
  sheet: { maxHeight: "85%", borderTopLeftRadius: tokens.radius.overlay, borderTopRightRadius: tokens.radius.overlay, borderWidth: tokens.sizing.borderWidth, borderBottomWidth: 0 },
  header: { minHeight: tokens.layout.appHeaderMinHeight, flexDirection: "row", alignItems: "center", gap: tokens.spacing["2"], paddingLeft: tokens.spacing["4"], paddingRight: tokens.spacing["1"] },
  title: { flex: 1, minWidth: 0 },
  iconAction: { width: tokens.sizing.touchTargetMinSize, height: tokens.sizing.touchTargetMinSize, borderRadius: tokens.sizing.touchTargetMinSize / 2, alignItems: "center", justifyContent: "center" },
  body: { gap: tokens.spacing["4"], paddingHorizontal: tokens.spacing["4"], paddingBottom: tokens.spacing["4"] },
  notice: { borderRadius: tokens.radius.control, padding: tokens.spacing["3"] },
  group: { gap: tokens.spacing["2"] },
  heading: { fontWeight: 600 },
  option: { minHeight: tokens.sizing.listRowMobileMinHeight, flexDirection: "row", alignItems: "center", gap: tokens.spacing["3"], borderWidth: tokens.sizing.borderWidth, borderRadius: tokens.radius.card, paddingHorizontal: tokens.spacing["3"], paddingVertical: tokens.spacing["2"] },
  optionText: { flex: 1, minWidth: 0 },
  printer: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: tokens.spacing["3"], borderTopWidth: tokens.sizing.borderWidth, paddingTop: tokens.spacing["4"] },
  actions: { paddingHorizontal: tokens.spacing["4"], paddingTop: tokens.spacing["2"], paddingBottom: tokens.spacing["4"] },
});
