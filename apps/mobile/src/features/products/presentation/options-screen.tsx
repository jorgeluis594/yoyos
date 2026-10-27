/** @jsxImportSource react */
// Preserve native Pressable style callbacks outside NativeWind interop.
import { useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useNavigation, useRouter } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { SymbolView } from "expo-symbols";
import { useTranslation } from "react-i18next";
import * as Crypto from "expo-crypto";
import { SafeAreaView } from "react-native-safe-area-context";
import { productOptionLimits } from "@shared/contracts/products";
import {
  addOption, addValue, clearOptions, moveOption, moveValue, orderedRows, removalOf, removeOption, removeValue, renameOption, renameValue, setValueForExistingVariants,
  undoRemoveOption, undoRemoveValue, type EditorDraft, type EditorOption,
} from "@shared/product-variants";
import { Button } from "@mobile/components/ui/button";
import { Field, FieldError, FieldLabel } from "@mobile/components/ui/field";
import { Input } from "@mobile/components/ui/input";
import { OptionSelector } from "@mobile/components/ui/option-selector";
import { ThemedText } from "@mobile/components/themed-text";
import { ThemedView } from "@mobile/components/themed-view";
import { showConfirmation } from "@mobile/components/ui/show-confirmation";
import { useTheme } from "@mobile/hooks/use-theme";
import { ProductTopBar } from "./product-top-bar";
import { ReorderHandle } from "./reorder-handle";
import { editFailureMessage } from "./product-editor-messages";
import { editorSummary } from "./product-editor-summary";
import { hasIssues, optionIssues, savedOptionIssues, type OptionIssues } from "./option-validation";
import { formEdges } from "./form-edges";
import { useProductEditor } from "./product-editor-state";
import tokens from "../../../../../../docs/design-tokens.json";

type Slot = Readonly<{ id: string; text: string }>;
type NewOption = Readonly<{ id: string; name: string; slots: readonly Slot[]; existing: string | null }>;

const newId = () => Crypto.randomUUID();
const blankOption = (): NewOption => ({ id: newId(), name: "", slots: [{ id: newId(), text: "" }], existing: null });
const filled = (slots: readonly Slot[]) => slots.filter((slot) => slot.text.trim());

export default function OptionsScreen() {
  const { draft } = useProductEditor();
  return draft ? <OptionsEditor initial={draft} /> : null;
}

