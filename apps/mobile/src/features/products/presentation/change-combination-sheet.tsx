/** @jsxImportSource react */
// Preserve native Pressable style callbacks outside NativeWind interop.
import { useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SymbolView } from "expo-symbols";
import * as Crypto from "expo-crypto";
import { useTranslation } from "react-i18next";
import { combinationLabel } from "@shared/product-variants";
import type { ChangeCombinationRequest } from "@shared/contracts/products";
import { Button } from "@mobile/components/ui/button";
import { Field, FieldError, FieldLabel } from "@mobile/components/ui/field";
import { Input } from "@mobile/components/ui/input";
import { ThemedText } from "@mobile/components/themed-text";
import { useTheme } from "@mobile/hooks/use-theme";
import type { Product, ProductVariant } from "../domain/product";
import tokens from "../../../../../../docs/design-tokens.json";

const NEW = "__new__";
const maxValues = 30;
const maxName = 30;
const normalized = (name: string) => name.trim().toLocaleLowerCase();

type Props = Readonly<{
  product: Product;
  variant: ProductVariant;
  busy: boolean;
  /** The last rejection of the request, shown with the selection intact. */
  error: string | null;
  /** The answer was lost: the sheet offers the reload instead of another try. */
  uncertain: boolean;
  onReload: () => void;
  onClose: () => void;
  onSubmit: (values: ChangeCombinationRequest["values"]) => void;
}>;

