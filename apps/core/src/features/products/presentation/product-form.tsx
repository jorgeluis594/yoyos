import { Fragment, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { Button } from "@core/app/components/ui/button";
import { Field, FieldLabel } from "@core/app/components/ui/field";
import { Input } from "@core/app/components/ui/input";
import { Textarea } from "@core/app/components/ui/textarea";
import { uploadImageFile } from "@core/src/shared/images/presentation/client";
import type { Currency } from "@shared/money";
import type { FormErrors } from "@core/src/features/products/presentation/messages";

export type ProductFormValues = Readonly<{ name: string; description: string; sku: string; salePrice: string; purchasePrice: string; initialStock: string }>;
export const emptyProductFormValues: ProductFormValues = { name: "", description: "", sku: "", salePrice: "", purchasePrice: "", initialStock: "" };

export type ProductImageSelection =
  | Readonly<{ kind: "keep" }>
  | Readonly<{ kind: "set"; id: string }>
  | Readonly<{ kind: "remove" }>;

function uploadMessage(code: string): string {
  if (code === "IMAGE_TOO_LARGE") return "La imagen supera el tamaño máximo de 10 MB.";
  if (code === "INVALID_IMAGE") return "El archivo debe ser una imagen JPG, PNG o WebP.";
  return "No se pudo subir la imagen. Inténtalo de nuevo.";
}

export function ProductForm({ currency, cancelTo, errors, pending, onSave, values: initialValues = emptyProductFormValues, variantFields = "editable", stock, submitLabel = "Guardar producto", imageUrl, variants }: {
  currency: Currency;
  cancelTo: string;
  errors: FormErrors;
  pending: boolean;
  onSave: (values: ProductFormValues, image: ProductImageSelection) => void;
  values?: ProductFormValues;
  variantFields?: "editable" | "hidden";
  stock?: number;
  submitLabel?: string;
  imageUrl?: string;
  variants?: ReactNode;
}) {
  const [values, setValues] = useState<ProductFormValues>(initialValues);
  const [photo, setPhoto] = useState<{ url: string } | null>(imageUrl ? { url: imageUrl } : null);
  const [uploadedId, setUploadedId] = useState<string | null>(null);
  const [removed, setRemoved] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const fields: readonly (keyof ProductFormValues)[] = variantFields === "hidden"
    ? ["name", "description"]
    : ["name", "description", "sku", "salePrice", "purchasePrice"];

  const image: ProductImageSelection = removed ? { kind: "remove" } : uploadedId ? { kind: "set", id: uploadedId } : { kind: "keep" };

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave(values, image);
  }

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
      setPhotoError(uploadMessage(result.error.code));
    }
    setUploading(false);
  }

  function removePhoto() {
    setPhoto(null);
    setUploadedId(null);
    setRemoved(true);
    setPhotoError("");
  }

  return <form onSubmit={save} noValidate className="mt-8 flex flex-col gap-6">
    {variantFields === "hidden" && <p className="text-sm text-muted-foreground">Puedes editar los datos generales y la foto. Las variantes son de solo lectura.</p>}
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="grid gap-5">
      <section aria-labelledby="product-data-heading" className="grid gap-4 sm:grid-cols-2">
        <h2 id="product-data-heading" className="text-base font-semibold sm:col-span-2">Datos del producto</h2>
      {fields.map((key) => {
        const label = { name: "Nombre", description: "Descripción", sku: "SKU", salePrice: `Precio de venta (${currency})`, purchasePrice: `Precio de compra (${currency})`, initialStock: stock === undefined ? "Stock inicial" : "Stock" }[key];
        const wide = key === "name" || key === "description";
        return <Fragment key={key}>
          {key === "sku" && stock !== undefined && <h2 className="pt-2 text-base font-semibold sm:col-span-2">Precio y variante</h2>}
          <Field id={key} error={errors[key]} className={wide ? "sm:col-span-2" : ""}>
          <FieldLabel>{label}{key === "name" || key === "salePrice" ? " *" : ""}</FieldLabel>
          {key === "description" ? <Textarea name={key} value={values[key]} onChange={(event) => setValues({ ...values, [key]: event.target.value })} maxLength={5000} rows={4} /> :
            <Input name={key} value={values[key]} onChange={(event) => setValues({ ...values, [key]: event.target.value })} type={key === "salePrice" || key === "purchasePrice" || key === "initialStock" ? "number" : "text"} inputMode={key === "initialStock" ? "numeric" : key === "salePrice" || key === "purchasePrice" ? "decimal" : undefined} step={key === "initialStock" ? "1" : key === "salePrice" || key === "purchasePrice" ? "0.01" : undefined} min={key === "salePrice" ? "0.01" : key === "purchasePrice" || key === "initialStock" ? "0" : undefined} maxLength={key === "name" ? 200 : key === "sku" ? 100 : undefined} />}
          </Field>
        </Fragment>;
      })}
      </section>
      {variants}
      </div>
      <aside className="grid gap-5">
      <Field id="photo" error={photoError}>
        <FieldLabel>Foto</FieldLabel>
        <div className="flex flex-wrap items-center gap-3">
          <input id="photo" name="photo" type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={selectPhoto} aria-invalid={!!photoError} aria-describedby={photoError ? "photo-error" : undefined} className="text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-destructive" />
          {photo && <Button type="button" variant="outline" onClick={removePhoto}>Quitar foto</Button>}
        </div>
        {uploading && <p role="status" className="text-sm text-muted-foreground">Subiendo imagen…</p>}
        {photo && <img src={photo.url} alt="Vista previa de la foto del producto" className="max-h-48 rounded-md border border-border object-contain" />}
      </Field>
      {stock === undefined ? <Field id="initialStock" error={errors.initialStock}>
        <FieldLabel>Stock inicial</FieldLabel>
        <Input name="initialStock" value={values.initialStock} onChange={(event) => setValues({ ...values, initialStock: event.target.value })} type="number" inputMode="numeric" step="1" min="0" />
      </Field> : <Field id="initialStock"><FieldLabel>Stock</FieldLabel><Input name="initialStock" value={stock} readOnly aria-readonly="true" className="bg-muted text-muted-foreground" /></Field>}
      </aside>
    </div>
    {errors.form && <p role="alert" className="text-sm text-destructive">{errors.form}</p>}
    <div className="flex flex-wrap gap-3 border-t border-border pt-5">
      <Button type="submit" disabled={pending || uploading}>{pending ? "Guardando…" : submitLabel}</Button>
      <Button asChild variant="outline"><Link to={cancelTo}>Cancelar</Link></Button>
    </div>
  </form>;
}