function OptionsEditor({ initial }: { initial: EditorDraft }) {
  const router = useRouter();
  const navigation = useNavigation();
  const { t } = useTranslation();
  const theme = useTheme();
  const editor = useProductEditor();
  const [working, setWorking] = useState(initial);
  const [editing, setEditing] = useState<string | null>(initial.options.length === 0 ? "new" : null);
  const [card, setCard] = useState<NewOption>(blankOption);
  const [notes, setNotes] = useState<Readonly<Record<string, string>>>({});
  const [trailing, setTrailing] = useState<Readonly<Record<string, string>>>({});
  // The field that adds a value keeps its React key when it becomes that value, so typing there never loses focus.
  const [serial, setSerial] = useState<Readonly<Record<string, number>>>({});
  const [aliases, setAliases] = useState<Readonly<Record<string, string>>>({});
  const leaving = useRef(false);
  const changed = working !== initial;
  /** A rejection of the last save goes away once the seller touches or undoes what it points at. */
  const clearRejection = (kind: "options" | "values", key: string) => {
    if (!editor.errors[kind][key]) return;
    const { [key]: _gone, ...rest } = editor.errors[kind];
    editor.setErrors({ ...editor.errors, [kind]: rest });
  };
  const note = (key: string, text: string | null) => setNotes((current) => ({ ...current, [key]: text ?? "" }));
  const trailingKey = (optionId: string) => `${optionId}:add:${serial[optionId] ?? 0}`;

  const confirmDiscard = (onDiscard: () => void) => showConfirmation({
    title: t("discardChanges"), description: t("discardDescription"), confirmLabel: t("discard"), cancelLabel: t("keepEditing"), destructive: true, onConfirm: onDiscard,
  });
  usePreventRemove(changed, ({ data }) => {
    if (leaving.current) { navigation.dispatch(data.action); return; }
    confirmDiscard(() => { leaving.current = true; navigation.dispatch(data.action); });
  });
  const close = () => router.back();

  const names = (except: string) => working.options.filter((option) => option.id !== except && !option.marked).map((option) => option.name);
  const issuesOf = (option: EditorOption): OptionIssues => savedOptionIssues(option, names(option.id));
  const cardIssues = optionIssues(card.name, card.slots, names(card.id));
  const cardPreview = editing === "new" && !hasIssues(cardIssues)
    ? addOption(working, { id: card.id, name: card.name.trim(), values: filled(card.slots).map((slot) => ({ id: slot.id, name: slot.text.trim() })), ...(card.existing ? { valueForExistingVariants: card.existing } : {}) })
    : null;
  const cardLimit = cardPreview && !cardPreview.success ? editFailureMessage(cardPreview.error, { draft: working, added: { name: card.name.trim(), values: filled(card.slots).length } }) : null;
  const blocked = working.options.some((option) => !option.marked && hasIssues(issuesOf(option))) || (editing === "new" && (hasIssues(cardIssues) || !!cardLimit)) ||
    Object.values(trailing).some((text) => text.trim());

  const commitCard = (): EditorDraft | null => {
    if (!cardPreview || !cardPreview.success) return null;
    setWorking(cardPreview.data);
    setEditing(null);
    setCard(blankOption());
    return cardPreview.data;
  };
  const apply = () => {
    const committed = editing === "new" ? commitCard() : working;
    if (!committed) return;
    const trimmed = committed.options.reduce((draft, option) => {
      const named = option.name === option.name.trim() ? draft : renameOption(draft, option.id, option.name.trim());
      return option.values.reduce((inner, value) => value.name === value.name.trim() ? inner : renameValue(inner, value.id, value.name.trim()), named);
    }, committed);
    editor.setDraft(trimmed);
    leaving.current = true;
    router.back();
  };

  const edit = (next: (draft: EditorDraft) => ReturnType<typeof addValue>, key: string, name?: string) => {
    const result = next(working);
    if (result.success) { setWorking(result.data); note(key, null); return true; }
    note(key, editFailureMessage(result.error, { draft: working, ...(name === undefined ? {} : { name }) }));
    return false;
  };

  const removeOptionAt = (option: EditorOption) => {
    if (!working.saved && working.options.filter((candidate) => !candidate.marked).length === 1) {
      showConfirmation({
        title: t("removeOptionsTitle"), description: t("removeOptionsDescription", { count: editorSummary(working).count }),
        confirmLabel: t("removeOptions"), cancelLabel: t("keepOptions"), destructive: true,
        onConfirm: () => { setWorking(clearOptions(working)); setEditing("new"); setCard(blankOption()); },
      });
      return;
    }
    if (edit((draft) => removeOption(draft, option.id), option.id, option.name)) setEditing(null);
  };

  // While the first option is being typed, the footer counts what Listo would create.
  const shown = cardPreview?.success ? cardPreview.data : working;
  const summary = editorSummary(shown);
  const created = orderedRows(shown).filter((row) => row.id === null && removalOf(shown, row) === null).length;
  const optionCount = working.options.length;
  const atMaximum = optionCount >= productOptionLimits.options;
  const original = (id: string) => (editor.baseline ?? initial).options.flatMap((option) => option.values).find((value) => value.id === id)?.name;

  return <ThemedView style={styles.page}><SafeAreaView edges={formEdges} style={styles.safe}>
    <ProductTopBar title={t("options")} onClose={close}>
      <Button onPress={apply} disabled={blocked}>{t("done")}</Button>
    </ProductTopBar>
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {working.options.map((option, index) => {
        if (option.marked) return <View key={option.id} style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <ThemedText style={styles.struck}>{option.name}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {option.saved ? t("optionWillBeDeleted", { name: option.name, kept: option.values[0]?.name ?? "" }) : t("optionWillBeRemoved", { name: option.name, kept: (option.valueForExistingVariants ? option.values.find((value) => value.id === option.valueForExistingVariants) : option.values.find((value) => !value.marked))?.name ?? "" })}
          </ThemedText>
          {editor.errors.options[option.id] ? <FieldError>{editor.errors.options[option.id]}</FieldError> : null}
          <Button variant="ghost" onPress={() => { clearRejection("options", option.id); setWorking(undoRemoveOption(working, option.id)); }}>{t("undo")}</Button>
        </View>;
        if (editing !== option.id) return <View key={option.id} style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <View style={styles.row}>
            <ReorderHandle name={option.name} position={index + 1} total={optionCount} onMove={(to) => setWorking(moveOption(working, option.id, to))} />
            <ThemedText type="smallBold" style={styles.grow}>{option.name}</ThemedText>
            <Button variant="ghost" onPress={() => setEditing(option.id)} accessibilityLabel={`${t("edit")} ${option.name}`}>{t("edit")}</Button>
          </View>
          <View style={styles.chips}>
            {option.values.filter((value) => !value.marked).map((value) => <View key={value.id} style={[styles.chip, { backgroundColor: theme.secondary }]}><ThemedText type="small">{value.name}</ThemedText></View>)}
          </View>
          {option.values.filter((value) => editor.errors.values[value.id]).map((value) => <FieldError key={value.id}>{editor.errors.values[value.id]}</FieldError>)}
          {editor.errors.options[option.id] ? <FieldError>{editor.errors.options[option.id]}</FieldError> : null}
        </View>;
        const issues = issuesOf(option);
        return <View key={option.id} style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <Field invalid={!!issues.name}>
            <FieldLabel>{t("optionName")}</FieldLabel>
            <Input value={option.name} onChangeText={(text) => { clearRejection("options", option.id); setWorking(renameOption(working, option.id, text)); }} accessibilityLabel={t("optionName")} />
            {issues.name ? <FieldError>{issues.name}</FieldError> : editor.errors.options[option.id] ? <FieldError>{editor.errors.options[option.id]}</FieldError> : null}
          </Field>
          <ThemedText type="small" style={styles.heading}>{t("optionValues")}</ThemedText>
          {option.values.map((value, position) => value.marked
            ? <View key={value.id} style={styles.marked}>
              <ThemedText style={styles.struck}>{value.name}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {option.saved && value.saved
                  ? t("valueWillBeDeleted", { name: value.name, count: working.rows.filter((row) => row.id !== null && row.combination[option.id] === value.id).length })
                  : t("valueWillBeRemoved", { name: value.name })}
              </ThemedText>
              {editor.errors.values[value.id] ? <FieldError>{editor.errors.values[value.id]}</FieldError> : null}
              <Button variant="ghost" onPress={() => { clearRejection("values", value.id); setWorking(undoRemoveValue(working, value.id)); }}>{t("undo")}</Button>
            </View>
            : <ValueRow key={aliases[value.id] ?? value.id} name={value.name} position={position + 1} total={option.values.length}
              error={issues.values[value.id] ?? (notes[value.id] || editor.errors.values[value.id] || undefined)}
              before={value.saved && original(value.id) !== undefined && original(value.id) !== value.name ? t("valueRenamedFrom", { name: original(value.id) }) : undefined}
              onChange={(text) => { clearRejection("values", value.id); setWorking(renameValue(working, value.id, text)); }}
              onMove={(to) => setWorking(moveValue(working, option.id, value.id, to))}
              onRemove={() => edit((draft) => removeValue(draft, value.id), value.id, value.name)} />)}
          <ValueRow key={trailingKey(option.id)} name={trailing[option.id] ?? ""} position={0} total={0} placeholder={t("addAnotherValue")}
            error={notes[`${option.id}:new`] || undefined}
            onChange={(text) => {
              if (!text.trim()) { setTrailing({ ...trailing, [option.id]: text }); note(`${option.id}:new`, null); return; }
              const id = newId();
              const result = addValue(working, option.id, { id, name: text });
              if (result.success) {
                setWorking(result.data);
                setAliases({ ...aliases, [id]: trailingKey(option.id) });
                setSerial({ ...serial, [option.id]: (serial[option.id] ?? 0) + 1 });
                setTrailing({ ...trailing, [option.id]: "" });
                note(`${option.id}:new`, null);
              } else {
                setTrailing({ ...trailing, [option.id]: text });
                note(`${option.id}:new`, editFailureMessage(result.error, { draft: working }));
              }
            }} />
          {issues.general ? <FieldError>{issues.general}</FieldError> : null}
          {!option.saved && working.saved && option.valueForExistingVariants !== null
            ? <ExistingValue option={option} count={working.rows.filter((row) => row.id !== null).length} onChange={(valueId) => edit((draft) => setValueForExistingVariants(draft, option.id, valueId), option.id)} /> : null}
          {notes[option.id] ? <FieldError>{notes[option.id]}</FieldError> : null}
          <View style={styles.actions}>
            <Button variant="ghost" onPress={() => removeOptionAt(option)}>{t("deleteOption")}</Button>
            <Button onPress={() => setEditing(null)} disabled={hasIssues(issues) || !!trailing[option.id]?.trim()}>{t("done")}</Button>
          </View>
        </View>;
      })}
      {editing === "new" ? <View style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
        <Field invalid={!!cardIssues.name && !!card.name}>
          <FieldLabel>{t("optionName")}</FieldLabel>
          <Input value={card.name} onChangeText={(text) => setCard({ ...card, name: text })} accessibilityLabel={t("optionName")} />
          {cardIssues.name && card.name ? <FieldError>{cardIssues.name}</FieldError> : null}
        </Field>
        <ThemedText type="small" style={styles.heading}>{t("optionValues")}</ThemedText>
        {card.slots.map((slot, position) => <ValueRow key={slot.id} name={slot.text} position={position + 1} total={card.slots.length - 1}
          placeholder={position === card.slots.length - 1 ? t("addAnotherValue") : undefined}
          error={cardIssues.values[slot.id]} isTrailing={position === card.slots.length - 1}
          onChange={(text) => setCard({ ...card, slots: card.slots.map((candidate) => candidate.id === slot.id ? { ...candidate, text } : candidate).concat(position === card.slots.length - 1 && text.trim() ? [{ id: newId(), text: "" }] : []) })}
          onMove={(to) => setCard({ ...card, slots: moveSlot(card.slots, position, to) })}
          onRemove={() => setCard({ ...card, slots: card.slots.filter((candidate) => candidate.id !== slot.id) })} />)}
        {card.name && cardIssues.general ? <FieldError>{cardIssues.general}</FieldError> : null}
        {cardLimit ? <FieldError>{cardLimit}</FieldError> : null}
        {working.saved && working.rows.some((row) => row.id !== null) && filled(card.slots).length > 0 ? <ExistingValue
          option={{ id: card.id, name: card.name.trim(), saved: false, marked: false, valueForExistingVariants: card.existing ?? filled(card.slots)[0].id, values: filled(card.slots).map((slot) => ({ id: slot.id, name: slot.text.trim(), saved: false, marked: false })) }}
          count={working.rows.filter((row) => row.id !== null).length} onChange={(valueId) => setCard({ ...card, existing: valueId })} /> : null}
        <View style={styles.actions}>
          <Button variant="ghost" onPress={() => { setEditing(null); setCard(blankOption()); }}>{t("deleteOption")}</Button>
          <Button onPress={() => { commitCard(); }} disabled={hasIssues(cardIssues) || !!cardLimit}>{t("done")}</Button>
        </View>
      </View> : atMaximum ? <ThemedText type="small" themeColor="textSecondary" style={styles.center}>{t("maxOptionsReached")}</ThemedText>
        : <Button variant="secondary" onPress={() => { setEditing("new"); setCard(blankOption()); }}>{t("addAnotherOption")}</Button>}
      <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
        {working.saved ? t("optionsFooterSaved", { count: created, total: summary.count, max: productOptionLimits.variants })
          : t("optionsFooterNew", { count: summary.count, max: productOptionLimits.variants })}
      </ThemedText>
    </ScrollView>
  </SafeAreaView></ThemedView>;
}

