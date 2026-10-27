/** @jsxImportSource react */
// Preserve native Pressable style callbacks outside NativeWind interop.
import { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import * as Network from "expo-network";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { SafeAreaView } from "react-native-safe-area-context";
import { combinationLabel } from "@shared/product-variants";
import type { Result } from "@shared/result";
import type { ChangeCombinationRequest } from "@shared/contracts/products";
import { ScreenState } from "@/components/ui/screen-state";
import { Button } from "@mobile/components/ui/button";
import { Field, FieldError, FieldLabel } from "@mobile/components/ui/field";
import { Input } from "@mobile/components/ui/input";
import { showConfirmation } from "@mobile/components/ui/show-confirmation";
import { ThemedText } from "@mobile/components/themed-text";
import { ThemedView } from "@mobile/components/themed-view";
import { useTheme } from "@mobile/hooks/use-theme";
import { products, variants } from "@mobile/features/products/composition";
import type { CopyCount } from "@mobile/features/printing/composition";
import type { VariantActionCode, VariantActionError } from "../application/variant-operations";
import type { Product, ProductId, ProductVariant, VariantId } from "../domain/product";
import { ChangeCombinationSheet } from "./change-combination-sheet";
import { formEdges } from "./form-edges";
import { ProductPrintSheet, useStartProductPrint } from "./product-print-sheet";
import { ProductTopBar } from "./product-top-bar";
import { useProductEditor } from "./product-editor-state";
import { useProductNavigationGuard } from "./use-product-navigation-guard";
import { VariantQr } from "./variant-qr";
import tokens from "../../../../../../docs/design-tokens.json";

type Busy = "save" | "deactivate" | "activate" | "delete" | "combination" | null;
type Gone = "product" | "products";
/** The request may have reached core: the outcome is unknown until the variant is reloaded. */
const uncertainCodes: readonly VariantActionCode[] = ["NETWORK_ERROR", "SERVER_ERROR", "SERVICE_UNAVAILABLE", "INVALID_RESPONSE"];
const decimals = (text: string) => (text.trim().split(".")[1] ?? "").length;
const amountOf = (text: string) => /^\d+(?:\.\d+)?$/.test(text.trim()) ? Number(text) : null;

async function isOnline() {
  const state = await Network.getNetworkStateAsync().catch(() => null);
  return state?.isConnected !== false && state?.isInternetReachable !== false;
}

export default function VariantDetailScreen() {
  const { productId, variantId } = useLocalSearchParams<{ productId: string; variantId: string }>();
  return <VariantDetailLoader key={`${productId}/${variantId}`} productId={productId as ProductId} variantId={variantId as VariantId} />;
}

/** Reuses the detail the product screen already loaded; only a direct open, or «Reintentar», reads it. */
function VariantDetailLoader({ productId, variantId }: { productId: ProductId; variantId: VariantId }) {
  const router = useRouter();
  const { t } = useTranslation();
  const editor = useProductEditor();
  const [product, setProduct] = useState<Product | null>(editor.detail?.id === productId ? editor.detail : null);
  const [failed, setFailed] = useState(false);
  const [gone, setGone] = useState<Gone | null>(null);
  const [attempt, setAttempt] = useState(0);
  const { publish } = editor;
  const loaded = product !== null;

  useEffect(() => {
    if (loaded) return;
    let active = true;
    void products.loadProduct(productId).then((result) => {
      if (!active) return;
      if (result.success) { setProduct(result.data); publish(result.data); setFailed(false); }
      else if (result.error.code === "PRODUCT_NOT_FOUND") setGone("products");
      else setFailed(true);
    });
    return () => { active = false; };
  }, [productId, attempt, loaded, publish]);

  const simple = product !== null && product.options.length === 0;
  useEffect(() => {
    if (simple) router.replace({ pathname: "/products/[productId]", params: { productId } });
  }, [simple, router, productId]);

  const toProduct = () => router.dismissTo({ pathname: "/products/[productId]", params: { productId } });
  const toProducts = () => router.dismissTo("/products");
  const bar = <ProductTopBar title={t("variantOptionsHeading")} onClose={() => router.back()} back />;
  const frame = (body: React.ReactNode) => <ThemedView style={styles.page}><SafeAreaView edges={formEdges} style={styles.safe}>{bar}{body}</SafeAreaView></ThemedView>;
  const variant = product?.variants.find((candidate) => candidate.id === variantId);

  if (gone === "products") return frame(<ScreenState status="error" title={t("variantGone")} action={<Button onPress={toProducts}>{t("backToProducts")}</Button>} />);
  if (failed) return frame(<ScreenState status="error" title={t("variantLoadError")} onRetry={() => { setFailed(false); setAttempt((value) => value + 1); }} />);
  if (!product || simple) return frame(<ScreenState status="loading" title={t("variantLoading")} />);
  if (gone === "product" || !variant) return frame(<ScreenState status="error" title={t("variantGone")} action={<Button onPress={toProduct}>{t("backToProduct")}</Button>} />);
  return <VariantDetail product={product} variant={variant} onProduct={(next) => { setProduct(next); publish(next); }} onGone={setGone} toProduct={toProduct} />;
}

type DetailProps = Readonly<{
  product: Product;
  variant: ProductVariant;
  onProduct: (product: Product) => void;
  onGone: (gone: Gone) => void;
  toProduct: () => void;
}>;

function VariantDetail({ product, variant, onProduct, onGone, toProduct }: DetailProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const theme = useTheme();
  const startPrint = useStartProductPrint();
  const money = (amount: number | undefined) => amount === undefined ? "" : amount.toFixed(2);
  const initial = { salePrice: money(variant.salePrice.amount), purchasePrice: money(variant.purchasePrice?.amount), sku: variant.sku ?? "" };
  // A save or reload restarts the fields from what core answered; the other actions leave what is being typed.
  const [form, setForm] = useState(initial);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<"salePrice" | "purchasePrice" | "sku", string>>>({});
  const [busy, setBusy] = useState<Busy>(null);
  const [notice, setNotice] = useState<Readonly<{ text: string; error: boolean }> | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [blockedDelete, setBlockedDelete] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [combinationError, setCombinationError] = useState<string | null>(null);
  const [combinationUncertain, setCombinationUncertain] = useState(false);
  const [printing, setPrinting] = useState(false);
  // `busy` only changes after the connection check, so it cannot stop a second tap that arrives during it.
  const acting = useRef(false);

  const dirty = form.salePrice !== initial.salePrice || form.purchasePrice !== initial.purchasePrice || form.sku !== initial.sku;
  const setNavigationDirty = useProductNavigationGuard(dirty);
  const title = combinationLabel(product.options, variant.combination);
  const inactive = variant.status === "inactive";
  const working = busy !== null;
  const productId = product.id;
  const edit = (field: "salePrice" | "purchasePrice" | "sku", value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
  };

  const deleteReason = variant.hasOrders ? t("deleteBlockedOrders")
    : variant.stock > 0 ? t("deleteBlockedStock", { count: variant.stock })
      : product.variants.length === 1 ? t("deleteBlockedLast") : null;
  const lostValues = product.options.flatMap((option, position) => {
    const valueId = variant.combination[position]?.valueId;
    const shared = product.variants.some((other) => other.id !== variant.id && other.combination[position]?.valueId === valueId);
    const value = option.values.find((candidate) => candidate.id === valueId);
    return shared || !value ? [] : [t("lostValueNotice", { value: value.name, option: option.name })];
  });

  /** Runs one request after the connection check. A lost answer is never shown as success: it offers the reload. */
  const run = async (kind: Exclude<Busy, null>, request: () => Promise<Result<Product, VariantActionError>>,
    messages: Readonly<{ offline: string; uncertain: string }>, handle: (error: VariantActionError) => boolean, done: (next: Product) => void) => {
    if (acting.current) return;
    acting.current = true;
    setNotice(null); setUncertain(false);
    if (!await isOnline()) { acting.current = false; setNotice({ text: messages.offline, error: true }); return; }
    setBusy(kind);
    const result = await request();
    acting.current = false;
    setBusy(null);
    if (result.success) { onProduct(result.data); done(result.data); return; }
    const code = result.error.code;
    if (code === "PRODUCT_NOT_FOUND") { setNavigationDirty(false); onGone("products"); return; }
    if (code === "VARIANT_NOT_FOUND") { setNavigationDirty(false); onGone("product"); return; }
    if (handle(result.error)) return;
    if (uncertainCodes.includes(code)) { setNotice({ text: messages.uncertain, error: true }); setUncertain(true); return; }
    setNotice({ text: t("variantActionError"), error: true });
  };

  const save = () => {
    const sale = amountOf(form.salePrice);
    const purchase = form.purchasePrice.trim() ? amountOf(form.purchasePrice) : null;
    const invalid = {
      ...(sale === null || sale <= 0 ? { salePrice: t("variantPriceRequired") } : decimals(form.salePrice) > 2 ? { salePrice: t("maxTwoDecimals") } : {}),
      ...(form.purchasePrice.trim() && purchase === null ? { purchasePrice: t("purchasePriceInvalid") } : decimals(form.purchasePrice) > 2 ? { purchasePrice: t("maxTwoDecimals") } : {}),
      ...(form.sku.trim().length > 100 ? { sku: t("maxCharacters", { count: 100 }) } : {}),
    };
    if (Object.keys(invalid).length) { setFieldErrors(invalid); return; }
    void run("save", () => variants.updateVariant(productId, variant.id, { sku: form.sku.trim() || null, salePrice: sale ?? 0, purchasePrice: purchase }),
      { offline: t("variantSaveOffline"), uncertain: t("variantSaveUncertain") },
      (error) => {
        if (error.code === "DUPLICATE_SKU") { setFieldErrors({ sku: t("variantSkuInUse") }); return true; }
        if (error.code === "VALIDATION_ERROR" || error.code === "INVALID_INPUT") {
          const mapped: typeof fieldErrors = {};
          for (const issue of error.issues ?? []) {
            if (issue.field === "sku") mapped.sku = issue.reason === "DUPLICATE_SKU" ? t("variantSkuInUse") : t("maxCharacters", { count: 100 });
            else if (issue.field === "salePrice") mapped.salePrice = issue.reason === "TOO_MANY_DECIMALS" ? t("maxTwoDecimals") : t("variantPriceRequired");
            else if (issue.field === "purchasePrice") mapped.purchasePrice = issue.reason === "TOO_MANY_DECIMALS" ? t("maxTwoDecimals") : t("purchasePriceInvalid");
          }
          if (Object.keys(mapped).length) { setFieldErrors(mapped); return true; }
          setNotice({ text: t("variantSaveError"), error: true });
          return true;
        }
        return false;
      },
      (next) => {
        const saved = next.variants.find((candidate) => candidate.id === variant.id);
        setForm({ salePrice: money(saved?.salePrice.amount), purchasePrice: money(saved?.purchasePrice?.amount), sku: saved?.sku ?? "" });
        setFieldErrors({});
        setNotice({ text: t("variantSaved"), error: false });
      });
  };

  const changeStatus = (status: "active" | "inactive") => {
    const verb = status === "inactive" ? t("deactivateVerb") : t("activateVerb");
    void run(status === "inactive" ? "deactivate" : "activate", () => variants.changeStatus(productId, variant.id, status),
      { offline: t("variantActionOffline", { action: verb }), uncertain: t("variantActionUncertain") }, () => false,
      () => setNotice({ text: status === "inactive" ? t("variantDeactivated") : t("variantActivated"), error: false }));
  };
  const confirmDeactivate = () => {
    const last = product.variants.filter((other) => other.status === "active").length === 1 && !inactive;
    showConfirmation({
      title: t("deactivateTitle", { name: title }),
      description: [t("deactivateBody"), variant.stock > 0 ? t("deactivateStock", { count: variant.stock }) : null, last ? t("deactivateLast") : null].filter(Boolean).join(" "),
      confirmLabel: t("deactivateConfirm"), cancelLabel: t("cancel"), destructive: false, onConfirm: () => changeStatus("inactive"),
    });
  };
  const remove = () => void run("delete", () => variants.deleteVariant(productId, variant.id),
    { offline: t("variantActionOffline", { action: t("deleteVerb") }), uncertain: t("variantActionUncertain") },
    (error) => {
      if (error.code === "VARIANT_HAS_ORDERS") { setBlockedDelete(t("deleteRejectedOrders")); return true; }
      if (error.code === "VARIANT_HAS_STOCK") { setBlockedDelete(t("deleteRejectedStock")); return true; }
      if (error.code === "LAST_VARIANT") { setBlockedDelete(t("deleteBlockedLast")); return true; }
      return false;
    },
    () => { setNavigationDirty(false); toProduct(); });
  const confirmDelete = () => showConfirmation({
    title: t("deleteTitle", { name: title }), description: [t("deleteBody"), ...lostValues].join(" "),
    confirmLabel: t("deleteVariant"), cancelLabel: t("keepVariant"), destructive: true, onConfirm: remove,
  });

  const changeCombination = async (values: ChangeCombinationRequest["values"]) => {
    if (acting.current) return;
    acting.current = true;
    setCombinationError(null); setCombinationUncertain(false);
    if (!await isOnline()) { acting.current = false; setCombinationError(t("combinationOffline")); return; }
    setBusy("combination");
    const result = await variants.changeCombination(productId, variant.id, { values });
    acting.current = false;
    setBusy(null);
    if (result.success) { onProduct(result.data); setChanging(false); setNotice({ text: t("combinationChanged"), error: false }); return; }
    const code = result.error.code;
    if (code === "PRODUCT_NOT_FOUND") { setNavigationDirty(false); onGone("products"); return; }
    if (code === "VARIANT_NOT_FOUND") { setNavigationDirty(false); onGone("product"); return; }
    if (code === "DUPLICATE_COMBINATION") {
      const wanted = product.options.map((option) => values.find((entry) => entry.optionId === option.id));
      const names = wanted.map((entry, position) => entry && "valueId" in entry ? product.options[position]?.values.find((value) => value.id === entry.valueId)?.name : entry && "newValue" in entry ? entry.newValue.name : undefined);
      setCombinationError(t("combinationExists", { name: names.filter(Boolean).join(" / ") }));
    } else if (uncertainCodes.includes(code)) { setCombinationError(t("combinationUncertain")); setCombinationUncertain(true); }
    else setCombinationError(t("combinationError"));
  };

  const reload = () => {
    const load = async () => {
      setChanging(false);
      const result = await products.loadProduct(productId);
      if (!result.success) {
        if (result.error.code === "PRODUCT_NOT_FOUND") { setNavigationDirty(false); onGone("products"); }
        else setNotice({ text: t("variantLoadError"), error: true });
        return;
      }
      const next = result.data.variants.find((candidate) => candidate.id === variant.id);
      onProduct(result.data);
      if (!next) { setNavigationDirty(false); onGone("product"); return; }
      setForm({ salePrice: money(next.salePrice.amount), purchasePrice: money(next.purchasePrice?.amount), sku: next.sku ?? "" });
      setFieldErrors({}); setNotice(null); setUncertain(false); setBlockedDelete(null);
    };
    if (!dirty) { void load(); return; }
    showConfirmation({ title: t("discardChanges"), description: t("discardDescription"), confirmLabel: t("discard"), cancelLabel: t("keepEditing"), destructive: true, onConfirm: () => void load() });
  };

  const printVariant = (variantId: VariantId, copies: CopyCount) => {
    startPrint(product, variantId, copies);
    setPrinting(false);
  };
  const card = [styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }];
  const reason = blockedDelete ?? deleteReason;

  return <ThemedView style={styles.page}><SafeAreaView edges={formEdges} style={styles.safe}>
    <ProductTopBar title={title} onClose={() => router.back()} back>
      <Button onPress={save} disabled={working}>{busy === "save" ? t("variantSaving") : t("variantSaveAction")}</Button>
    </ProductTopBar>
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {inactive ? <View style={[styles.notice, { backgroundColor: theme.warningSurface }]}>
        <ThemedText type="small" style={{ color: theme.warning }}>{t("variantInactiveNotice")}</ThemedText>
      </View> : null}
      {notice ? <ThemedText type="small" accessibilityRole="alert" accessibilityLiveRegion="polite" style={notice.error ? { color: theme.error } : undefined}>{notice.text}</ThemedText> : null}
      {uncertain ? <Button variant="secondary" onPress={reload} disabled={working}>{t("reloadVariant")}</Button> : null}
      <View style={card}>
        <View style={styles.between}>
          <ThemedText type="smallBold" accessibilityRole="header">{t("variantOptionsHeading")}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{product.name}</ThemedText>
        </View>
        {product.options.map((option, position) => <View key={option.id} style={styles.between}>
          <ThemedText themeColor="textSecondary">{option.name}</ThemedText>
          <ThemedText type="smallBold">{option.values.find((value) => value.id === variant.combination[position]?.valueId)?.name}</ThemedText>
        </View>)}
        <Button variant="secondary" onPress={() => { setCombinationError(null); setCombinationUncertain(false); setChanging(true); }} disabled={working}>{t("changeCombination")}</Button>
      </View>
      <View style={card}>
        <View style={styles.between}>
          <ThemedText type="smallBold" accessibilityRole="header">{t("priceHeading")}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{product.currency}</ThemedText>
        </View>
        <Field required invalid={!!fieldErrors.salePrice} disabled={working}>
          <FieldLabel>{t("salePrice")}</FieldLabel>
          <Input value={form.salePrice} onChangeText={(value) => edit("salePrice", value)} keyboardType="decimal-pad" placeholder="0.00" accessibilityLabel={t("salePrice")} />
          {fieldErrors.salePrice ? <FieldError>{fieldErrors.salePrice}</FieldError> : null}
        </Field>
        <Field invalid={!!fieldErrors.purchasePrice} disabled={working}>
          <FieldLabel>{t("purchasePrice")}</FieldLabel>
          <Input value={form.purchasePrice} onChangeText={(value) => edit("purchasePrice", value)} keyboardType="decimal-pad" placeholder="0.00" accessibilityLabel={t("purchasePrice")} />
          {fieldErrors.purchasePrice ? <FieldError>{fieldErrors.purchasePrice}</FieldError> : null}
        </Field>
      </View>
      <View style={card}>
        <ThemedText type="smallBold" accessibilityRole="header">{t("inventoryHeading")}</ThemedText>
        <Field invalid={!!fieldErrors.sku} disabled={working}>
          <FieldLabel>SKU</FieldLabel>
          <Input value={form.sku} onChangeText={(value) => edit("sku", value)} maxLength={100} placeholder={t("optional")} accessibilityLabel={t("optionalSku")} autoCapitalize="characters" />
          {fieldErrors.sku ? <FieldError>{fieldErrors.sku}</FieldError> : null}
        </Field>
        <View style={styles.between} accessible accessibilityLabel={`${t("stock")}: ${variant.stock}`}>
          <ThemedText themeColor="textSecondary">{t("stock")}</ThemedText>
          <ThemedText type="smallBold">{variant.stock}</ThemedText>
        </View>
      </View>
      <View style={card}>
        <ThemedText type="smallBold" accessibilityRole="header">{t("variantQrHeading")}</ThemedText>
        <View style={styles.qr}>
          <VariantQr value={variant.qrCode} label={t("variantQrHeading")} />
          <View style={styles.qrText}>
            <ThemedText type="small" themeColor="textSecondary">{t("variantQrHelp")}</ThemedText>
            <Button variant="secondary" onPress={() => setPrinting(true)} disabled={working}>{t("print")}</Button>
          </View>
        </View>
      </View>
      {inactive
        ? <Button variant="secondary" onPress={() => changeStatus("active")} disabled={working}>{busy === "activate" ? t("activatingVariant") : t("activateVariant")}</Button>
        : <Button variant="destructive" onPress={confirmDeactivate} disabled={working}>{busy === "deactivate" ? t("deactivatingVariant") : t("deactivateVariant")}</Button>}
      {reason ? <ThemedText type="small" themeColor="textSecondary" style={styles.reason}>{reason}</ThemedText>
        : <Button variant="destructive" onPress={confirmDelete} disabled={working}>{busy === "delete" ? t("deletingVariant") : t("deleteVariant")}</Button>}
    </ScrollView>
    {changing ? <ChangeCombinationSheet product={product} variant={variant} busy={busy === "combination"} error={combinationError} uncertain={combinationUncertain}
      onReload={reload} onClose={() => setChanging(false)} onSubmit={(values) => void changeCombination(values)} /> : null}
    {printing ? <ProductPrintSheet visible product={product} initialVariantId={variant.id} unsavedChanges={dirty} onClose={() => setPrinting(false)} onPrint={printVariant} /> : null}
  </SafeAreaView></ThemedView>;
}

const styles = StyleSheet.create({
  page: { flex: 1 }, safe: { flex: 1 }, scroll: { flex: 1 },
  content: { gap: tokens.spacing["4"], padding: tokens.spacing["4"], paddingBottom: tokens.spacing["8"] },
  card: { borderWidth: tokens.sizing.borderWidth, borderRadius: tokens.radius.card, padding: tokens.spacing["4"], gap: tokens.spacing["3"] },
  notice: { borderRadius: tokens.radius.control, padding: tokens.spacing["3"] },
  between: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: tokens.spacing["3"] },
  qr: { flexDirection: "row", gap: tokens.spacing["4"], alignItems: "flex-start" },
  qrText: { flex: 1, minWidth: 0, gap: tokens.spacing["3"] },
  reason: { textAlign: "center" },
});