/** One selector per option with its values and «Otro valor…», which opens a text field for a value that does not exist yet. */
export function ChangeCombinationSheet({ product, variant, busy, error, uncertain, onReload, onClose, onSubmit }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const current = Object.fromEntries(variant.combination.map((entry) => [entry.optionId, entry.valueId as string]));
  const [selection, setSelection] = useState<Record<string, string>>(current);
  const [names, setNames] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  // A retry after a lost answer must repeat the same new value id, so core sees the same value and does nothing twice.
  const newIds = useRef<Record<string, string>>({});
  const idFor = (optionId: string) => (newIds.current[optionId] ??= Crypto.randomUUID());
  const title = combinationLabel(product.options, variant.combination);
  const name = (optionId: string, valueId: string) => product.options.find((option) => option.id === optionId)?.values.find((value) => value.id === valueId)?.name ?? "";

  const issueOf = (optionId: string): string | null => {
    if (selection[optionId] !== NEW) return null;
    const option = product.options.find((candidate) => candidate.id === optionId);
    const typed = (names[optionId] ?? "").trim();
    if (!typed) return t("valueNameRequired");
    if ([...typed].length > maxName) return t("valueNameTooLong");
    if (option?.values.some((value) => normalized(value.name) === normalized(typed))) return t("valueAlreadyInOption", { name: typed });
    if ((option?.values.length ?? 0) >= maxValues) return t("maxValuesPerOption");
    return null;
  };
  const removedValues = product.options.flatMap((option) => {
    const was = current[option.id];
    if (!was || selection[option.id] === was) return [];
    const stillUsed = product.variants.some((other) => other.id !== variant.id && other.combination.some((entry) => entry.valueId === was));
    return stillUsed ? [] : [t("lostValueNotice", { value: name(option.id, was), option: option.name })];
  });

  const submit = () => {
    const first = product.options.map((option) => issueOf(option.id)).find((issue) => issue !== null) ?? null;
    if (first) { setProblem(first); return; }
    if (product.options.every((option) => selection[option.id] === current[option.id])) { onClose(); return; }
    const existing = product.options.every((option) => selection[option.id] !== NEW);
    const clash = existing ? product.variants.find((other) => other.id !== variant.id
      && product.options.every((option) => other.combination.some((entry) => entry.optionId === option.id && entry.valueId === selection[option.id]))) : undefined;
    if (clash) { setProblem(t("combinationExists", { name: combinationLabel(product.options, clash.combination) })); return; }
    setProblem(null);
    onSubmit(product.options.map((option) => selection[option.id] === NEW
      ? { optionId: option.id, newValue: { id: idFor(option.id), name: (names[option.id] ?? "").trim() } }
      : { optionId: option.id, valueId: selection[option.id] ?? current[option.id] ?? "" }));
  };
  const shown = problem ?? error;

  return <Modal visible transparent animationType="slide" onRequestClose={busy ? () => {} : onClose}>
    <View style={styles.scrim}>
      <Pressable accessibilityRole="button" accessibilityLabel={t("close")} style={styles.dismiss} disabled={busy} onPress={onClose} />
      <SafeAreaView edges={["bottom"]} style={[styles.sheet, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
        <ThemedText type="subtitle" accessibilityRole="header" style={styles.title}>{t("changeCombinationTitle", { name: title })}</ThemedText>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {product.options.map((option) => {
            const issue = problem && selection[option.id] === NEW ? issueOf(option.id) : null;
            return <View key={option.id} style={styles.group} accessibilityRole="radiogroup" accessibilityLabel={option.name}>
              <ThemedText type="small" style={styles.heading}>{option.name}</ThemedText>
              {[...option.values.map((value) => ({ id: value.id as string, label: value.name })), { id: NEW, label: t("otherValue") }].map((choice) => {
                const checked = selection[option.id] === choice.id;
                return <Pressable key={choice.id} accessibilityRole="radio" accessibilityLabel={`${option.name}: ${choice.label}`} accessibilityState={{ checked, disabled: busy }} disabled={busy}
                  onPress={() => { setSelection({ ...selection, [option.id]: choice.id }); setProblem(null); }}
                  style={[styles.choice, { borderColor: checked ? theme.ring : theme.border, backgroundColor: checked ? theme.accent : "transparent" }]}>
                  <ThemedText type="small" style={styles.grow}>{choice.label}</ThemedText>
                  {checked ? <SymbolView name={{ ios: "checkmark", android: "check" }} size={tokens.sizing.iconAction} tintColor={theme.primary} /> : null}
                </Pressable>;
              })}
              {selection[option.id] === NEW ? <Field invalid={!!issue}>
                <FieldLabel>{t("newValueOf", { option: option.name })}</FieldLabel>
                <Input value={names[option.id] ?? ""} onChangeText={(text) => { setNames({ ...names, [option.id]: text }); setProblem(null); }} editable={!busy}
                  accessibilityLabel={t("newValueOf", { option: option.name })} maxLength={maxName * 2} />
                {issue ? <FieldError>{issue}</FieldError> : null}
              </Field> : null}
            </View>;
          })}
          <ThemedText type="small" themeColor="textSecondary">{t("combinationHelp", { name: title })}</ThemedText>
          {removedValues.map((text) => <ThemedText key={text} type="small" themeColor="textSecondary">{text}</ThemedText>)}
          {shown ? <ThemedText type="small" accessibilityRole="alert" style={{ color: theme.error }}>{shown}</ThemedText> : null}
        </ScrollView>
        <View style={styles.actions}>
          {uncertain ? <Button variant="secondary" onPress={onReload} disabled={busy}>{t("reloadVariant")}</Button>
            : <Button onPress={submit} disabled={busy}>{busy ? t("variantSaving") : t("saveCombination")}</Button>}
          <Button variant="secondary" onPress={onClose} disabled={busy}>{t("cancel")}</Button>
        </View>
      </SafeAreaView>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0, 0, 0, 0.5)" },
  dismiss: { flex: 1 },
  sheet: { maxHeight: "85%", gap: tokens.spacing["3"], padding: tokens.spacing["4"], borderTopLeftRadius: tokens.radius.overlay, borderTopRightRadius: tokens.radius.overlay, borderWidth: tokens.sizing.borderWidth, borderBottomWidth: 0 },
  title: { flexShrink: 0 },
  body: { gap: tokens.spacing["4"] },
  group: { gap: tokens.spacing["2"] },
  heading: { fontWeight: 600 },
  grow: { flex: 1 },
  choice: { minHeight: tokens.sizing.touchTargetMinSize, flexDirection: "row", alignItems: "center", gap: tokens.spacing["3"], borderWidth: tokens.sizing.borderWidth, borderRadius: tokens.radius.card, paddingHorizontal: tokens.spacing["3"] },
  actions: { gap: tokens.spacing["2"] },
});
