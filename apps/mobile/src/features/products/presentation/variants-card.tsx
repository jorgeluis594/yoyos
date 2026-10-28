/** @jsxImportSource react */
// Preserve native Pressable style callbacks outside NativeWind interop.
import { Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { EditorDraft } from "@shared/product-variants";
import { Button } from "@mobile/components/ui/button";
import { ThemedText } from "@mobile/components/themed-text";
import { useTheme } from "@mobile/hooks/use-theme";
import { SymbolView } from "expo-symbols";
import { editorSummary } from "./product-editor-summary";
import tokens from "../../../../../../docs/design-tokens.json";

const names = (draft: EditorDraft) => draft.options.filter((option) => !option.marked);

/** The «Variantes» card of the product form: how a product gets options, and where its variants are edited. */
export function VariantsCard({ draft, disabled, errorCount, formatPrice, onEditOptions, onOpenVariants }: {
  draft: EditorDraft;
  disabled: boolean;
  /** Rows the last rejected save marked. */
  errorCount: number;
  formatPrice: (amount: number) => string;
  onEditOptions: () => void;
  onOpenVariants: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const card = [styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }];
  if (draft.options.length === 0) return <View style={card}>
    <ThemedText type="small" accessibilityRole="header" style={styles.heading}>{t("variants")}</ThemedText>
    <Button variant="secondary" onPress={onEditOptions} disabled={disabled}>{t("addOptions")}</Button>
    <ThemedText type="small" themeColor="textSecondary">{t("addOptionsHelp")}</ThemedText>
  </View>;
  const summary = editorSummary(draft);
  return <>
    <View style={card}>
      <View style={styles.title}>
        <ThemedText type="small" accessibilityRole="header" style={styles.heading}>{t("variants")}</ThemedText>
        <Button variant="ghost" onPress={onEditOptions} disabled={disabled}>{t("edit")}</Button>
      </View>
      {names(draft).map((option) => <View key={option.id} style={styles.option}>
        <ThemedText themeColor="textSecondary">{option.name}</ThemedText>
        <ThemedText style={styles.values}>{option.values.filter((value) => !value.marked).map((value) => value.name).join(", ")}</ThemedText>
      </View>)}
      <Pressable accessibilityRole="button" accessibilityLabel={t("openVariants")} disabled={disabled} onPress={onOpenVariants}
        style={({ pressed }) => [styles.summary, { borderColor: theme.border, backgroundColor: pressed ? theme.secondary : "transparent" }]}>
        <View style={styles.summaryText}>
          <ThemedText type="smallBold">{t("variantCount", { count: summary.count })}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {summary.from === null ? t("noActiveVariants") : t("variantSummary", { stock: summary.stock, price: formatPrice(summary.from) })}
          </ThemedText>
          {errorCount > 0 ? <ThemedText type="small" style={{ color: theme.error }}>{t("variantsWithErrors", { count: errorCount })}</ThemedText> : null}
        </View>
        <SymbolView name={{ ios: "chevron.right", android: "chevron_right" }} size={tokens.sizing.iconAction} tintColor={theme.textSecondary} />
      </Pressable>
    </View>
    <ThemedText type="small" themeColor="textSecondary">{t("variantsHint")}</ThemedText>
  </>;
}

const styles = StyleSheet.create({
  card: { borderWidth: tokens.sizing.borderWidth, borderRadius: tokens.radius.card, padding: tokens.spacing["4"], gap: tokens.spacing["3"] },
  title: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: tokens.spacing["2"] },
  heading: { fontWeight: 600 },
  option: { flexDirection: "row", justifyContent: "space-between", gap: tokens.spacing["3"] },
  values: { flexShrink: 1, textAlign: "right" },
  summary: { minHeight: tokens.sizing.listRowMobileMinHeight, flexDirection: "row", alignItems: "center", gap: tokens.spacing["3"], borderWidth: tokens.sizing.borderWidth, borderRadius: tokens.radius.card, padding: tokens.spacing["3"] },
  summaryText: { flex: 1, minWidth: 0 },
});
