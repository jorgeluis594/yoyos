import { useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Printer } from "lucide-react";
import { Alert, AlertDescription } from "@core/app/components/ui/alert";
import { Badge } from "@core/app/components/ui/badge";
import { Button } from "@core/app/components/ui/button";
import { Field, FieldError, FieldLabel } from "@core/app/components/ui/field";
import { Input } from "@core/app/components/ui/input";
import { PageContainer } from "@core/app/components/ui/page-container";
import { PageHeader } from "@core/app/components/ui/page-header";
import type { ProductDetailResponse } from "@shared/contracts/products";
import { CombinationDialog, DeactivateDialog, DeleteDialog } from "@core/src/features/products/presentation/variant-detail-dialogs";
import { deleteBlock, variantLabel, type VariantIntent, type VariantOutcome } from "@core/src/features/products/presentation/variant-detail-model";
import { QrCode, VariantLabel, type LabelHandle } from "@core/src/features/products/presentation/variant-label";
import { ConfirmDialog } from "@core/src/features/products/presentation/variant-dialogs";
import { useDiscardGuard } from "@core/src/features/products/presentation/use-discard-guard";

type Product = ProductDetailResponse["product"];
type Variant = Product["variants"][number];
export type VariantBody = Readonly<Record<string, unknown>> & Readonly<{ intent: VariantIntent }>;
type Dialog = "combination" | "deactivate" | "delete" | null;

export type VariantDetailProps = Readonly<{
  product: Product;
  variant: Variant;
  productHref: string;
  outcome: VariantOutcome | undefined;
  /** The action still waiting for its answer. */
  pending: VariantIntent | null;
  pendingStatus?: "active" | "inactive";
  onSubmit: (body: VariantBody) => void;
  onReload: () => void;
}>;

const money = (amount: number | undefined) => amount === undefined ? "" : amount.toFixed(2);

