/** @jsxImportSource react */
// Preserve native Pressable style callbacks outside NativeWind interop.
import { useMemo, useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useTranslation } from "react-i18next";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  addCombination, applyBulk, isChipActive, orderedRows, removalOf, removeRow, rowLabel, toggleAll, toggleChip, undoRemoveRow,
  uncreatedCombinations, uncreatedCount, copiedStockNotice, inactiveSourceCount, variantCounter, type EditorDraft, type EditorRow, type RowPatch,
} from "@shared/product-variants";
import { Button } from "@mobile/components/ui/button";
import { ActionMenu } from "@mobile/components/ui/action-menu";
import { Field, FieldError, FieldLabel } from "@mobile/components/ui/field";
import { Input } from "@mobile/components/ui/input";
import { ThemedText } from "@mobile/components/themed-text";
import { ThemedView } from "@mobile/components/themed-view";
import { useTheme } from "@mobile/hooks/use-theme";
import { useAccess } from "@/features/users/presentation/access-provider";
import { countryCurrencies } from "@shared/country";
import { formEdges } from "./form-edges";
import { ProductTopBar } from "./product-top-bar";
import { useProductEditor } from "./product-editor-state";
import { productPath } from "./product-routes";
import { QuantityStepper } from "./quantity-stepper";
import tokens from "../../../../../../docs/design-tokens.json";

type Bulk = "salePrice" | "stock" | "purchasePrice";

export default function VariantsScreen() {
  const { draft } = useProductEditor();
  const { productId } = useLocalSearchParams<{ productId?: string }>();
  return draft ? <Variants draft={draft} productId={productId} /> : null;
}

const decimal = (text: string) => /^\d+(?:\.\d{1,2})?$/.test(text.trim()) ? Number(text) : null;

