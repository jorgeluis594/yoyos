/** @jsxImportSource react */
// Preserve native Pressable style callbacks outside NativeWind interop.
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, findNodeHandle, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { combinationLabel, type EditorRow } from "@shared/product-variants";
import type { Result } from "@shared/result";
import { Button } from "@mobile/components/ui/button";
import { Field, FieldError, FieldLabel } from "@mobile/components/ui/field";
import { Input } from "@mobile/components/ui/input";
import { QuantityStepper } from "@mobile/components/ui/quantity-stepper";
import { showConfirmation } from "@mobile/components/ui/show-confirmation";
import { ThemedText } from "@mobile/components/themed-text";
import { useTheme } from "@mobile/hooks/use-theme";
import { variants } from "@mobile/features/products/composition";
import type { CopyCount } from "@mobile/features/printing/composition";
import type { VariantActionError, VariantPatch } from "../application/variant-operations";
import type { Product, VariantId } from "../domain/product";
import { uncertainCodes } from "./product-form-state";
import { ProductPrintSheet, useStartProductPrint } from "./product-print-sheet";
import { useProductEditor } from "./product-editor-state";
import { VariantQr } from "./variant-qr";
import { variantIssueText, type VariantIssueField } from "./variant-row-issues";
import { isOnline } from "./is-online";
import tokens from "../../../../../../docs/design-tokens.json";

/** What the seller typed in a saved row, as text. */
export type VariantForm = Readonly<{ salePrice: string; purchasePrice: string; stock: string; sku: string }>;
type Busy = "save" | "deactivate" | "activate" | "delete" | null;
type Notice = Readonly<{ text: string; error: boolean }>;
type FieldErrors = Partial<Record<VariantIssueField, string>>;

const money = (amount: number | null) => amount === null ? "" : amount.toFixed(2);
/** The fields as the row shows them: pending product edits included. */
export const formOf = (row: Pick<EditorRow, "salePrice" | "purchasePrice" | "stock" | "sku">): VariantForm =>
  ({ salePrice: money(row.salePrice), purchasePrice: money(row.purchasePrice), stock: String(row.stock), sku: row.sku ?? "" });
export const sameForm = (a: VariantForm, b: VariantForm) => a.salePrice === b.salePrice && a.purchasePrice === b.purchasePrice && a.stock === b.stock && a.sku === b.sku;

const maxAmount = 999_999_999.99;
const decimals = (text: string) => (text.trim().split(".")[1] ?? "").length;
const amountOf = (text: string) => /^\d+(?:\.\d+)?$/.test(text.trim()) ? Number(text) : null;

/** The patch of what differs from what Yoyos last answered, or the field texts that stop it before sending. */
function patchOf(form: VariantForm, original: NonNullable<EditorRow["original"]>, t: (key: string, options?: Record<string, unknown>) => string):
  Readonly<{ patch: VariantPatch; errors: FieldErrors }> {
  const sale = amountOf(form.salePrice);
  const purchase = form.purchasePrice.trim() ? amountOf(form.purchasePrice) : null;
  const stock = /^\d+$/.test(form.stock.trim()) && Number.isSafeInteger(Number(form.stock)) ? Number(form.stock) : null;
  const errors: FieldErrors = {
    ...(sale === null || sale <= 0 || sale > maxAmount ? { salePrice: t("salePriceInvalid") } : decimals(form.salePrice) > 2 ? { salePrice: t("maxTwoDecimals") } : {}),
    ...(form.purchasePrice.trim() && (purchase === null || purchase > maxAmount) ? { purchasePrice: t("purchasePriceInvalid") } : decimals(form.purchasePrice) > 2 ? { purchasePrice: t("maxTwoDecimals") } : {}),
    ...(stock === null ? { stock: t("initialStockInvalid") } : {}),
    ...(form.sku.trim().length > 100 ? { sku: t("maxCharacters", { count: 100 }) } : {}),
  };
  const sku = form.sku.trim() || null;
  const patch: VariantPatch = {
    ...(sku !== original.sku ? { sku } : {}),
    ...(sale !== null && sale !== original.salePrice ? { salePrice: sale } : {}),
    ...(form.purchasePrice.trim() === "" ? original.purchasePrice !== null ? { purchasePrice: null } : {} : purchase !== null && purchase !== original.purchasePrice ? { purchasePrice: purchase } : {}),
    ...(stock !== null && stock !== original.stock ? { stock } : {}),
  };
  return { patch, errors };
}

