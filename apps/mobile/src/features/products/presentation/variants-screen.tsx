/** @jsxImportSource react */
// Preserve native Pressable style callbacks outside NativeWind interop.
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from "react-native";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
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
import { editorSummary } from "./product-editor-summary";
import { formEdges } from "./form-edges";
import { ProductTopBar } from "./product-top-bar";
import { useProductEditor } from "./product-editor-state";
import { announceFocus, formOf, sameForm, VariantRowEditor, type VariantForm } from "./variant-row-editor";
import { useProductDraft } from "./draft-guard";
import { showConfirmation } from "@mobile/components/ui/show-confirmation";
import { QuantityStepper } from "@mobile/components/ui/quantity-stepper";
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
  const editor = useProductEditor();
  const [bulk, setBulk] = useState<Bulk | null>(null);
  const [listing, setListing] = useState(false);
  const [limit, setLimit] = useState(50);
  const { currency } = editor;
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
  const { dirty: productDirty } = useProductDraft();
  const navigation = useNavigation();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [typed, setTyped] = useState<Readonly<Record<string, VariantForm>>>({});
  const [busy, setBusy] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const buttons = useRef<Record<string, View | null>>({});
  const register = useCallback((ref: string, node: View | null) => { buttons.current[ref] = node; }, []);
  const product = editor.detail?.id === productId ? editor.detail : null;
  const expandedRow = rows.find((row) => row.ref === expanded);
  const typedFor = (row: EditorRow) => typed[row.ref] !== undefined && !sameForm(typed[row.ref], formOf(row));
  const inlineDirty = expandedRow !== undefined && typedFor(expandedRow);
  const dropTyped = (ref: string) => setTyped(({ [ref]: _dropped, ...rest }) => rest);
  const discardAsk = (then: () => void) => showConfirmation({ title: t("discardChanges"), description: t("discardDescription"), confirmLabel: t("discard"), cancelLabel: t("keepEditing"), destructive: true, onConfirm: then });
  const collapse = () => {
    const ref = expanded;
    setExpanded(null);
    if (ref !== null) { dropTyped(ref); setTimeout(() => announceFocus(buttons.current[ref]), 0); }
  };
  usePreventRemove(inlineDirty, ({ data }) => discardAsk(() => { if (expanded !== null) dropTyped(expanded); navigation.dispatch(data.action); }));

  const toggle = (row: EditorRow) => {
    if (busy) return;
    if (row.id === null) {
      const open = () => productId ? router.push({ pathname: "/products/[productId]/draft-variant", params: { productId, ref: row.ref } }) : router.push({ pathname: "/products/new/draft-variant", params: { ref: row.ref } });
      if (inlineDirty) discardAsk(() => { collapse(); open(); }); else open();
      return;
    }
    const next = expanded === row.ref ? null : row.ref;
    const go = () => { if (expanded !== null) dropTyped(expanded); setDeleted(false); setExpanded(next); if (next === null && expanded !== null) setTimeout(() => announceFocus(buttons.current[expanded]), 0); };
    if (inlineDirty) discardAsk(go); else go();
  };
  const check = (row: EditorRow) => {
    const checked = selection.includes(row.ref);
    editor.setSelection(checked ? selection.filter((ref) => ref !== row.ref) : [...selection, row.ref]);
  };
  // Memoized rows read the latest handlers through these stable ones.
  const undo = (ref: string) => set(undoRemoveRow(draft, ref));
  const latest = useRef({ toggle, check, undo });
  useEffect(() => { latest.current = { toggle, check, undo }; });
  const onToggle = useCallback((row: EditorRow) => latest.current.toggle(row), []);
  const onCheck = useCallback((row: EditorRow) => latest.current.check(row), []);
  const onUndo = useCallback((ref: string) => latest.current.undo(ref), []);

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

  const price = (row: EditorRow) => money.format(row.salePrice);
  const renderRow = ({ item: row }: { item: EditorRow }) => {
    const open = expanded === row.ref && row.id !== null && product !== null;
    return <VariantRow row={row} label={rowLabel(draft, row) || t("numberedVariant", { count: 1 })} removal={removalOf(draft, row)} saved={draft.saved}
      error={editor.errors.rows[row.ref]} checked={selection.includes(row.ref)} expanded={open} locked={busy} price={price(row)}
      register={register} onToggle={onToggle} onCheck={onCheck} onUndo={onUndo}>
      {open && row.id !== null && row.original !== null ? <VariantRowEditor product={product} row={{ ...row, id: row.id, original: row.original }} form={typed[row.ref] ?? formOf(row)}
        onChange={(form) => setTyped((current) => ({ ...current, [row.ref]: form }))} typed={typedFor(row)} pendingEdits={editor.dirty || productDirty}
        onBusy={setBusy} onCancel={() => { if (typedFor(row)) discardAsk(collapse); else collapse(); }} onSaved={() => dropTyped(row.ref)}
        onDeleted={() => { dropTyped(row.ref); setExpanded(null); setDeleted(true); }} onReload={() => { editor.requestReload(); router.back(); }} /> : null}
    </VariantRow>;
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
    <View style={styles.total}><ThemedText type="smallBold">{t("stockTotal")}</ThemedText><ThemedText type="smallBold">{editorSummary(draft).stock}</ThemedText></View>
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
    {deleted ? <ThemedText type="small" accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.pinned}>{t("variantDeleted")}</ThemedText> : null}
    <KeyboardAvoidingView style={styles.safe} behavior={Platform.OS === "ios" ? "padding" : undefined}>
    <FlatList data={rows} keyExtractor={(row) => row.ref} renderItem={renderRow} extraData={[expanded, typed, busy, selection, editor.errors, editor.dirty, productDirty]}
      ListHeaderComponent={header} ListFooterComponent={footer} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" />
    </KeyboardAvoidingView>
    {selection.length > 0 && expanded === null ? <View style={[styles.bar, { backgroundColor: theme.backgroundElement, borderTopColor: theme.border }]}>
      <View style={styles.barTitle}>
        <ThemedText type="smallBold">{t("selectedCount", { count: selection.length })}</ThemedText>
        {selected.some((row) => row.id === null) ? <Button variant="ghost" onPress={removeSelected}>{t("removeSelected")}</Button> : null}
        <Button variant="ghost" onPress={() => editor.setSelection([])}>{t("clearSelection")}</Button>
      </View>
      <View style={styles.actions}>
        <View style={styles.grow}><Button onPress={() => setBulk("salePrice")}>{t("editPrice")}</Button></View>
        <View style={styles.grow}><Button variant="secondary" onPress={() => setBulk("stock")}>{t("editStock")}</Button></View>
        <ActionMenu actions={[
          { id: "purchase", label: t("editPurchasePrice"), onSelect: () => setBulk("purchasePrice") },
        ]} />
      </View>
    </View> : null}
    {bulk ? <BulkSheet kind={bulk} count={selection.length} chipNames={chipNames} currency={currency} onClose={() => setBulk(null)}
      onApply={(patch) => apply(patch)} /> : null}
  </SafeAreaView></ThemedView>;
}