function Variants({ draft, productId }: { draft: EditorDraft; productId?: string | undefined }) {
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const { state } = useAccess();
  const editor = useProductEditor();
  const [bulk, setBulk] = useState<Bulk | null>(null);
  const [listing, setListing] = useState(false);
  const [limit, setLimit] = useState(50);
  const currency = state.status === "ready" ? countryCurrencies[state.company.country] : "PEN";
  const money = new Intl.NumberFormat(i18n.language === "pt-BR" ? "pt-BR" : "es-PE", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const rows = orderedRows(draft);
  const live = new Set(rows.filter((row) => removalOf(draft, row) === null).map((row) => row.ref));
  const selection = editor.selection.filter((ref) => live.has(ref));
  const counter = variantCounter(draft);
  const stockNotice = copiedStockNotice(draft);
  const fromInactive = inactiveSourceCount(draft);
  const missing = uncreatedCount(draft);
  const chips = draft.options.filter((option) => !option.marked).flatMap((option) => option.values.filter((value) => !value.marked));
  const selected = rows.filter((row) => selection.includes(row.ref));
  const uncreated = useMemo(() => draft.saved && missing > 0 ? uncreatedCombinations(draft, { limit: missing === 1 ? 1 : limit }) : { items: [], hasMore: false }, [draft, missing, limit]);
  const set = (next: EditorDraft) => editor.setDraft(next);
  const detailOf = (row: EditorRow) => router.push({ pathname: productPath(productId, "draft-variant"), params: { ref: row.ref, ...(productId ? { productId } : {}) } } as never);

  const removeSelected = () => {
    const next = selected.filter((row) => row.id === null).reduce((current, row) => { const result = removeRow(current, row.ref); return result.success ? result.data : current; }, draft);
    set(next);
    editor.setSelection(selection.filter((ref) => !selected.some((row) => row.ref === ref && row.id === null)));
  };
  const apply = (patch: RowPatch) => {
    const result = applyBulk(draft, selection, patch);
    set(result.draft);
    setBulk(null);
  };
  const chipNames = (() => {
    const active = draft.options.filter((option) => !option.marked).flatMap((option) => option.values.filter((value) => !value.marked && isChipActive(draft, selection, value.id)).map((value) => ({ option: option.name, value: value.name })));
    return active.map((entry) => `${entry.option.toLowerCase()} ${entry.value}`).join(", ");
  })();

  const renderRow = ({ item: row }: { item: EditorRow }) => {
    const removal = removalOf(draft, row);
    const error = editor.errors.rows[row.ref];
    const checked = selection.includes(row.ref);
    const disabled = removal !== null || row.status === "inactive";
    const label = rowLabel(draft, row) || t("numberedVariant", { count: 1 });
    const tags = [
      ...(draft.saved && row.id === null && removal === null ? [t("rowNew")] : []),
      ...(row.status === "inactive" ? [t("rowInactive")] : []),
      ...(removal ? [row.id !== null ? t("rowWillBeDeleted") : t("rowWillBeRemoved")] : []),
    ];
    const body = <View style={styles.rowText}>
      <ThemedText type="smallBold" style={removal ? styles.struck : undefined}>{label}</ThemedText>
      {tags.length ? <ThemedText type="small" themeColor="textSecondary">{tags.join(" · ")}</ThemedText> : null}
      {removal === null ? <ThemedText type="small" themeColor="textSecondary">{row.stock > 0 ? t("stockCount", { count: row.stock }) : t("catalogSoldOut")}</ThemedText> : null}
      {error ? <ThemedText type="small" accessibilityRole="alert" style={{ color: theme.error }}>{error}</ThemedText> : null}
      {removal === "self" ? <Button variant="ghost" onPress={() => set(undoRemoveRow(draft, row.ref))}>{t("undo")}</Button> : null}
    </View>;
    return <View style={[styles.row, { borderColor: error ? theme.error : theme.border, backgroundColor: checked ? theme.accent : theme.backgroundElement }]}>
      <Pressable accessibilityRole="checkbox" accessibilityLabel={t("selectVariant", { name: label })} accessibilityState={{ checked, disabled }} disabled={disabled}
        onPress={() => editor.setSelection(checked ? selection.filter((ref) => ref !== row.ref) : [...selection, row.ref])} style={styles.check}>
        <SymbolView name={checked ? { ios: "checkmark.square.fill", android: "check_box" } : { ios: "square", android: "check_box_outline_blank" }} size={tokens.sizing.iconAction} tintColor={disabled ? theme.textSecondary : theme.primary} />
      </Pressable>
      {row.id === null && removal === null ? <Pressable accessibilityRole="button" accessibilityLabel={t("openVariant", { name: label })} onPress={() => detailOf(row)} style={styles.rowPress}>
        {body}
        <ThemedText type="smallBold">{money.format(row.salePrice)}</ThemedText>
        <SymbolView name={{ ios: "chevron.right", android: "chevron_right" }} size={tokens.sizing.iconAction} tintColor={theme.textSecondary} />
      </Pressable> : <View style={styles.rowPress}>
        {body}
        {removal === null ? <ThemedText type="smallBold">{money.format(row.salePrice)}</ThemedText> : null}
      </View>}
    </View>;
  };

  const header = <View style={styles.header}>
    {stockNotice !== null ? <View style={[styles.notice, { backgroundColor: theme.warningSurface }]}><ThemedText type="small" style={{ color: theme.warning }}>{t("stockCopiedNotice", { count: stockNotice })}</ThemedText></View> : null}
    {fromInactive > 0 ? <View style={[styles.notice, { backgroundColor: theme.warningSurface }]}><ThemedText type="small" style={{ color: theme.warning }}>{t("copiedFromInactiveNotice", { count: fromInactive })}</ThemedText></View> : null}
    <ThemedText type="small" style={styles.heading}>{t("selectHeading")}</ThemedText>
    <View style={styles.chips}>
      <Chip label={t("allVariants")} active={selection.length > 0 && rows.filter((row) => live.has(row.ref) && row.status === "active").every((row) => selection.includes(row.ref))} onPress={() => editor.setSelection(toggleAll(draft, selection))} />
      {chips.map((value) => <Chip key={value.id} label={value.name} active={isChipActive(draft, selection, value.id)} onPress={() => editor.setSelection(toggleChip(draft, selection, value.id))} />)}
    </View>
    <ThemedText type="small" themeColor="textSecondary">
      {[t("variantCounter", { count: counter.count, max: counter.maximum }), ...(counter.inactive > 0 ? [t("inactiveCount", { count: counter.inactive })] : []), ...(selection.length > 0 ? [t("selectedCount", { count: selection.length })] : [])].join(" · ")}
    </ThemedText>
  </View>;

  const footer = <View style={styles.footer}>
    {draft.saved && missing > 0 ? <View style={[styles.notice, { backgroundColor: theme.secondary }]}>
      {missing === 1 && uncreated.items[0] ? <>
        <ThemedText type="small">{t("uncreatedOne", { label: uncreated.items[0].label })}</ThemedText>
        <Button variant="secondary" disabled={counter.count >= counter.maximum} onPress={() => { const result = addCombination(draft, uncreated.items[0].combination); if (result.success) set(result.data); }}>{counter.count >= counter.maximum ? t("variantLimitTitle") : t("add")}</Button>
      </> : <>
        <ThemedText type="small">{t("uncreatedMany", { count: missing })}</ThemedText>
        <Button variant="secondary" onPress={() => setListing(!listing)}>{listing ? t("hide") : t("view")}</Button>
        {listing ? <>
          {uncreated.items.map((item) => <View key={item.label} style={styles.uncreated}>
            <ThemedText type="small" style={styles.rowText}>{item.label}</ThemedText>
            <Button variant="ghost" disabled={counter.count >= counter.maximum} onPress={() => { const result = addCombination(draft, item.combination); if (result.success) set(result.data); }}>{counter.count >= counter.maximum ? t("variantLimitTitle") : t("add")}</Button>
          </View>)}
          {uncreated.hasMore ? <Button variant="ghost" onPress={() => setLimit(limit + 50)}>{t("viewMore")}</Button> : null}
        </> : null}
      </>}
    </View> : null}
  </View>;

  return <ThemedView style={styles.page}><SafeAreaView edges={formEdges} style={styles.safe}>
    <ProductTopBar title={t("variants")} onClose={() => router.back()} back />
    <FlatList data={rows} keyExtractor={(row) => row.ref} renderItem={renderRow} ListHeaderComponent={header} ListFooterComponent={footer}
      contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" />
    {selection.length > 0 ? <View style={[styles.bar, { backgroundColor: theme.backgroundElement, borderTopColor: theme.border }]}>
      <View style={styles.barTitle}>
        <ThemedText type="smallBold">{t("selectedCount", { count: selection.length })}</ThemedText>
        <Button variant="ghost" onPress={() => editor.setSelection([])}>{t("clearSelection")}</Button>
      </View>
      <View style={styles.actions}>
        <View style={styles.grow}><Button onPress={() => setBulk("salePrice")}>{t("editPrice")}</Button></View>
        <View style={styles.grow}><Button variant="secondary" onPress={() => setBulk("stock")}>{t("editStock")}</Button></View>
        <ActionMenu actions={[
          { id: "purchase", label: t("editPurchasePrice"), onSelect: () => setBulk("purchasePrice") },
          ...(selected.some((row) => row.id === null) ? [{ id: "remove", label: t("removeSelected"), destructive: true, onSelect: removeSelected }] : []),
        ]} />
      </View>
    </View> : null}
    {bulk ? <BulkSheet kind={bulk} count={selection.length} newCount={selected.filter((row) => row.id === null).length} chipNames={chipNames} currency={currency} onClose={() => setBulk(null)}
      onApply={(patch) => apply(patch)} /> : null}
  </SafeAreaView></ThemedView>;
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const theme = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: active }} onPress={onPress}
    style={[styles.chip, { borderColor: active ? theme.primary : theme.border, backgroundColor: active ? theme.accent : "transparent" }]}>
    {active ? <SymbolView name={{ ios: "checkmark", android: "check" }} size={tokens.sizing.iconAction} tintColor={theme.primary} /> : null}
    <ThemedText type="small" style={active ? styles.heading : undefined}>{label}</ThemedText>
  </Pressable>;
}

