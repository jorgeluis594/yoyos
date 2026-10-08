import { useId, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import { Button } from "@core/app/components/ui/button";
import { Input } from "@core/app/components/ui/input";
import { Field, FieldLabel, FieldError } from "@core/app/components/ui/field";
import { PeruDistrictMultiSelect } from "@core/app/components/peru-district-multi-select";
import { getPeruDistrict, type PeruDistrictCode } from "@shared/peru-geography";
import { parseDeliveryPrice } from "@core/src/features/delivery-settings/domain/delivery-price";
import type { DeliveryZonesResponse, SaveDeliveryZonesRequest } from "@shared/contracts/delivery-settings";
import { formatCurrency } from "@core/app/format-currency";

export const zoneDraftSchema = z.object({
  name: z.string().trim().min(1).max(120),
  amount: z.string().regex(/^\d+(?:[.,]\d{1,2})?$/).refine(value => parseDeliveryPrice({ amount: Number(value.replace(",", ".")), currency: "PEN" }, "PEN").success),
  districtCodes: z.array(z.string().refine(code => getPeruDistrict(code) !== null)).min(1).refine(codes => new Set(codes).size === codes.length),
  enabled: z.boolean(),
});
type Draft = z.infer<typeof zoneDraftSchema>;
const empty: Draft = { name: "", amount: "", districtCodes: [], enabled: true };

export function DeliveryZonesSection({ method, state, pending, error, saved, onSave }: Readonly<{
  method: "home" | "agency"; state: DeliveryZonesResponse; pending: boolean; error?: string; saved?: DeliveryZonesResponse;
  onSave: (request: SaveDeliveryZonesRequest) => void;
}>) {
  const { t } = useTranslation();
  const id = useId();
  const [editor, setEditor] = useState<{ id: string | null; saved: DeliveryZonesResponse | undefined }>();
  const editing = editor?.saved === saved ? editor?.id : undefined;
  const setEditing = (id: string | null | undefined) => setEditor(id === undefined ? undefined : { id, saved });
  const form = useForm<Draft>({ resolver: zodResolver(zoneDraftSchema), defaultValues: empty });
  const zones = state.zones.filter(zone => zone.method === method);
  const blocked = error === "DELIVERY_SETTINGS_CONFLICT" || error === "INTERNAL_ERROR" || error === "SERVICE_UNAVAILABLE" || error === "PERSISTENCE_UNAVAILABLE";
  const { reset } = form;
  const write = (draft?: Draft, toggle?: string) => {
    const inputs: SaveDeliveryZonesRequest["zones"] = zones.map(zone => {
      const values = draft && editing === zone.id ? { name: draft.name, districtCodes: draft.districtCodes,
        enabled: draft.enabled, price: { amount: Number(draft.amount.replace(",", ".")), currency: "PEN" as const } } : zone;
      return { kind: "existing", id: zone.id, name: values.name, districtCodes: values.districtCodes,
        enabled: toggle === zone.id ? !zone.enabled : values.enabled, price: values.price };
    });
    if (draft && editing === null) inputs.push({ kind: "new", name: draft.name, enabled: draft.enabled,
      districtCodes: draft.districtCodes, price: { amount: Number(draft.amount.replace(",", ".")), currency: "PEN" } });
    onSave({ method, expectedVersion: state.version, zones: inputs });
  };
  return <section className="mt-6 flex min-w-0 flex-col gap-4" aria-labelledby={`${id}-title`}>
    <h3 id={`${id}-title`} className="text-lg font-semibold">{t("deliveryZones.title")}</h3>
    <p className="text-sm text-muted-foreground">{t("deliveryZones.hint")}</p>
    {state[method].enabled && !zones.some(zone => zone.enabled) && <p role="status">{t("deliveryZones.missing")}</p>}
    {zones.length === 0 && <p className="text-sm text-muted-foreground">{t("deliveryZones.empty")}</p>}
    <ul className="divide-y divide-border">{zones.map(zone => <li key={zone.id} className="flex min-w-0 flex-col gap-2 py-4">
      <div className="flex flex-wrap justify-between gap-2"><strong className="break-words">{zone.name}</strong><span>{zone.price.amount === 0 ? t("deliveryZones.free") : formatCurrency(zone.price.amount, zone.price.currency, "es")}</span></div>
      <p className="break-words text-sm text-muted-foreground">{zone.districtCodes.map(code => { const district = getPeruDistrict(code); return district ? `${district.name} · ${code}` : code; }).join(", ")}</p>
      <p className="text-sm">{t(zone.enabled ? "deliverySettings.active" : "deliverySettings.inactive")}</p>
      <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={pending || blocked} onClick={() => {
        setEditing(zone.id); reset({ name: zone.name, amount: String(zone.price.amount), districtCodes: zone.districtCodes, enabled: zone.enabled });
      }}>{t("deliveryZones.edit", { name: zone.name })}</Button>
        <Button type="button" variant="ghost" disabled={pending || blocked || editing !== undefined} onClick={() => write(undefined, zone.id)}>{t(zone.enabled ? "deliveryZones.disable" : "deliveryZones.enable", { name: zone.name })}</Button></div>
    </li>)}</ul>
    {editing === undefined ? <Button type="button" variant="outline" className="self-start max-md:min-h-touch" disabled={pending || blocked} onClick={() => { reset(empty); setEditing(null); }}>{t("deliveryZones.add")}</Button> :
      <fieldset disabled={pending || blocked} className="flex min-w-0 flex-col gap-4 border-t border-border pt-4" onKeyDown={event => {
        if (event.key === "Enter" && event.target instanceof HTMLInputElement) { event.preventDefault(); void form.handleSubmit(draft => write(draft))(); }
      }}>
        <legend className="font-semibold">{t(editing === null ? "deliveryZones.add" : "deliveryZones.editor")}</legend>
        <Controller name="name" control={form.control} render={({ field, fieldState }) => <Field>
          <FieldLabel htmlFor={`${id}-name`}>{t("deliveryZones.name")}</FieldLabel><Input {...field} name={undefined} id={`${id}-name`} maxLength={120} aria-invalid={fieldState.invalid} />
          {fieldState.error && <FieldError>{t("deliveryZones.invalidName")}</FieldError>}
        </Field>} />
        <Controller name="districtCodes" control={form.control} render={({ field, fieldState }) => <Field>
          <PeruDistrictMultiSelect value={field.value as PeruDistrictCode[]} onChange={field.onChange} />
          {fieldState.error && <FieldError>{t("deliveryZones.invalidDistricts")}</FieldError>}
        </Field>} />
        <Controller name="amount" control={form.control} render={({ field, fieldState }) => <Field>
          <FieldLabel htmlFor={`${id}-amount`}>{t("deliveryZones.price")}</FieldLabel><Input {...field} name={undefined} id={`${id}-amount`} inputMode="decimal" aria-invalid={fieldState.invalid} />
          <p className="text-sm text-muted-foreground">{t("deliveryZones.priceHint")}</p>
          {fieldState.error && <FieldError>{t("deliveryZones.invalidPrice")}</FieldError>}
        </Field>} />
        <Controller name="enabled" control={form.control} render={({ field }) => <label className="flex min-h-touch items-center gap-3">
          <input type="checkbox" checked={field.value} onChange={event => field.onChange(event.target.checked)} className="size-4 accent-primary" />{t("deliveryZones.active")}
        </label>} />
        <div className="flex flex-wrap gap-3"><Button type="button" disabled={pending || blocked} onClick={form.handleSubmit(draft => write(draft))}>{t(pending ? "deliverySettings.saving" : "deliveryZones.save")}</Button>
          <Button type="button" variant="ghost" disabled={pending} onClick={() => { reset(empty); setEditing(undefined); }}>{t("deliveryZones.cancel")}</Button></div>
      </fieldset>}
    {error && <p role="alert" className="text-sm text-destructive">{t(blocked ? "deliveryZones.reloadRequired" : "deliveryZones.invalid")}</p>}
    {blocked && <Button asChild variant="outline" className="self-start"><a href="">{t("deliverySettings.reload")}</a></Button>}
    {saved && !error && editing === undefined && <p role="status">{t("deliveryZones.saved")}</p>}
  </section>;
}