type RowProps = Readonly<{
  row: EditorRow; label: string; removal: ReturnType<typeof removalOf>; saved: boolean; error: string | undefined; checked: boolean;
  expanded: boolean; locked: boolean; price: string; register: (ref: string, node: View | null) => void; children: ReactNode;
  onToggle: (row: EditorRow) => void; onCheck: (row: EditorRow) => void; onUndo: (ref: string) => void;
}>;

/** One row: memoized, so typing in the open editor does not render the others. */
const VariantRow = memo(function VariantRow({ row, label, removal, saved, error, checked, expanded, locked, price, register, children, onToggle, onCheck, onUndo }: RowProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const disabled = removal !== null || row.status === "inactive";
  const tags = [
    ...(saved && row.id === null && removal === null ? [t("rowNew")] : []),
    ...(row.status === "inactive" ? [t("rowInactive")] : []),
    ...(removal ? [row.id !== null ? t("rowWillBeDeleted") : t("rowWillBeRemoved")] : []),
  ];
  const body = <View style={styles.rowText}>
    <ThemedText type="smallBold" style={removal ? styles.struck : undefined}>{label}</ThemedText>
    {tags.length ? <ThemedText type="small" themeColor="textSecondary">{tags.join(" · ")}</ThemedText> : null}
    {removal === null ? <ThemedText type="small" themeColor="textSecondary">{row.stock > 0 ? t("catalogStock", { count: row.stock }) : t("catalogSoldOut")}</ThemedText> : null}
    {error ? <ThemedText type="small" accessibilityRole="alert" style={{ color: theme.error }}>{error}</ThemedText> : null}
    {removal === "self" ? <Button variant="ghost" onPress={() => onUndo(row.ref)}>{t("undo")}</Button> : null}
  </View>;
  return <View style={[styles.card, { borderColor: error ? theme.error : theme.border, backgroundColor: checked ? theme.accent : theme.backgroundElement }]}>
    <View style={styles.row}>
      <Pressable accessibilityRole="checkbox" accessibilityLabel={t("selectVariant", { name: label })} accessibilityState={{ checked, disabled }} disabled={disabled}
        onPress={() => onCheck(row)} style={styles.check}>
        <SymbolView name={checked ? { ios: "checkmark.square.fill", android: "check_box" } : { ios: "square", android: "check_box_outline_blank" }} size={tokens.sizing.iconAction} tintColor={disabled ? theme.textSecondary : theme.primary} />
      </Pressable>
      {removal === null ? <Pressable ref={(node) => register(row.ref, node)} accessibilityRole="button" accessibilityLabel={t("editVariant", { name: label })} accessibilityState={{ expanded, disabled: locked }}
        disabled={locked} onPress={() => onToggle(row)} style={styles.rowPress}>
        {body}
        <ThemedText type="smallBold">{price}</ThemedText>
        <SymbolView name={expanded ? { ios: "chevron.up", android: "expand_less" } : { ios: "chevron.right", android: "chevron_right" }} size={tokens.sizing.iconAction} tintColor={theme.textSecondary} />
      </Pressable> : <View style={styles.rowPress}>
        {body}
      </View>}
    </View>
    {children}
  </View>;
});

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const theme = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: active }} onPress={onPress}
    style={[styles.chip, { borderColor: active ? theme.primary : theme.border, backgroundColor: active ? theme.accent : "transparent" }]}>
    {active ? <SymbolView name={{ ios: "checkmark", android: "check" }} size={tokens.sizing.iconAction} tintColor={theme.primary} /> : null}
    <ThemedText type="small" style={active ? styles.heading : undefined}>{label}</ThemedText>
  </Pressable>;
}