export function VariantDetail({ product, variant, productHref, outcome, pending, pendingStatus, onSubmit, onReload }: VariantDetailProps) {
  const { t } = useTranslation();
  const initial = { salePrice: money(variant.salePrice.amount), purchasePrice: money(variant.purchasePrice?.amount), sku: variant.sku ?? "" };
  const [values, setValues] = useState(initial);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [baseline, setBaseline] = useState<VariantOutcome>();
  const [dismissed, setDismissed] = useState<VariantOutcome>();
  const [confirmReload, setConfirmReload] = useState(false);
  const [noFit, setNoFit] = useState(false);
  const label = useRef<LabelHandle>(null);
  const dirty = values.salePrice !== initial.salePrice || values.purchasePrice !== initial.purchasePrice || values.sku !== initial.sku;
  // While a delete waits, leaving is the delete itself; if it is rejected the guard is back in force.
  const guard = useDiscardGuard(dirty && pending !== "delete");
  const busy = pending !== null;
  const shown = outcome && outcome !== dismissed ? outcome : undefined;
  const errors = shown && "failed" in shown ? shown.errors : {};
  const saved = shown && "saved" in shown ? shown.saved : undefined;
  const title = variantLabel(product, variant);
  const inactive = variant.status !== "active";
  const block = deleteBlock(product, variant);

  // The combination dialog stays open on a rejection and closes with the confirmation that answers its own save.
  const combinationSaved = outcome !== baseline && outcome !== undefined && "saved" in outcome && outcome.intent === "combination";

  function edit(key: keyof typeof values, text: string) {
    setValues({ ...values, [key]: text });
    setDismissed(outcome);
  }
  function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    onSubmit({
      intent: "update", sku: values.sku.trim() === "" ? null : values.sku.trim(),
      salePrice: Number(values.salePrice), purchasePrice: values.purchasePrice.trim() === "" ? null : Number(values.purchasePrice),
    });
  }
  function print() {
    if (label.current && !label.current.fits()) return setNoFit(true);
    setNoFit(false);
    window.print();
  }
  const reload = () => dirty ? setConfirmReload(true) : onReload();
  const buttonText = (intent: VariantIntent, idle: string, busyText: string) => pending === intent ? busyText : idle;
  const deactivating = pending === "status" && pendingStatus === "inactive";
  const activating = pending === "status" && pendingStatus !== "inactive";
  const combinationFailure = outcome !== baseline && outcome && "failed" in outcome && outcome.intent === "combination" ? outcome.errors : undefined;
  // A failed combination is shown inside its open dialog, where the seller is looking.
  const notice = dialog === "combination" && combinationFailure ? undefined : errors.inDoubt ?? errors.form;
  const field = (key: keyof typeof values, text: string, input: Partial<React.ComponentProps<typeof Input>>) => <Field data-invalid={Boolean(errors[key])}>
    <FieldLabel htmlFor={`variant-${key}`}>{text}</FieldLabel>
    <Input id={`variant-${key}`} value={values[key]} onChange={(event) => edit(key, event.target.value)} aria-invalid={Boolean(errors[key]) || undefined} aria-describedby={errors[key] ? `variant-${key}-error` : undefined} {...input} />
    {errors[key] && <FieldError id={`variant-${key}-error`}>{errors[key]}</FieldError>}
  </Field>;

  return <PageContainer>
    <PageHeader>
      <PageHeader.Heading>
        <PageHeader.Title>{title}</PageHeader.Title>
        <PageHeader.Description>{t("variantDetail.subtitle", { name: product.name })}</PageHeader.Description>
      </PageHeader.Heading>
      <PageHeader.Actions><Button asChild variant="outline"><Link to={productHref}>{t("variantDetail.backToProduct")}</Link></Button></PageHeader.Actions>
    </PageHeader>
    <form onSubmit={save} noValidate className="mt-8 flex flex-col gap-6">
      {inactive && <Alert variant="warning"><AlertDescription>{t("variantDetail.inactiveNotice")}</AlertDescription></Alert>}
      {saved && <Alert variant="success"><AlertDescription>{saved}</AlertDescription></Alert>}
      {notice && <Alert variant="destructive"><AlertDescription className="flex flex-wrap items-center gap-3">{notice}
        {errors.inDoubt && <Button type="button" variant="outline" size="sm" onClick={reload}>{t("variantDetail.reload")}</Button>}</AlertDescription></Alert>}
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="grid gap-6">
          <section aria-labelledby="variant-options-heading" className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="variant-options-heading" className="text-base font-semibold">{t("variantDetail.options")}</h2>
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { setBaseline(outcome); setDialog("combination"); }}>{t("variantDetail.changeCombination")}</Button>
            </div>
            <dl className="grid gap-4 sm:grid-cols-2">
              {product.options.map((option) => {
                const valueId = variant.combination.find((entry) => entry.optionId === option.id)?.valueId;
                return <div key={option.id}><dt className="text-sm text-muted-foreground">{option.name}</dt><dd className="font-medium">{option.values.find((value) => value.id === valueId)?.name}</dd></div>;
              })}
            </dl>
          </section>
          <section aria-labelledby="variant-price-heading" className="grid gap-4 sm:grid-cols-2">
            <h2 id="variant-price-heading" className="text-base font-semibold sm:col-span-2">{t("variantDetail.price")}</h2>
            {field("salePrice", `${t("variantDetail.salePrice", { currency: product.currency })} *`, { type: "number", inputMode: "decimal", step: "0.01", min: "0.01" })}
            {field("purchasePrice", t("variantDetail.purchasePrice", { currency: product.currency }), { type: "number", inputMode: "decimal", step: "0.01", min: "0" })}
          </section>
          <section aria-labelledby="variant-inventory-heading" className="grid gap-4 sm:grid-cols-2">
            <h2 id="variant-inventory-heading" className="text-base font-semibold sm:col-span-2">{t("variantDetail.inventory")}</h2>
            <Field>
              <FieldLabel htmlFor="variant-stock">{t("variantDetail.stock")}</FieldLabel>
              <Input id="variant-stock" value={variant.stock} readOnly aria-readonly="true" className="bg-muted text-muted-foreground" />
            </Field>
            {field("sku", t("variantDetail.sku"), { maxLength: 100 })}
          </section>
        </div>
        <aside className="grid gap-6">
          <section aria-labelledby="variant-qr-heading" className="grid gap-2">
            <h2 id="variant-qr-heading" className="text-sm font-semibold">{t("variantDetail.qrTitle")}</h2>
            <div className="flex gap-3 rounded-lg border border-border p-4">
              <QrCode value={variant.qrCode} label={t("variantDetail.qrAlt", { label: title })} className="size-24 shrink-0" />
              <div className="grid content-start gap-2 text-sm text-muted-foreground">
                <p>{t("variantDetail.qrHelp")}</p>
                <div><Button type="button" variant="outline" size="sm" onClick={print}><Printer aria-hidden="true" data-icon="inline-start" />{t("variantDetail.print")}</Button></div>
              </div>
            </div>
            {noFit && <FieldError role="alert">{t("variantDetail.labelNoFit")}</FieldError>}
          </section>
          <section aria-labelledby="variant-siblings-heading" className="grid gap-2">
            <h2 id="variant-siblings-heading" className="text-sm font-semibold">{t("variantDetail.siblings", { name: product.name })}</h2>
            <ul className="overflow-hidden rounded-lg border border-border text-sm">
              {product.variants.map((sibling) => {
                const current = sibling.id === variant.id;
                return <li key={sibling.id} className="border-b border-border last:border-b-0">
                  <Link to={`${productHref}/variants/${sibling.id}`} aria-current={current ? "page" : undefined}
                    className={`flex items-center justify-between gap-2 px-3 py-2 ${current ? "bg-muted font-medium" : "hover:bg-muted/60"}`}>
                    <span className="flex items-center gap-2">{variantLabel(product, sibling)}{sibling.status !== "active" && <Badge variant="secondary">{t("variantDetail.siblingInactive")}</Badge>}</span>
                    <span className="text-muted-foreground">{t("variantDetail.siblingStock", { count: sibling.stock })}</span>
                  </Link>
                </li>;
              })}
            </ul>
          </section>
        </aside>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-5">
        <Button type="submit" disabled={busy}>{buttonText("update", t("variantDetail.save"), t("variantDetail.saving"))}</Button>
        <Button asChild variant="outline"><Link to={productHref}>{t("variantDetail.cancel")}</Link></Button>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {block && <p className="text-sm text-muted-foreground">{block.reason === "orders" ? t("variantDetail.blockedOrders") : block.reason === "stock" ? t("variantDetail.blockedStock", { count: block.stock }) : t("variantDetail.blockedLast")}</p>}
          {!block && <Button type="button" variant="outline" disabled={busy} onClick={() => setDialog("delete")}>{buttonText("delete", t("variantDetail.delete"), t("variantDetail.deleting"))}</Button>}
          {inactive
            ? <Button type="button" variant="outline" disabled={busy} onClick={() => onSubmit({ intent: "status", status: "active" })}>{activating ? t("variantDetail.activating") : t("variantDetail.activate")}</Button>
            : <Button type="button" variant="destructive" disabled={busy} onClick={() => setDialog("deactivate")}>{deactivating ? t("variantDetail.deactivating") : t("variantDetail.deactivate")}</Button>}
        </div>
      </div>
    </form>
    <VariantLabel ref={label} productName={product.name} combination={title} sku={variant.sku} qrCode={variant.qrCode} />
    {guard.dialog}
    {confirmReload && <ConfirmDialog title={t("productEditor.discardTitle")} description={t("productEditor.discardDescription")} confirm={t("productEditor.discard")} cancel={t("productEditor.keepEditing")}
      onConfirm={() => { setConfirmReload(false); setValues(initial); onReload(); }} onCancel={() => setConfirmReload(false)} />}
    {dialog === "combination" && !combinationSaved && <CombinationDialog product={product} variant={variant} pending={pending === "combination"} failure={combinationFailure}
      onSave={(entries) => onSubmit({ intent: "combination", values: entries })} onReload={() => { setDialog(null); reload(); }} onClose={() => setDialog(null)} />}
    {dialog === "deactivate" && <DeactivateDialog product={product} variant={variant} pending={busy} onClose={() => setDialog(null)} onConfirm={() => { setDialog(null); onSubmit({ intent: "status", status: "inactive" }); }} />}
    {dialog === "delete" && <DeleteDialog product={product} variant={variant} pending={busy} onClose={() => setDialog(null)} onConfirm={() => { setDialog(null); onSubmit({ intent: "delete" }); }} />}
  </PageContainer>;
}
