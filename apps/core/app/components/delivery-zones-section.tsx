import { useId, useState } from "react";
import { useForm, useFieldArray, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import { Button } from "@core/app/components/ui/button";
import { Input } from "@core/app/components/ui/input";
import { Field, FieldLabel, FieldError, controlClass } from "@core/app/components/ui/field";
import { PeruDistrictMultiSelect } from "@core/app/components/peru-district-multi-select";
import { getPeruDistrict, type PeruDistrictCode } from "@shared/peru-geography";
import { parseDeliveryPrice } from "@core/src/features/delivery-settings/domain/delivery-price";
import type { DeliveryZonesResponse, SaveDeliveryZonesRequest } from "@shared/contracts/delivery-settings";
import { formatCurrency } from "@core/app/format-currency";

const optionDraftSchema = z.object({
  id: z.string().optional(),
  method: z.enum(["home", "agency"]),
  name: z.string().trim().min(1).max(120),
  amount: z.string().regex(/^\d+(?:[.,]\d{1,2})?$/).refine(value => parseDeliveryPrice({ amount: Number(value.replace(",", ".")), currency: "PEN" }, "PEN").success),
  enabled: z.boolean(),
  // Agencies are associated in a later task; saved associations are carried through untouched.
  agencyIds: z.array(z.string()),
});
export const zoneDraftSchema = z.object({
  name: z.string().trim().min(1).max(120),
  districtCodes: z.array(z.string().refine(code => getPeruDistrict(code) !== null)).min(1).refine(codes => new Set(codes).size === codes.length),
  enabled: z.boolean(),
  options: z.array(optionDraftSchema),
}).refine(zone => new Set(zone.options.map(option => option.name.trim().toLowerCase())).size === zone.options.length, { path: ["options"] });
type Draft = z.infer<typeof zoneDraftSchema>;
type Zone = DeliveryZonesResponse["zones"][number];
const empty: Draft = { name: "", districtCodes: [], enabled: true, options: [] };
const emptyOption: Draft["options"][number] = { method: "home", name: "", amount: "", enabled: true, agencyIds: [] };

const toDraft = (zone: Zone): Draft => ({ name: zone.name, districtCodes: zone.districtCodes, enabled: zone.enabled,
  options: zone.options.map(option => ({ id: option.id, method: option.method, name: option.name, amount: String(option.price.amount),
    enabled: option.enabled, agencyIds: option.method === "agency" ? option.agencyIds : [] })) });
const toOptionInput = (option: Draft["options"][number]): SaveDeliveryZonesRequest["zones"][number]["options"][number] => {
  const fields = { name: option.name, enabled: option.enabled, price: { amount: Number(option.amount.replace(",", ".")), currency: "PEN" as const } };
  const identity = option.id ? { kind: "existing" as const, id: option.id } : { kind: "new" as const };
  return option.method === "home" ? { ...identity, method: "home", ...fields } : { ...identity, method: "agency", ...fields, agencyIds: option.agencyIds };
};
const toZoneInput = (zone: Draft, id?: string): SaveDeliveryZonesRequest["zones"][number] => ({
  ...(id ? { kind: "existing" as const, id } : { kind: "new" as const }),
  name: zone.name, enabled: zone.enabled, districtCodes: zone.districtCodes, options: zone.options.map(toOptionInput) });

export function DeliveryZonesSection({ state, pending, error, saved, onSave }: Readonly<{
  state: DeliveryZonesResponse; pending: boolean; error?: string; saved?: DeliveryZonesResponse;
  onSave: (request: SaveDeliveryZonesRequest) => void;
}>) {
  const { t } = useTranslation();
  const id = useId();
  const [editor, setEditor] = useState<{ id: string | null; saved: DeliveryZonesResponse | undefined }>();
  const editing = editor?.saved === saved ? editor?.id : undefined;
  const setEditing = (id: string | null | undefined) => setEditor(id === undefined ? undefined : { id, saved });
  const form = useForm<Draft>({ resolver: zodResolver(zoneDraftSchema), defaultValues: empty });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "options", keyName: "fieldKey" });
  const zones = state.zones;
  const blocked = error === "DELIVERY_SETTINGS_CONFLICT" || error === "INTERNAL_ERROR" || error === "SERVICE_UNAVAILABLE" || error === "PERSISTENCE_UNAVAILABLE";
  const { reset } = form;
  // Every write sends the complete set of zones: the server requires all existing zones and options to be retained.
  const write = (draft?: Draft, toggle?: string) => {
    const inputs: SaveDeliveryZonesRequest["zones"] = zones.map(zone => {
      const values = draft && editing === zone.id ? draft : toDraft(zone);
      return toZoneInput(toggle === zone.id ? { ...values, enabled: !zone.enabled } : values, zone.id);
    });
    if (draft && editing === null) inputs.push(toZoneInput(draft));
    onSave({ expectedVersion: state.version, zones: inputs });
  };
  const price = (amount: number, currency: Zone["options"][number]["price"]["currency"]) => amount === 0 ? t("deliveryZones.free") : formatCurrency(amount, currency, "es");
  return <section className="flex min-w-0 flex-col gap-4" aria-labelledby={`${id}-title`}>
    <h3 id={`${id}-title`} className="text-lg font-semibold">{t("deliveryZones.title")}</h3>
    <p className="text-sm text-muted-foreground">{t("deliveryZones.hint")}</p>
    {(["home", "agency"] as const).filter(method => state[method].enabled && !zones.some(zone => zone.enabled && zone.options.some(option => option.enabled && option.method === method))).map(method =>
      <p key={method} className="text-sm text-muted-foreground">{t(`deliveryZones.missing.${method}`)}</p>)}
    {zones.length === 0 && <p className="text-sm text-muted-foreground">{t("deliveryZones.empty")}</p>}
    <ul className="divide-y divide-border">{zones.map(zone => <li key={zone.id} className="flex min-w-0 flex-col gap-2 py-4">
      <strong className="break-words">{zone.name}</strong>
      <p className="break-words text-sm text-muted-foreground">{zone.districtCodes.map(code => { const district = getPeruDistrict(code); return district ? `${district.name} · ${code}` : code; }).join(", ")}</p>
      <p className="text-sm">{t(zone.enabled ? "deliverySettings.active" : "deliverySettings.inactive")}</p>
      {zone.options.length === 0 && <p className="text-sm text-muted-foreground">{t("deliveryZones.noOptions")}</p>}
      <ul className="flex flex-col gap-1">{zone.options.map(option => <li key={option.id} className="flex flex-wrap justify-between gap-2 text-sm">
        <span className="break-words">{option.name} · {t(`deliveryZones.method.${option.method}`)}{!option.enabled && ` · ${t("deliverySettings.inactive")}`}</span>
        <span>{price(option.price.amount, option.price.currency)}</span>
      </li>)}</ul>
      <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={pending || blocked} onClick={() => { setEditing(zone.id); reset(toDraft(zone)); }}>{t("deliveryZones.edit", { name: zone.name })}</Button>
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
        <Controller name="enabled" control={form.control} render={({ field }) => <label className="flex min-h-touch items-center gap-3">
          <input type="checkbox" checked={field.value} onChange={event => field.onChange(event.target.checked)} className="size-4 accent-primary" />{t("deliveryZones.active")}
        </label>} />
        <div className="flex flex-col gap-4">
          <h4 className="font-semibold">{t("deliveryZones.options")}</h4>
          {fields.length === 0 && <p className="text-sm text-muted-foreground">{t("deliveryZones.noOptions")}</p>}
          {fields.map((option, index) => <div key={option.fieldKey} className="flex min-w-0 flex-col gap-3 border-l-2 border-border pl-3">
            <Controller name={`options.${index}.method`} control={form.control} render={({ field }) => <Field>
              <FieldLabel htmlFor={`${id}-method-${index}`}>{t("deliveryZones.optionMethod")}</FieldLabel>
              {/* A saved option keeps its method: changing it would be rejected by the server. */}
              <select id={`${id}-method-${index}`} className={controlClass} value={field.value} disabled={Boolean(option.id)} onChange={field.onChange} onBlur={field.onBlur}>
                {(["home", "agency"] as const).map(method => <option key={method} value={method}>{t(`deliveryZones.method.${method}`)}</option>)}
              </select>
            </Field>} />
            <Controller name={`options.${index}.name`} control={form.control} render={({ field, fieldState }) => <Field>
              <FieldLabel htmlFor={`${id}-option-name-${index}`}>{t("deliveryZones.optionName")}</FieldLabel><Input {...field} name={undefined} id={`${id}-option-name-${index}`} maxLength={120} aria-invalid={fieldState.invalid} />
              {fieldState.error && <FieldError>{t("deliveryZones.invalidOptionName")}</FieldError>}
            </Field>} />
            <Controller name={`options.${index}.amount`} control={form.control} render={({ field, fieldState }) => <Field>
              <FieldLabel htmlFor={`${id}-amount-${index}`}>{t("deliveryZones.price")}</FieldLabel><Input {...field} name={undefined} id={`${id}-amount-${index}`} inputMode="decimal" aria-invalid={fieldState.invalid} />
              <p className="text-sm text-muted-foreground">{t("deliveryZones.priceHint")}</p>
              {fieldState.error && <FieldError>{t("deliveryZones.invalidPrice")}</FieldError>}
            </Field>} />
            <Controller name={`options.${index}.enabled`} control={form.control} render={({ field }) => <label className="flex min-h-touch items-center gap-3">
              <input type="checkbox" checked={field.value} onChange={event => field.onChange(event.target.checked)} className="size-4 accent-primary" />{t("deliveryZones.optionActive")}
            </label>} />
            {!option.id && <Button type="button" variant="ghost" className="self-start max-md:min-h-touch" onClick={() => remove(index)}>{t("deliveryZones.removeOption")}</Button>}
          </div>)}
          {form.formState.errors.options?.root && <FieldError>{t("deliveryZones.duplicateOption")}</FieldError>}
          <Button type="button" variant="outline" className="self-start max-md:min-h-touch" onClick={() => append(emptyOption)}>{t("deliveryZones.addOption")}</Button>
        </div>
        <div className="flex flex-wrap gap-3"><Button type="button" disabled={pending || blocked} onClick={form.handleSubmit(draft => write(draft))}>{t(pending ? "deliverySettings.saving" : "deliveryZones.save")}</Button>
          <Button type="button" variant="ghost" disabled={pending} onClick={() => { reset(empty); setEditing(undefined); }}>{t("deliveryZones.cancel")}</Button></div>
      </fieldset>}
    {error && <p role="alert" className="text-sm text-destructive">{t(blocked ? "deliveryZones.reloadRequired" : "deliveryZones.invalid")}</p>}
    {blocked && <Button asChild variant="outline" className="self-start"><a href="">{t("deliverySettings.reload")}</a></Button>}
    {saved && !error && editing === undefined && <p role="status">{t("deliveryZones.saved")}</p>}
  </section>;
}