function BulkSheet({ kind, count, chipNames, currency, onClose, onApply }: {
  kind: Bulk; count: number; chipNames: string; currency: string; onClose: () => void; onApply: (patch: RowPatch) => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const stock = kind === "stock";
  const applied = count;
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
        <ThemedText type="small" themeColor="textSecondary">{t("replacesCurrent")}</ThemedText>
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
  card: { borderWidth: tokens.sizing.borderWidth, borderRadius: tokens.radius.card },
  row: { minHeight: tokens.sizing.listRowMobileMinHeight, flexDirection: "row", alignItems: "center" },
  check: { width: tokens.sizing.touchTargetMinSize, height: tokens.sizing.touchTargetMinSize, alignItems: "center", justifyContent: "center" },
  rowPress: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: tokens.spacing["2"], paddingVertical: tokens.spacing["2"], paddingRight: tokens.spacing["3"] },
  rowText: { flex: 1, minWidth: 0 },
  struck: { textDecorationLine: "line-through" },
  pinned: { paddingHorizontal: tokens.spacing["4"], paddingTop: tokens.spacing["2"] },
  footer: { gap: tokens.spacing["2"], paddingTop: tokens.spacing["2"] },
  total: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: tokens.spacing["3"] },
  uncreated: { flexDirection: "row", alignItems: "center", gap: tokens.spacing["2"] },
  bar: { borderTopWidth: tokens.sizing.borderWidth, padding: tokens.spacing["3"], gap: tokens.spacing["2"] },
  barTitle: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  actions: { flexDirection: "row", alignItems: "center", gap: tokens.spacing["2"] },
  scrim: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0, 0, 0, 0.5)" },
  dismiss: { flex: 1 },
  sheet: { gap: tokens.spacing["3"], padding: tokens.spacing["4"], borderTopLeftRadius: tokens.radius.overlay, borderTopRightRadius: tokens.radius.overlay, borderWidth: tokens.sizing.borderWidth, borderBottomWidth: 0 },
});
