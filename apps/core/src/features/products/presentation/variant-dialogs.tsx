import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@core/app/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@core/app/components/ui/dialog";
import { Field, FieldLabel } from "@core/app/components/ui/field";
import { Input } from "@core/app/components/ui/input";
import type { EditorRow, RowPatch } from "@shared/product-variants";

export type BulkKind = "salePrice" | "purchasePrice" | "stock";

export function ConfirmDialog({ title, description, confirm, cancel, onConfirm, onCancel }: Readonly<{
  title: string; description: string; confirm: string; cancel: string; onConfirm: () => void; onCancel: () => void;
}>) {
  return <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
    <DialogContent>
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>{cancel}</Button>
        <Button type="button" onClick={onConfirm}>{confirm}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

const amount = (text: string): number | null => text.trim() === "" ? null : Number(text);

export function BulkDialog({ kind, selected, hidden, newCount, onApply, onClose }: Readonly<{
  kind: BulkKind; selected: number; hidden: number; newCount: number; onApply: (patch: RowPatch) => void; onClose: () => void;
}>) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const applies = kind === "stock" ? newCount : selected;
  const title = { salePrice: t("productEditor.bulkSalePrice"), purchasePrice: t("productEditor.bulkPurchasePrice"), stock: t("productEditor.bulkStock") }[kind];
  const number = amount(text);
  const valid = kind === "purchasePrice" ? true : number !== null && Number.isFinite(number) && number >= (kind === "stock" ? 0 : 0.01);
  function submit(event: FormEvent) {
    // The dialog renders in a portal, but React still bubbles its events to the product form that owns it.
    event.preventDefault();
    event.stopPropagation();
    if (!valid || applies === 0) return;
    onApply(kind === "purchasePrice" ? { purchasePrice: number } : kind === "salePrice" ? { salePrice: number ?? 0 } : { stock: number ?? 0 });
    onClose();
  }
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent>
      <form onSubmit={submit} className="grid gap-4">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{t("productEditor.bulkApplies", { count: selected })}{hidden > 0 && ` ${t("productEditor.bulkHidden", { count: hidden })}`} {kind === "stock" ? t("productEditor.bulkStockNew", { count: newCount }) : t("productEditor.bulkReplaces")}</DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="bulk-value">{title}</FieldLabel>
          <Input id="bulk-value" type="number" inputMode={kind === "stock" ? "numeric" : "decimal"} step={kind === "stock" ? "1" : "0.01"} min={kind === "stock" ? "0" : "0.01"} value={text} onChange={(event) => setText(event.target.value)} autoFocus />
        </Field>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>{t("productEditor.cancel")}</Button>
          <Button type="submit" disabled={!valid || applies === 0}>{t("productEditor.bulkApply", { count: applies })}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

/** A combination that is not saved yet: price, stock and SKU live here until the product is saved. */
export function RowDialog({ row, label, currency, onDone, onRemove, onClose }: Readonly<{
  row: EditorRow; label: string; currency: string; onDone: (patch: RowPatch) => void; onRemove: () => void; onClose: () => void;
}>) {
  const { t } = useTranslation();
  const [values, setValues] = useState({ salePrice: String(row.salePrice), purchasePrice: row.purchasePrice === null ? "" : String(row.purchasePrice), stock: String(row.stock), sku: row.sku ?? "" });
  const field = (key: keyof typeof values, text: string, input: Partial<React.ComponentProps<typeof Input>>) => <Field>
    <FieldLabel htmlFor={`row-${key}`}>{text}</FieldLabel>
    <Input id={`row-${key}`} value={values[key]} onChange={(event) => setValues({ ...values, [key]: event.target.value })} {...input} />
  </Field>;
  function submit(event: FormEvent) {
    event.preventDefault();
    event.stopPropagation();
    onDone({ salePrice: Number(values.salePrice) || 0, purchasePrice: amount(values.purchasePrice), stock: Number(values.stock) || 0, sku: values.sku.trim() === "" ? null : values.sku });
    onClose();
  }
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent>
      <form onSubmit={submit} className="grid gap-4">
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>{t("productEditor.unsavedQr")}</DialogDescription>
        </DialogHeader>
        {field("salePrice", `${t("productEditor.salePrice")} (${currency})`, { type: "number", inputMode: "decimal", step: "0.01", min: "0.01" })}
        {field("purchasePrice", `${t("productEditor.purchasePrice")} (${currency})`, { type: "number", inputMode: "decimal", step: "0.01", min: "0" })}
        {field("stock", t("productEditor.stock"), { type: "number", inputMode: "numeric", step: "1", min: "0" })}
        {field("sku", t("productEditor.sku"), { maxLength: 100 })}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => { onRemove(); onClose(); }}>{t("productEditor.remove")}</Button>
          <Button type="button" variant="outline" onClick={onClose}>{t("productEditor.cancel")}</Button>
          <Button type="submit">{t("productEditor.done")}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