function moveSlot(slots: readonly Slot[], from: number, to: number): readonly Slot[] {
  const filledSlots = slots.slice(0, -1);
  const rest = filledSlots.filter((_, index) => index !== from);
  rest.splice(Math.max(0, Math.min(to, rest.length)), 0, filledSlots[from]);
  return [...rest, slots[slots.length - 1]];
}

function ExistingValue({ option, count, onChange }: { option: EditorOption; count: number; onChange: (valueId: string) => void }) {
  const { t } = useTranslation();
  const chosen = option.valueForExistingVariants;
  const others = option.values.filter((value) => value.id !== chosen).map((value) => value.name).join(", ");
  return <View style={styles.existing}>
    <Field>
      <FieldLabel>{t("valueForExisting", { name: option.name, count })}</FieldLabel>
      <OptionSelector options={option.values.map((value) => ({ value: value.id, label: value.name }))} value={chosen} onValueChange={(value) => value && onChange(value)} />
    </Field>
    <ThemedText type="small" themeColor="textSecondary">{t("existingKeepHint", { others })}</ThemedText>
  </View>;
}

function ValueRow({ name, position, total, placeholder, error, before, isTrailing = false, onChange, onMove, onRemove }: {
  name: string;
  /** 1-based; 0 for the field that adds a value. */
  position: number;
  total: number;
  placeholder?: string;
  error?: string | undefined;
  before?: string | undefined;
  isTrailing?: boolean;
  onChange: (text: string) => void;
  onMove?: (to: number) => void;
  onRemove?: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const adding = position === 0 || isTrailing;
  return <View style={styles.valueRow}>
    <View style={styles.row}>
      {adding || !onMove ? <View style={styles.handleSpace} /> : <ReorderHandle name={name || t("optionValues")} position={position} total={total} onMove={onMove} />}
      <View style={styles.grow}>
        <Input value={name} onChangeText={onChange} placeholder={placeholder} accessibilityLabel={placeholder ?? name} />
      </View>
      {adding || !onRemove ? <View style={styles.handleSpace} /> : <Pressable accessibilityRole="button" accessibilityLabel={t("deleteValue", { name })} onPress={onRemove}
        style={({ pressed }) => [styles.handleSpace, styles.center, { backgroundColor: pressed ? theme.accent : "transparent", borderRadius: tokens.sizing.touchTargetMinSize / 2 }]}>
        <SymbolView name={{ ios: "trash", android: "delete" }} size={tokens.sizing.iconAction} tintColor={theme.textSecondary} />
      </Pressable>}
    </View>
    {before ? <ThemedText type="small" themeColor="textSecondary" style={styles.indent}>{before}</ThemedText> : null}
    {error ? <ThemedText type="small" accessibilityRole="alert" style={[styles.indent, { color: theme.error }]}>{error}</ThemedText> : null}
  </View>;
}

const styles = StyleSheet.create({
  page: { flex: 1 }, safe: { flex: 1 }, scroll: { flex: 1 },
  content: { gap: tokens.spacing["3"], padding: tokens.spacing["4"], paddingBottom: tokens.spacing["8"] },
  card: { borderWidth: tokens.sizing.borderWidth, borderRadius: tokens.radius.card, padding: tokens.spacing["4"], gap: tokens.spacing["3"] },
  row: { flexDirection: "row", alignItems: "center", gap: tokens.spacing["1"] },
  grow: { flex: 1, minWidth: 0 },
  heading: { fontWeight: 600 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing["2"] },
  chip: { borderRadius: tokens.radius.control, paddingHorizontal: tokens.spacing["3"], paddingVertical: tokens.spacing["1"] },
  struck: { textDecorationLine: "line-through" },
  marked: { gap: tokens.spacing["1"], paddingLeft: tokens.sizing.touchTargetMinSize },
  valueRow: { gap: tokens.spacing["1"] },
  handleSpace: { width: tokens.sizing.touchTargetMinSize, height: tokens.sizing.touchTargetMinSize },
  indent: { paddingLeft: tokens.sizing.touchTargetMinSize },
  center: { alignItems: "center", justifyContent: "center", textAlign: "center" },
  actions: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: tokens.spacing["3"] },
  existing: { gap: tokens.spacing["2"] },
});
