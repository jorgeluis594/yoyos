import { useTranslation } from "react-i18next";
import { Fragment, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Link } from "react-router";
import { Alert, AlertDescription } from "@core/app/components/ui/alert";
import { Button } from "@core/app/components/ui/button";
import { FileUploadPreview } from "@core/app/components/ui/file-upload";
import { Field, FieldError, FieldLabel } from "@core/app/components/ui/field";
import { Input } from "@core/app/components/ui/input";
import { Textarea } from "@core/app/components/ui/textarea";
import { uploadImageFile } from "@core/src/shared/images/presentation/client";
import { useClientReady } from "@core/app/use-client-ready";
import { clearOptions, createDraft, setRow, type EditorDraft } from "@shared/product-variants";
import type { Currency } from "@shared/money";
import type { Edit } from "@shared/product-variants";
import type { FormErrors, SaveFeedback } from "@core/src/features/products/presentation/messages";
import type { OptionBuffer } from "@core/src/features/products/presentation/option-buffer";
import { applyOptionBuffer } from "@core/src/features/products/presentation/option-buffer";
import { draftSnapshot, feedbackTargets, hasOptions, stockTotal, type FeedbackTargets } from "@core/src/features/products/presentation/product-editor-model";
import { useDiscardGuard } from "@core/src/features/products/presentation/use-discard-guard";
import { ConfirmDialog } from "@core/src/features/products/presentation/variant-dialogs";
import { VariantsCard } from "@core/src/features/products/presentation/variants-card";

export type ProductFormValues = Readonly<{ name: string; description: string; sku: string; salePrice: string; purchasePrice: string; initialStock: string }>;
export const emptyProductFormValues: ProductFormValues = { name: "", description: "", sku: "", salePrice: "", purchasePrice: "", initialStock: "" };

export type ProductImageSelection =
  | Readonly<{ kind: "keep" }>
  | Readonly<{ kind: "set"; id: string }>
  | Readonly<{ kind: "remove" }>;

export type ProductFormSubmission = Readonly<{ values: ProductFormValues; image: ProductImageSelection; draft: EditorDraft }>;

const noFeedback: SaveFeedback = { errors: {}, issues: [] };
const noTargets: FeedbackTargets = { rows: {}, options: {}, values: {}, blockedValues: new Set() };
const emptyDraft = createDraft({ sku: null, salePrice: 0, purchasePrice: null, stock: 0 });
const amount = (text: string): number | null => text.trim() === "" ? null : Number(text);

/** The form's own fields for a product without options go into the draft: the base of a new product, the single row of a saved one. */
export function syncValues(draft: EditorDraft, values: ProductFormValues): EditorDraft {
  const sku = values.sku.trim() === "" ? null : values.sku;
  const salePrice = Number(values.salePrice) || 0;
  const purchasePrice = amount(values.purchasePrice);
  if (!draft.saved) return { ...draft, base: { sku, salePrice, purchasePrice, stock: Number(values.initialStock) || 0 } };
  return draft.options.length === 0 && draft.rows[0] ? setRow(draft, draft.rows[0].ref, { sku, salePrice, purchasePrice }) : draft;
}