function BulkSheet({ kind, count, newCount, chipNames, currency, onClose, onApply }: {
  kind: Bulk; count: number; newCount: number; chipNames: string; currency: string; onClose: () => void; onApply: (patch: RowPatch) => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const stock = kind === "stock";
  const applied = stock ? newCount : count;
  const submit = () => {
    if (stock) {
      if (!/^\d+$/.test(text.trim())) { setError(t("initialStockInvalid")); return; }
      onApply({ stock: Number(text) });
      return;
    }
    const amount = decimal(text);
    if (amount === null || kind === "salePrice" && amount <= 0) { setError(kind === "salePrice" ? t("salePriceInvalid") : t("purchasePriceInvalid")); return; }
    onApply({ [kind]: amount });
  };
  const title = kind === "salePrice" ? t("editSalePriceTitle") : kind === "stock" ? t("editStockTitle") : t("editPurchasePriceTitle");
  return <Modal visible transparent animationType="slide" onRequestClose={onClose}>
    <View style={styles.scrim}>
      <Pressable accessibilityRole="button" accessibilityLabel={t("close")} style={styles.dismiss} onPress={onClose} />
      <SafeAreaView edges={["bottom"]} style={[styles.sheet, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
        <ThemedText type="subtitle" accessibilityRole="header">{title}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{chipNames ? t("applyToSelectedBy", { count, chips: chipNames }) : t("applyToSelected", { count })}</ThemedText>
        {stock && newCount < count ? <ThemedText type="small" themeColor="textSecondary">{t("stockOnlyNew", { count: newCount })}</ThemedText> : <ThemedText type="small" themeColor="textSecondary">{t("replacesCurrent")}</ThemedText>}
        <Field invalid={!!error}>
          <FieldLabel>{title}</FieldLabel>
          {stock ? <QuantityStepper value={text} onChange={(value) => { setText(value); setError(null); }} disabled={false} accessibilityLabel={title} decreaseLabel={t("decreaseStock")} increaseLabel={t("increaseStock")} />
            : <Input value={text} onChangeText={(value) => { setText(value); setError(null); }} keyboardType="decimal-pad" placeholder="0.00" accessibilityLabel={`${title} (${currency})`} />}
          {error ? <FieldError>{error}</FieldError> : null}
        </Field>
        <Button onPress={submit} disabled={applied === 0}>{t("applyToCount", { count: applied })}</Button>
      </SafeAreaView>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  page: { flex: 1 }, safe: { flex: 1 }, grow: { flex: 1 },
  content: { gap: tokens.spacing["2"], padding: tokens.spacing["4"], paddingBottom: tokens.spacing["8"] },
  header: { gap: tokens.spacing["3"], paddingBottom: tokens.spacing["2"] },
  heading: { fontWeight: 600 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing["2"] },
  chip: { minHeight: tokens.sizing.touchTargetMinSize, flexDirection: "row", alignItems: "center", gap: tokens.spacing["1"], borderWidth: tokens.sizing.borderWidth, borderRadius: tokens.sizing.touchTargetMinSize / 2, paddingHorizontal: tokens.spacing["4"] },
  notice: { borderRadius: tokens.radius.control, padding: tokens.spacing["3"], gap: tokens.spacing["2"] },
  row: { minHeight: tokens.sizing.listRowMobileMinHeight, flexDirection: "row", alignItems: "center", borderWidth: tokens.sizing.borderWidth, borderRadius: tokens.radius.card },
  check: { width: tokens.sizing.touchTargetMinSize, height: tokens.sizing.touchTargetMinSize, alignItems: "center", justifyContent: "center" },
  rowPress: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: tokens.spacing["2"], paddingVertical: tokens.spacing["2"], paddingRight: tokens.spacing["3"] },
  rowText: { flex: 1, minWidth: 0 },
  struck: { textDecorationLine: "line-through" },
  footer: { gap: tokens.spacing["2"], paddingTop: tokens.spacing["2"] },
  uncreated: { flexDirection: "row", alignItems: "center", gap: tokens.spacing["2"] },
  bar: { borderTopWidth: tokens.sizing.borderWidth, padding: tokens.spacing["3"], gap: tokens.spacing["2"] },
  barTitle: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  actions: { flexDirection: "row", alignItems: "center", gap: tokens.spacing["2"] },
  scrim: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0, 0, 0, 0.5)" },
  dismiss: { flex: 1 },
  sheet: { gap: tokens.spacing["3"], padding: tokens.spacing["4"], borderTopLeftRadius: tokens.radius.overlay, borderTopRightRadius: tokens.radius.overlay, borderWidth: tokens.sizing.borderWidth, borderBottomWidth: 0 },
});
