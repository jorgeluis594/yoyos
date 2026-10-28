import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "@core/app/components/ui/alert";
import { Button } from "@core/app/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@core/app/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@core/app/components/ui/field";
import { Input } from "@core/app/components/ui/input";
import type { ProductDetailResponse } from "@shared/contracts/products";
import { valuesLeftWithoutVariants, variantLabel, type VariantErrors } from "@core/src/features/products/presentation/variant-detail-model";

type Product = ProductDetailResponse["product"];
type Variant = Product["variants"][number];
type Entry = { optionId: string; valueId: string } | { optionId: string; newValue: { id: string; name: string } };

const other = "__other__";

function Removed({ product, variant }: Readonly<{ product: Product; variant: Variant }>) {
  const { t } = useTranslation();
  return <>{valuesLeftWithoutVariants(product, variant).map(({ optionName, valueName }) =>
    <p key={`${optionName}:${valueName}`} className="text-sm text-muted-foreground">{t("variantDetail.valueRemoved", { value: valueName, option: optionName })}</p>)}</>;
}

export function DeactivateDialog({ product, variant, pending, onConfirm, onClose }: Readonly<{ product: Product; variant: Variant; pending: boolean; onConfirm: () => void; onClose: () => void }>) {
  const { t } = useTranslation();
  const label = variantLabel(product, variant);
  const lastActive = variant.status === "active" && product.variants.filter((candidate) => candidate.status === "active").length === 1;
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent>
      <DialogHeader><DialogTitle>{t("variantDetail.deactivateTitle", { label })}</DialogTitle><DialogDescription>{t("variantDetail.deactivateBody")}</DialogDescription></DialogHeader>
      {variant.stock > 0 && <Alert variant="warning"><AlertDescription><strong>{t("variantDetail.deactivateStock", { count: variant.stock })}</strong> {t("variantDetail.deactivateStockHelp")}</AlertDescription></Alert>}
      {lastActive && <Alert variant="warning"><AlertDescription>{t("variantDetail.deactivateLast")}</AlertDescription></Alert>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>{t("variantDetail.cancel")}</Button>
        <Button type="button" variant="destructive" disabled={pending} onClick={onConfirm}>{t("variantDetail.deactivateConfirm")}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

export function DeleteDialog({ product, variant, pending, onConfirm, onClose }: Readonly<{ product: Product; variant: Variant; pending: boolean; onConfirm: () => void; onClose: () => void }>) {
  const { t } = useTranslation();
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent>
      <DialogHeader><DialogTitle>{t("variantDetail.deleteTitle", { label: variantLabel(product, variant) })}</DialogTitle><DialogDescription>{t("variantDetail.deleteBody")}</DialogDescription></DialogHeader>
      <Removed product={product} variant={variant} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>{t("variantDetail.deleteKeep")}</Button>
        <Button type="button" variant="destructive" disabled={pending} onClick={onConfirm}>{t("variantDetail.deleteConfirm")}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

/** One selector per option with the existing values and «Otro valor…», which adds a value at the end of that option. */
export function CombinationDialog({ product, variant, pending, failure, onSave, onReload, onClose }: Readonly<{
  product: Product; variant: Variant; pending: boolean; failure?: VariantErrors; onSave: (values: readonly Entry[]) => void; onReload: () => void; onClose: () => void;
}>) {
  const { t } = useTranslation();
  const label = variantLabel(product, variant);
  const [chosen, setChosen] = useState<Readonly<Record<string, string>>>(Object.fromEntries(variant.combination.map((entry) => [entry.optionId, entry.valueId])));
  const [typed, setTyped] = useState<Readonly<Record<string, string>>>({});
  const [cleared, setCleared] = useState<VariantErrors>();
  const shown = failure !== cleared ? failure : undefined;
  const error = shown?.combination;
  const notice = shown?.inDoubt ?? shown?.form;
  const current = Object.fromEntries(variant.combination.map((entry) => [entry.optionId, entry.valueId]));
  const leaving = valuesLeftWithoutVariants(product, variant).filter(({ optionId }) => chosen[optionId] !== current[optionId]);
  const [ids] = useState(() => new Map<string, string>());
  const newId = (optionId: string) => { if (!ids.has(optionId)) ids.set(optionId, crypto.randomUUID()); return ids.get(optionId)!; };
  const entries = (): readonly Entry[] => product.options.map((option) => chosen[option.id] === other
    ? { optionId: option.id, newValue: { id: newId(option.id), name: typed[option.id] ?? "" } }
    : { optionId: option.id, valueId: chosen[option.id] });
  function submit(event: FormEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (!pending) onSave(entries());
  }
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent>
      <form onSubmit={submit} className="grid gap-4">
        <DialogHeader><DialogTitle>{t("variantDetail.combinationTitle", { label })}</DialogTitle><DialogDescription>{t("variantDetail.combinationHelp", { label })}</DialogDescription></DialogHeader>
        {product.options.map((option) => <Field key={option.id} data-invalid={Boolean(error) || undefined}>
          <FieldLabel htmlFor={`combination-${option.id}`}>{option.name}</FieldLabel>
          <select id={`combination-${option.id}`} className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={chosen[option.id]} aria-invalid={Boolean(error) || undefined}
            onChange={(event) => { setChosen({ ...chosen, [option.id]: event.target.value }); setCleared(failure); }}>
            {option.values.map((value) => <option key={value.id} value={value.id}>{value.name}</option>)}
            <option value={other}>{t("variantDetail.otherValue")}</option>
          </select>
          {chosen[option.id] === other && <Input aria-label={t("variantDetail.otherValueOf", { option: option.name })} value={typed[option.id] ?? ""} maxLength={60} autoFocus
            onChange={(event) => { setTyped({ ...typed, [option.id]: event.target.value }); setCleared(failure); }} />}
        </Field>)}
        {error && <FieldError>{error}</FieldError>}
        {leaving.map(({ optionName, valueName }) => <p key={optionName} className="text-sm text-muted-foreground">{t("variantDetail.valueRemoved", { value: valueName, option: optionName })}</p>)}
        {notice && <Alert variant="destructive"><AlertDescription className="flex flex-wrap items-center gap-3">{notice}
          {shown?.inDoubt && <Button type="button" variant="outline" size="sm" onClick={onReload}>{t("variantDetail.reload")}</Button>}</AlertDescription></Alert>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>{t("variantDetail.cancel")}</Button>
          <Button type="submit" disabled={pending}>{pending ? t("variantDetail.combinationSaving") : t("variantDetail.combinationSave")}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
