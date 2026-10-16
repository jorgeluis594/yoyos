import { useId, useState } from "react";
import { useForm, useFieldArray, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import { Package, Truck } from "lucide-react";
import { Button } from "@core/app/components/ui/button";
import { Input } from "@core/app/components/ui/input";
import { Field, FieldLabel, FieldError, FieldDescription, FieldLegend, FieldSet } from "@core/app/components/ui/field";
import { Card, CardContent, CardHeader, CardTitle } from "@core/app/components/ui/card";
import { Checkbox } from "@core/app/components/ui/checkbox";
import { Alert, AlertDescription } from "@core/app/components/ui/alert";
import { PeruDistrictMultiSelect } from "@core/app/components/peru-district-multi-select";
import { getPeruDistrict, type PeruDistrictCode } from "@shared/peru-geography";
import { parseDeliveryPrice } from "@core/src/features/delivery-settings/domain/delivery-price";
import type { CourierCatalogResponse, DeliverySettingsResponse, DeliveryZonesResponse, SaveDeliveryZonesRequest } from "@shared/contracts/delivery-settings";
import { formatCurrency } from "@core/app/format-currency";
import { AgencyPicker } from "@core/app/components/agency-picker";

const optionDraftSchema = z.object({
  id: z.string().optional(),
  method: z.enum(["home", "agency"]),
  name: z.string().trim().min(1).max(120),
  amount: z.string().regex(/^\d+(?:[.,]\d{1,2})?$/).refine(value => parseDeliveryPrice({ amount: Number(value.replace(",", ".")), currency: "PEN" }, "PEN").success),
  enabled: z.boolean(),
  agencyIds: z.array(z.string()),
// Saved agency options without agencies stay saveable, as the server accepts them; only new ones must pick an agency.
}).refine(option => option.method === "home" || option.id !== undefined || option.agencyIds.length > 0, { path: ["agencyIds"] });
export const zoneDraftSchema = z.object({
  name: z.string().trim().min(1).max(120),
  districtCodes: z.array(z.string().refine(code => getPeruDistrict(code) !== null)).min(1).refine(codes => new Set(codes).size === codes.length),
  enabled: z.boolean(),
  options: z.array(optionDraftSchema),
}).refine(zone => new Set(zone.options.map(option => option.name.trim().toLowerCase())).size === zone.options.length, { path: ["options"] });
type Draft = z.infer<typeof zoneDraftSchema>;
type Zone = DeliveryZonesResponse["zones"][number];
const empty: Draft = { name: "", districtCodes: [], enabled: true, options: [] };

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

/** The first free name in the zone: the courier name, then "Olva 2", "Olva 3"… */
export const uniqueOptionName = (base: string, taken: readonly string[]) => {
  const used = new Set(taken.map(name => name.trim().toLowerCase()));
  let name = base;
  for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} ${n}`;
  return name;
};
/** The option name after a courier change: it follows the courier while empty or still the name generated for the previous courier. */
export const courierOptionName = (name: string, previous: string | undefined, next: string, taken: readonly string[]) =>
  !name.trim() || (previous !== undefined && name.trim() === uniqueOptionName(previous, taken)) ? uniqueOptionName(next, taken) : name;

type Courier = DeliverySettingsResponse["couriers"][number];
type Option = Zone["options"][number];
/** An agency option is only offered when an associated agency is enabled and so is its courier (the catalog rows are checked server-side). */
export const hasEligibleAgency = (option: Option, state: DeliveryZonesResponse, couriers: readonly Courier[]) => option.method === "agency" &&
  option.agencyIds.some(id => { const agency = state.agencies.find(value => value.id === id); return agency?.enabled && couriers.some(courier => courier.courierId === agency.courierId && courier.enabled); });

export function DeliveryZonesSection({ state, couriers, catalog, pending, error, saved, onSave }: Readonly<{
  state: DeliveryZonesResponse; couriers: readonly Courier[]; catalog: CourierCatalogResponse["couriers"]; pending: boolean; error?: string; saved?: DeliveryZonesResponse;
  onSave: (request: SaveDeliveryZonesRequest) => void;
}>) {
  const { t } = useTranslation();
  const id = useId();
  const [editor, setEditor] = useState<{ id: string | null; saved: DeliveryZonesResponse | undefined }>();
  const editing = editor?.saved === saved ? editor?.id : undefined;
  const setEditing = (id: string | null | undefined) => setEditor(id === undefined ? undefined : { id, saved });
  const form = useForm<Draft>({ resolver: zodResolver(zoneDraftSchema), defaultValues: empty });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "options", keyName: "fieldKey" });
  const catalogCouriers = catalog.map(courier => ({ courierId: courier.id, name: courier.name }));
  // An agency option starts named after the first courier, unique in the zone; choosing another courier renames it while the name is untouched.
  const newOption = (method: Draft["options"][number]["method"]): Draft["options"][number] => ({ method,
    name: method === "agency" && catalog[0] ? uniqueOptionName(catalog[0].name, form.getValues("options").map(option => option.name)) : "", amount: "", enabled: true, agencyIds: [] });
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
  return <Card id="delivery-zones" className="min-w-0 scroll-mt-6" role="region" aria-labelledby={`${id}-title`}>
    <CardHeader><CardTitle id={`${id}-title`}>{t("deliveryZones.title")}</CardTitle></CardHeader>
    <CardContent className="flex min-w-0 flex-col gap-4">
    <FieldDescription>{t("deliveryZones.hint")}</FieldDescription>
    {(["home", "agency"] as const).filter(method => state[method].enabled && !zones.some(zone => zone.enabled && zone.options.some(option => option.enabled && option.method === method))).map(method =>
      <FieldDescription key={method}>{t(`deliveryZones.missing.${method}`)}</FieldDescription>)}
    {zones.length === 0 && <FieldDescription>{t("deliveryZones.empty")}</FieldDescription>}
    <ul className="divide-y divide-border">{zones.map(zone => <li key={zone.id} className="flex min-w-0 flex-col gap-2 py-4">
      <strong className="break-words">{zone.name}</strong>
      <p className="break-words text-sm text-muted-foreground">{zone.districtCodes.map(code => { const district = getPeruDistrict(code); return district ? `${district.name} · ${code}` : code; }).join(", ")}</p>
      <p className="text-sm">{t(zone.enabled ? "deliverySettings.active" : "deliverySettings.inactive")}</p>
      {zone.options.length === 0 && <p className="text-sm text-muted-foreground">{t("deliveryZones.noOptions")}</p>}
      <ul className="flex flex-col gap-1">{zone.options.map(option => <li key={option.id} className="flex flex-wrap justify-between gap-2 text-sm">
        <span className="break-words">{option.name} · {t(`deliveryZones.method.${option.method}`)}{!option.enabled && ` · ${t("deliverySettings.inactive")}`}
          {option.method === "agency" && !hasEligibleAgency(option, state, couriers) && <em className="block not-italic text-muted-foreground">{t("deliveryZones.noEligibleAgencies")}</em>}</span>
        <span>{price(option.price.amount, option.price.currency)}</span>
      </li>)}</ul>
      <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={pending || blocked} onClick={() => { setEditing(zone.id); reset(toDraft(zone)); }}>{t("deliveryZones.edit", { name: zone.name })}</Button>
        <Button type="button" variant="ghost" disabled={pending || blocked || editing !== undefined} onClick={() => write(undefined, zone.id)}>{t(zone.enabled ? "deliveryZones.disable" : "deliveryZones.enable", { name: zone.name })}</Button></div>
    </li>)}</ul>
    {editing === undefined ? <Button type="button" variant="outline" className="self-start max-md:min-h-touch" disabled={pending || blocked} onClick={() => { reset(empty); setEditing(null); }}>{t("deliveryZones.add")}</Button> :
      <FieldSet disabled={pending || blocked} className="border-t border-border pt-4" onKeyDown={event => {
        if (event.key === "Enter" && event.target instanceof HTMLInputElement) { event.preventDefault(); void form.handleSubmit(draft => write(draft))(); }
      }}>
        <FieldLegend>{t(editing === null ? "deliveryZones.add" : "deliveryZones.editor")}</FieldLegend>
        <Controller name="name" control={form.control} render={({ field, fieldState }) => <Field>
          <FieldLabel htmlFor={`${id}-name`}>{t("deliveryZones.name")}</FieldLabel><Input {...field} name={undefined} id={`${id}-name`} maxLength={120} aria-invalid={fieldState.invalid} />
          {fieldState.error && <FieldError>{t("deliveryZones.invalidName")}</FieldError>}
        </Field>} />
        <Controller name="districtCodes" control={form.control} render={({ field, fieldState }) => <Field>
          <PeruDistrictMultiSelect value={field.value as PeruDistrictCode[]} onChange={field.onChange} />
          {fieldState.error && <FieldError>{t("deliveryZones.invalidDistricts")}</FieldError>}
        </Field>} />
        <Controller name="enabled" control={form.control} render={({ field }) => <Field orientation="horizontal">
          <Checkbox id={`${id}-active`} checked={field.value} onCheckedChange={checked => field.onChange(checked === true)} /><FieldLabel htmlFor={`${id}-active`}>{t("deliveryZones.active")}</FieldLabel>
        </Field>} />
        <div className="flex flex-col gap-4">
          <h4 className="font-semibold">{t("deliveryZones.options")}</h4>
          {fields.length === 0 && <FieldDescription>{t("deliveryZones.noOptions")}</FieldDescription>}
          {fields.map((option, index) => {
            // A saved option keeps its method: changing it would be rejected by the server.
            const method = option.method;
            const Icon = method === "home" ? Truck : Package;
            return <section key={option.fieldKey} aria-labelledby={`${id}-option-${index}-title`} className="flex min-w-0 flex-col gap-4 rounded-[var(--radius-card)] border border-border p-4">
              <div className="flex items-center gap-2">
                <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                <h5 id={`${id}-option-${index}-title`} className="flex-1 text-sm font-semibold">{t(`deliveryZones.optionTitle.${method}`)}</h5>
                {!option.id && <Button type="button" variant="ghost" className="max-md:min-h-touch" onClick={() => remove(index)}>{t("deliveryZones.removeOption")}</Button>}
              </div>
              {method === "agency" && <Controller name={`options.${index}.agencyIds`} control={form.control} render={({ field, fieldState }) => <div className="flex min-w-0 flex-col gap-2">
                <AgencyPicker id={`${id}-agencies-${index}`} couriers={catalogCouriers} knownCouriers={couriers} known={state.agencies} value={field.value} onChange={field.onChange}
                  errorId={fieldState.error ? `${id}-agencies-${index}-error` : undefined}
                  onCourierChange={(courier, previous) => {
                    const options = form.getValues("options");
                    const current = options[index]?.name ?? "";
                    const name = courierOptionName(current, previous?.name, courier.name, options.filter((_, other) => other !== index).map(option => option.name));
                    if (name !== current) form.setValue(`options.${index}.name`, name, { shouldDirty: true });
                  }} />
                {fieldState.error && <FieldError id={`${id}-agencies-${index}-error`}>{t("deliveryZones.agenciesRequired")}</FieldError>}
              </div>} />}
              <div className="grid gap-4 sm:grid-cols-2">
                <Controller name={`options.${index}.name`} control={form.control} render={({ field, fieldState }) => <Field>
                  <FieldLabel htmlFor={`${id}-option-name-${index}`}>{t("deliveryZones.optionName")}</FieldLabel><Input {...field} name={undefined} id={`${id}-option-name-${index}`} maxLength={120} aria-invalid={fieldState.invalid} />
                  {fieldState.error && <FieldError>{t("deliveryZones.invalidOptionName")}</FieldError>}
                </Field>} />
                <Controller name={`options.${index}.amount`} control={form.control} render={({ field, fieldState }) => <Field>
                  <FieldLabel htmlFor={`${id}-amount-${index}`}>{t("deliveryZones.price")}</FieldLabel><Input {...field} name={undefined} id={`${id}-amount-${index}`} inputMode="decimal" aria-invalid={fieldState.invalid} aria-describedby={`${id}-amount-${index}-hint`} />
                  {fieldState.error && <FieldError>{t("deliveryZones.invalidPrice")}</FieldError>}
                </Field>} />
              </div>
              <FieldDescription id={`${id}-amount-${index}-hint`} className="-mt-2">{t("deliveryZones.priceHint")}</FieldDescription>
              <Controller name={`options.${index}.enabled`} control={form.control} render={({ field }) => <Field orientation="horizontal">
                <Checkbox id={`${id}-option-active-${index}`} checked={field.value} onCheckedChange={checked => field.onChange(checked === true)} /><FieldLabel htmlFor={`${id}-option-active-${index}`}>{t("deliveryZones.optionActive")}</FieldLabel>
              </Field>} />
            </section>;
          })}
          {form.formState.errors.options?.root && <FieldError>{t("deliveryZones.duplicateOption")}</FieldError>}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" className="max-md:min-h-touch" onClick={() => append(newOption("home"))}><Truck aria-hidden="true" />{t("deliveryZones.addHomeOption")}</Button>
            {catalog.length > 0 && <Button type="button" variant="outline" className="max-md:min-h-touch" onClick={() => append(newOption("agency"))}><Package aria-hidden="true" />{t("deliveryZones.addAgencyOption")}</Button>}
          </div>
          {catalog.length === 0 && <FieldDescription>{t("deliveryZones.noCatalog")}</FieldDescription>}
        </div>
        <div className="flex flex-wrap gap-3"><Button type="button" disabled={pending || blocked} onClick={form.handleSubmit(draft => write(draft))}>{t(pending ? "deliverySettings.saving" : "deliveryZones.save")}</Button>
          <Button type="button" variant="ghost" disabled={pending} onClick={() => { reset(empty); setEditing(undefined); }}>{t("deliveryZones.cancel")}</Button></div>
      </FieldSet>}
    {error && <Alert variant="destructive"><AlertDescription>{t(blocked ? "deliveryZones.reloadRequired" : "deliveryZones.invalid")}</AlertDescription></Alert>}
    {blocked && <Button asChild variant="outline" className="self-start"><a href="">{t("deliverySettings.reload")}</a></Button>}
    {saved && !error && editing === undefined && <Alert variant="success"><AlertDescription>{t("deliveryZones.saved")}</AlertDescription></Alert>}
    </CardContent>
  </Card>;
}
