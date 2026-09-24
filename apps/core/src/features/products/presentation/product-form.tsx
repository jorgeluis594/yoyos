import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { Button } from "@core/app/components/ui/button";
import type { Currency } from "@shared/money";
import type { FormErrors } from "@core/src/features/products/presentation/messages";

export type ProductFormValues = Readonly<{ name: string; description: string; sku: string; salePrice: string; purchasePrice: string; initialStock: string }>;
export const emptyProductFormValues: ProductFormValues = { name: "", description: "", sku: "", salePrice: "", purchasePrice: "", initialStock: "" };

const inputClass = "min-h-control w-full rounded-md border border-input bg-background px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function ProductForm({ currency, cancelTo, errors, pending, onSave, values: initialValues = emptyProductFormValues, variantFields = "editable", stock, submitLabel = "Guardar producto" }: {
  currency: Currency;
  cancelTo: string;
  errors: FormErrors;
  pending: boolean;
  onSave: (values: ProductFormValues) => void;
  values?: ProductFormValues;
  variantFields?: "editable" | "hidden";
  stock?: number;
  submitLabel?: string;
}) {
  const [values, setValues] = useState<ProductFormValues>(initialValues);
  const fields: readonly (keyof ProductFormValues)[] = variantFields === "hidden"
    ? ["name", "description", "initialStock"]
    : ["name", "description", "sku", "salePrice", "purchasePrice", "initialStock"];

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave(values);
  }

  return <form onSubmit={save} noValidate className="mt-8 flex flex-col gap-6">
    {variantFields === "hidden" && <p className="text-sm text-muted-foreground">Este producto tiene varias variantes. Solo puedes editar el nombre y la descripción.</p>}
    <div className="grid gap-5 sm:grid-cols-2">
      {fields.map((key) => {
        const readOnlyStock = key === "initialStock" && stock !== undefined;
        const label = { name: "Nombre", description: "Descripción", sku: "SKU", salePrice: `Precio de venta (${currency})`, purchasePrice: `Precio de compra (${currency})`, initialStock: stock === undefined ? "Stock inicial" : "Stock" }[key];
        const wide = key === "name" || key === "description";
        return <div key={key} className={wide ? "sm:col-span-2" : ""}>
          <label htmlFor={key} className="mb-1.5 block text-sm font-medium">{label}{key === "name" || key === "salePrice" ? " *" : ""}</label>
          {readOnlyStock ? <input id={key} name={key} value={stock ?? ""} readOnly aria-readonly="true" className={`${inputClass} bg-muted text-muted-foreground`} /> :
            key === "description" ? <textarea id={key} name={key} value={values[key]} onChange={(event) => setValues({ ...values, [key]: event.target.value })} maxLength={5000} rows={4} className={inputClass} aria-invalid={!!errors[key]} aria-describedby={errors[key] ? `${key}-error` : undefined} /> :
            <input id={key} name={key} value={values[key]} onChange={(event) => setValues({ ...values, [key]: event.target.value })} type={key === "salePrice" || key === "purchasePrice" || key === "initialStock" ? "number" : "text"} inputMode={key === "initialStock" ? "numeric" : key === "salePrice" || key === "purchasePrice" ? "decimal" : undefined} step={key === "initialStock" ? "1" : key === "salePrice" || key === "purchasePrice" ? "0.01" : undefined} min={key === "salePrice" ? "0.01" : key === "purchasePrice" || key === "initialStock" ? "0" : undefined} maxLength={key === "name" ? 200 : key === "sku" ? 100 : undefined} className={inputClass} aria-invalid={!!errors[key]} aria-describedby={errors[key] ? `${key}-error` : undefined} />}
          {errors[key] && <p id={`${key}-error`} role="alert" className="mt-1 text-sm text-destructive">{errors[key]}</p>}
        </div>;
      })}
    </div>
    {errors.form && <p role="alert" className="text-sm text-destructive">{errors.form}</p>}
    <div className="flex flex-wrap gap-3 border-t border-border pt-5">
      <Button type="submit" disabled={pending}>{pending ? "Guardando…" : submitLabel}</Button>
      <Button asChild variant="outline"><Link to={cancelTo}>Cancelar</Link></Button>
    </div>
  </form>;
}