/** Moves the screen reader, not the keyboard, to a node. */
export function announceFocus(node: unknown) {
  const handle = node ? findNodeHandle(node as never) : null;
  if (handle) AccessibilityInfo.setAccessibilityFocus(handle);
}

type Props = Readonly<{
  product: Product;
  row: EditorRow & Readonly<{ id: string; original: NonNullable<EditorRow["original"]> }>;
  form: VariantForm;
  onChange: (form: VariantForm) => void;
  /** The row has typed values that differ from what it showed when opened. */
  typed: boolean;
  /** The product has edits waiting for its own Guardar. */
  pendingEdits: boolean;
  onBusy: (busy: boolean) => void;
  onCancel: () => void;
  onSaved: () => void;
  onDeleted: () => void;
  onReload: () => void;
}>;

/** The expanded saved row: its fields, and the actions that act on the server at once. Only one is mounted at a time. */
export function VariantRowEditor({ product, row, form, onChange, typed, pendingEdits, onBusy, onCancel, onSaved, onDeleted, onReload }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const editor = useProductEditor();
  const startPrint = useStartProductPrint();
  const [busy, setBusy] = useState<Busy>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [blockedDelete, setBlockedDelete] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const [printing, setPrinting] = useState(false);
  // `busy` only changes after the connection check, so it cannot stop a second tap that arrives during it.
  const acting = useRef(false);
  const firstField = useRef<View>(null);
  useEffect(() => { announceFocus(firstField.current); }, []);

  const variantId = row.id as VariantId;
  const title = combinationLabel(product.options, row.combination) || t("numberedVariant", { count: 1 });
  const inactive = row.status === "inactive";
  const working = busy !== null;
  const differs = !sameForm(form, formOf(row.original));
  const rowError = editor.errors.rows[row.ref];
  const edit = (field: keyof VariantForm, value: string) => {
    onChange({ ...form, [field]: value });
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
  };

  const deleteReason = row.hasOrders ? t("deleteBlockedOrders")
    : row.original.stock > 0 ? t("deleteBlockedStock", { count: row.original.stock })
      : product.variants.length === 1 ? t("deleteBlockedLast") : null;
  const lostValues = product.options.flatMap((option, position) => {
    const valueId = product.variants.find((candidate) => candidate.id === row.id)?.combination[position]?.valueId;
    const shared = product.variants.some((other) => other.id !== row.id && other.combination[position]?.valueId === valueId);
    const value = option.values.find((candidate) => candidate.id === valueId);
    return shared || !value ? [] : [t("lostValueNotice", { value: value.name, option: option.name })];
  });

  /** Runs one request after the connection check. A lost answer is never shown as success. */
  const run = async (kind: Exclude<Busy, null>, request: () => Promise<Result<Product, VariantActionError>>,
    messages: Readonly<{ offline: string; uncertain: string }>, handle: (error: VariantActionError) => boolean, done: (next: Product) => void) => {
    if (acting.current) return;
    acting.current = true;
    setNotice(null);
    if (!await isOnline()) { acting.current = false; setNotice({ text: messages.offline, error: true }); return; }
    setBusy(kind); onBusy(true);
    const result = await request().finally(() => { acting.current = false; setBusy(null); onBusy(false); });
    if (result.success) { done(result.data); return; }
    const code = result.error.code;
    if (code === "PRODUCT_NOT_FOUND" || code === "VARIANT_NOT_FOUND") { setGone(true); return; }
    if (handle(result.error)) return;
    setNotice({ text: uncertainCodes.includes(code) ? messages.uncertain : t("variantActionError"), error: true });
  };

  const save = () => {
    const { patch, errors } = patchOf(form, row.original, t);
    if (Object.keys(errors).length) { setFieldErrors(errors); return; }
    setFieldErrors({});
    void run("save", () => variants.updateVariant(product.id, variantId, patch),
      { offline: t("variantSaveOffline"), uncertain: t("variantSaveUncertain") },
      (error) => {
        if (!["VALIDATION_ERROR", "INVALID_INPUT", "DUPLICATE_SKU"].includes(error.code)) return false;
        const mapped = variantIssueText(error, t);
        const next: FieldErrors = {};
        for (const issue of mapped) if (issue.kind === "field") next[issue.field] = issue.text;
        setFieldErrors(next);
        const top = mapped.find((issue) => issue.kind === "form");
        if (top) setNotice({ text: top.text, error: true });
        return true;
      },
      (next) => { editor.adoptVariant(next, row.id); setFieldErrors({}); onSaved(); setNotice({ text: t("variantSaved"), error: false }); });
  };

  const changeStatus = (status: "active" | "inactive") => {
    const verb = status === "inactive" ? t("deactivateVerb") : t("activateVerb");
    void run(status === "inactive" ? "deactivate" : "activate", () => variants.changeStatus(product.id, variantId, status),
      { offline: t("variantActionOffline", { action: verb }), uncertain: t("variantActionUncertain") }, () => false,
      (next) => { editor.adoptVariant(next, row.id); setNotice({ text: status === "inactive" ? t("variantDeactivated") : t("variantActivated"), error: false }); });
  };
  const confirmDeactivate = () => {
    const last = product.variants.filter((other) => other.status === "active").length === 1 && !inactive;
    showConfirmation({
      title: t("deactivateTitle", { name: title }),
      description: [t("deactivateBody"), row.original.stock > 0 ? t("deactivateStock", { count: row.original.stock }) : null, last ? t("deactivateLast") : null].filter(Boolean).join(" "),
      confirmLabel: t("deactivateConfirm"), cancelLabel: t("cancel"), destructive: false, onConfirm: () => changeStatus("inactive"),
    });
  };
  const remove = () => void run("delete", () => variants.deleteVariant(product.id, variantId),
    { offline: t("variantActionOffline", { action: t("deleteVerb") }), uncertain: t("variantActionUncertain") },
    (error) => {
      if (error.code === "VARIANT_HAS_ORDERS") { setBlockedDelete(t("deleteRejectedOrders")); return true; }
      if (error.code === "VARIANT_HAS_STOCK") { setBlockedDelete(t("deleteRejectedStock")); return true; }
      if (error.code === "LAST_VARIANT") { setBlockedDelete(t("deleteBlockedLast")); return true; }
      return false;
    },
    (next) => { editor.removeVariant(next, row.id); onDeleted(); });
  const confirmDelete = () => showConfirmation({
    title: t("deleteTitle", { name: title }), description: [t("deleteBody"), ...lostValues].join(" "),
    confirmLabel: t("deleteVariant"), cancelLabel: t("keepVariant"), destructive: true, onConfirm: remove,
  });

  const printVariant = (id: VariantId, copies: CopyCount) => { startPrint(product, id, copies); setPrinting(false); };
  const reason = blockedDelete ?? deleteReason ?? (pendingEdits ? t("deleteNeedsSavedProduct") : null);

  if (gone) return <View style={styles.editor}>
    <ThemedText type="small" accessibilityRole="alert" style={{ color: theme.error }}>{t("variantGone")}</ThemedText>
    <Button variant="secondary" onPress={onReload}>{t("reloadProduct")}</Button>
  </View>;

  return <View style={[styles.editor, { borderTopColor: theme.border }]}>
    {inactive ? <View style={[styles.notice, { backgroundColor: theme.warningSurface }]}><ThemedText type="small" style={{ color: theme.warning }}>{t("variantInactiveNotice")}</ThemedText></View> : null}
    {rowError ? <ThemedText type="small" accessibilityRole="alert" style={{ color: theme.error }}>{rowError}</ThemedText> : null}
    {notice ? <ThemedText type="small" accessibilityRole="alert" accessibilityLiveRegion="polite" style={notice.error ? { color: theme.error } : undefined}>{notice.text}</ThemedText> : null}
    <Field required invalid={!!fieldErrors.salePrice} disabled={working}>
      <FieldLabel>{t("salePrice")}</FieldLabel>
      <View ref={firstField} accessible={false}><Input value={form.salePrice} onChangeText={(value) => edit("salePrice", value)} keyboardType="decimal-pad" placeholder="0.00" accessibilityLabel={t("salePrice")} /></View>
      {fieldErrors.salePrice ? <FieldError>{fieldErrors.salePrice}</FieldError> : null}
    </Field>
    <Field invalid={!!fieldErrors.purchasePrice} disabled={working}>
      <FieldLabel>{t("purchasePrice")}</FieldLabel>
      <Input value={form.purchasePrice} onChangeText={(value) => edit("purchasePrice", value)} keyboardType="decimal-pad" placeholder="0.00" accessibilityLabel={t("purchasePrice")} />
      {fieldErrors.purchasePrice ? <FieldError>{fieldErrors.purchasePrice}</FieldError> : null}
    </Field>
    <Field invalid={!!fieldErrors.stock} disabled={working}>
      <FieldLabel>{t("stock")}</FieldLabel>
      <QuantityStepper value={form.stock} onChange={(value) => edit("stock", value)} disabled={working} accessibilityLabel={t("stock")} decreaseLabel={t("decreaseStock")} increaseLabel={t("increaseStock")} />
      {fieldErrors.stock ? <FieldError>{fieldErrors.stock}</FieldError> : null}
    </Field>
    <Field invalid={!!fieldErrors.sku} disabled={working}>
      <FieldLabel>SKU</FieldLabel>
      <Input value={form.sku} onChangeText={(value) => edit("sku", value)} maxLength={100} placeholder={t("optional")} accessibilityLabel={t("optionalSku")} autoCapitalize="characters" />
      {fieldErrors.sku ? <FieldError>{fieldErrors.sku}</FieldError> : null}
    </Field>
    <Button onPress={save} disabled={working || !differs}>{busy === "save" ? t("variantSaving") : t("saveVariant")}</Button>
    <Button variant="secondary" onPress={onCancel} disabled={working}>{t("cancel")}</Button>
    <View style={styles.qr}>
      <VariantQr value={product.variants.find((candidate) => candidate.id === row.id)?.qrCode ?? row.id} label={t("variantQrHeading")} />
      <View style={styles.qrText}>
        <ThemedText type="small" themeColor="textSecondary">{t("variantQrHelp")}</ThemedText>
        <Button variant="secondary" onPress={() => setPrinting(true)} disabled={working}>{t("printLabel")}</Button>
      </View>
    </View>
    {inactive
      ? <Button variant="secondary" onPress={() => changeStatus("active")} disabled={working}>{busy === "activate" ? t("activatingVariant") : t("activateVariant")}</Button>
      : <Button variant="destructive" onPress={confirmDeactivate} disabled={working}>{busy === "deactivate" ? t("deactivatingVariant") : t("deactivateVariant")}</Button>}
    {reason ? <ThemedText type="small" themeColor="textSecondary" style={styles.reason}>{reason}</ThemedText>
      : <Button variant="destructive" onPress={confirmDelete} disabled={working}>{busy === "delete" ? t("deletingVariant") : t("deleteVariant")}</Button>}
    {printing ? <ProductPrintSheet visible product={product} initialVariantId={variantId} unsavedChanges={typed || pendingEdits} onClose={() => setPrinting(false)} onPrint={printVariant} /> : null}
  </View>;
}

const styles = StyleSheet.create({
  editor: { gap: tokens.spacing["3"], paddingHorizontal: tokens.spacing["3"], paddingVertical: tokens.spacing["3"] },
  notice: { borderRadius: tokens.radius.control, padding: tokens.spacing["3"] },
  qr: { flexDirection: "row", gap: tokens.spacing["4"], alignItems: "flex-start" },
  qrText: { flex: 1, minWidth: 0, gap: tokens.spacing["3"] },
  reason: { textAlign: "center" },
});