export function ProductForm({ currency, cancelTo, feedback = noFeedback, pending, onSave, onReload, values: initialValues = emptyProductFormValues, draft: initialDraft = emptyDraft, originalNames = {}, submitLabel, imageUrl }: {
  currency: Currency;
  cancelTo: string;
  feedback?: SaveFeedback;
  pending: boolean;
  onSave: (submission: ProductFormSubmission) => void;
  /** Reloads the saved product, after the discard confirmation when the form has changes. */
  onReload?: () => void;
  values?: ProductFormValues;
  draft?: EditorDraft;
  /** The names the saved product had, to show «Antes …» for renamed values. */
  originalNames?: Readonly<Record<string, string>>;
  submitLabel?: string;
  imageUrl?: string;
}) {
  const { t } = useTranslation();
  const errors: FormErrors = feedback.errors;
  const [values, setValues] = useState<ProductFormValues>(initialValues);
  const [draft, setDraft] = useState<EditorDraft>(initialDraft);
  const [photo, setPhoto] = useState<{ url: string } | null>(imageUrl ? { url: imageUrl } : null);
  const [uploadedId, setUploadedId] = useState<string | null>(null);
  const [removed, setRemoved] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [confirmReload, setConfirmReload] = useState(false);
  const [targets, setTargets] = useState<FeedbackTargets>(noTargets);
  const submitted = useRef<EditorDraft>(initialDraft);
  const [opened] = useState(() => draftSnapshot([initialValues, initialDraft, "keep"]));
  // The form submits only through React, so a click before hydration would navigate with a native GET.
  const ready = useClientReady();
  const withOptions = hasOptions(draft);
  const saved = draft.saved;
  const fields: readonly (keyof ProductFormValues)[] = withOptions ? ["name", "description"] : ["name", "description", "sku", "salePrice", "purchasePrice"];
  const image: ProductImageSelection = removed ? { kind: "remove" } : uploadedId ? { kind: "set", id: uploadedId } : { kind: "keep" };
  const dirty = draftSnapshot([values, draft, image.kind === "keep" ? "keep" : image]) !== opened;
  const guard = useDiscardGuard(dirty);

  useEffect(() => {
    guard.holdLeaving();
    setTargets(feedback.issues.length > 0 ? feedbackTargets(submitted.current, feedback.issues) : noTargets);
  }, [feedback]); // eslint-disable-line react-hooks/exhaustive-deps

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const final = withOptions ? draft : syncValues(draft, values);
    submitted.current = final;
    guard.allowLeaving();
    onSave({ values, image, draft: final });
  }

  const commitOption = (buffer: OptionBuffer): Edit => applyOptionBuffer(withOptions ? draft : syncValues(draft, values), buffer);

  async function selectPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploading(true);
    setPhotoError("");
    const result = await uploadImageFile(file);
    if (result.success) {
      setPhoto({ url: result.data.url });
      setUploadedId(result.data.id);
      setRemoved(false);
    } else {
      setPhotoError(result.error.code === "IMAGE_TOO_LARGE" ? t("products.imageTooLarge") : result.error.code === "INVALID_IMAGE" ? t("products.invalidImage") : t("products.uploadError"));
    }
    setUploading(false);
  }

  function removePhoto() {
    setPhoto(null);
    setUploadedId(null);
    setRemoved(true);
    setPhotoError("");
  }

  const reload = () => dirty ? setConfirmReload(true) : onReload?.();
  const reviewed = Object.keys(targets.rows).length;
  const notice = errors.changed ?? errors.inDoubt;
  const readOnlyStock = saved || withOptions;

  return <form onSubmit={save} noValidate className="mt-8 flex flex-col gap-6">
    {notice && <Alert variant="warning"><AlertDescription className="flex flex-wrap items-center gap-3">{notice}
      {onReload && <Button type="button" variant="outline" size="sm" onClick={reload}>{t("productEditor.reload")}</Button>}</AlertDescription></Alert>}
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="grid gap-5">
      <section aria-labelledby="product-data-heading" className="grid gap-4 sm:grid-cols-2">
        <h2 id="product-data-heading" className="text-base font-semibold sm:col-span-2">{t("products.data")}</h2>
      {fields.map((key) => {
        const label = { name: t("products.name"), description: t("products.description"), sku: "SKU", salePrice: `${t("products.salePrice")} (${currency})`, purchasePrice: `${t("products.purchasePrice")} (${currency})`, initialStock: t("products.initialStock") }[key];
        const wide = key === "name" || key === "description";
        return <Fragment key={key}>
          {key === "sku" && saved && <h2 className="pt-2 text-base font-semibold sm:col-span-2">{t("products.priceVariant")}</h2>}
          <Field data-invalid={Boolean(errors[key])} className={wide ? "sm:col-span-2" : ""}>
          <FieldLabel htmlFor={key}>{label}{key === "name" || key === "salePrice" ? " *" : ""}</FieldLabel>
          {key === "description" ? <Textarea id={key} name={key} aria-invalid={Boolean(errors[key]) || undefined} aria-describedby={errors[key] ? `${key}-error` : undefined} value={values[key]} onChange={(event) => setValues({ ...values, [key]: event.target.value })} maxLength={5000} rows={4} /> :
            <Input id={key} name={key} aria-invalid={Boolean(errors[key]) || undefined} aria-describedby={errors[key] ? `${key}-error` : undefined} value={values[key]} onChange={(event) => setValues({ ...values, [key]: event.target.value })} type={key === "salePrice" || key === "purchasePrice" || key === "initialStock" ? "number" : "text"} inputMode={key === "initialStock" ? "numeric" : key === "salePrice" || key === "purchasePrice" ? "decimal" : undefined} step={key === "initialStock" ? "1" : key === "salePrice" || key === "purchasePrice" ? "0.01" : undefined} min={key === "salePrice" ? "0.01" : key === "purchasePrice" || key === "initialStock" ? "0" : undefined} maxLength={key === "name" ? 200 : key === "sku" ? 100 : undefined} />}
          {errors[key] && <FieldError id={`${key}-error`}>{errors[key]}</FieldError>}
          </Field>
        </Fragment>;
      })}
      </section>
      <VariantsCard draft={draft} setDraft={setDraft} currency={currency} originalNames={originalNames} targets={targets} commitOption={commitOption}
        onClearOptions={() => setDraft((current) => clearOptions(current))} />
      </div>
      <aside className="grid gap-5">
      <Field data-invalid={Boolean(photoError)}>
        <FieldLabel htmlFor="photo">{t("products.photo")}</FieldLabel>
        <div className="flex flex-wrap items-center gap-3">
          <input id="photo" name="photo" type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={selectPhoto} aria-invalid={!!photoError} aria-describedby={photoError ? "photo-error" : undefined} className="text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-destructive" />
          {photo && <Button type="button" variant="outline" onClick={removePhoto}>{t("products.removePhoto")}</Button>}
        </div>
        {uploading && <p role="status" className="text-sm text-muted-foreground">{t("products.uploading")}</p>}
        {photo && <FileUploadPreview src={photo.url} alt={t("products.preview")} />}
        {photoError && <FieldError id="photo-error">{photoError}</FieldError>}
      </Field>
      {readOnlyStock ? <Field>
        <FieldLabel htmlFor="initialStock">{t("products.stock")}</FieldLabel>
        <Input id="initialStock" name="initialStock" value={stockTotal(draft)} readOnly aria-readonly="true" aria-describedby={withOptions ? "stock-help" : undefined} className="bg-muted text-muted-foreground" />
        {withOptions && <p id="stock-help" className="text-sm text-muted-foreground">{saved ? t("productEditor.stockSumActive") : t("productEditor.stockSum")}</p>}
      </Field> : <Field data-invalid={Boolean(errors.initialStock)}>
        <FieldLabel htmlFor="initialStock">{t("products.initialStock")}</FieldLabel>
        <Input id="initialStock" name="initialStock" aria-invalid={Boolean(errors.initialStock) || undefined} aria-describedby={errors.initialStock ? "initialStock-error" : undefined} value={values.initialStock} onChange={(event) => setValues({ ...values, initialStock: event.target.value })} type="number" inputMode="numeric" step="1" min="0" />
        {errors.initialStock && <FieldError id="initialStock-error">{errors.initialStock}</FieldError>}
      </Field>}
      </aside>
    </div>
    {reviewed > 0 && <Alert variant="destructive"><AlertDescription>{t("productEditor.reviewVariants", { count: reviewed })}</AlertDescription></Alert>}
    {errors.form && <Alert variant="destructive"><AlertDescription>{errors.form}</AlertDescription></Alert>}
    <div className="flex flex-wrap gap-3 border-t border-border pt-5">
      <Button type="submit" disabled={pending || uploading || !ready}>{pending ? t("products.saving") : submitLabel ?? t("products.save")}</Button>
      <Button asChild variant="outline"><Link to={cancelTo}>{t("products.cancel")}</Link></Button>
    </div>
    {guard.dialog}
    {confirmReload && <ConfirmDialog title={t("productEditor.discardTitle")} description={t("productEditor.discardDescription")} confirm={t("productEditor.discard")} cancel={t("productEditor.keepEditing")}
      onConfirm={() => { setConfirmReload(false); guard.allowLeaving(); onReload?.(); }} onCancel={() => setConfirmReload(false)} />}
  </form>;
}
