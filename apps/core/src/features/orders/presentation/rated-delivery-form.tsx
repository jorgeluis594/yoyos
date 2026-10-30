import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DeliverySettingsResponse } from "@shared/contracts/delivery-settings";
import type { QuotationResponse } from "@shared/contracts/quotations";
import type { Money } from "@shared/money";
import { getPeruDistrict } from "@shared/peru-geography";
import { requestDeliveryQuotation } from "@core/src/features/delivery-settings/infrastructure/quotation-api";
import { PeruDistrictSelect } from "@core/app/components/peru-district-select";
import { agencyLabel, rateLabel } from "@core/app/rate-label";
import { useClientReady } from "@core/app/use-client-ready";
import { formatCurrency } from "@core/app/format-currency";
import { Button } from "@core/app/components/ui/button";
import { Input } from "@core/app/components/ui/input";
import { Field, FieldLabel, FieldSet } from "@core/app/components/ui/field";
import { Alert, AlertDescription } from "@core/app/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@core/app/components/ui/select";

export type QuotedPlace = Readonly<{ districtCode: string | null; rateId: string; agencyId: string; ratePrice: Money | null; address: string; instructions: string }>;

/**
 * The place half of a delivery, controlled by the order view: district, quoted rate, agency and, for a home delivery, the address.
 * It quotes again whenever the district changes and reports the chosen rate's price with the rate, so the view can send it as the expected price.
 */
export function QuotedPlaceFields({ method, place, settings, disabled, invalid, idPrefix, onChange, quoting = true, requote = 0 }: Readonly<{
  method: "home" | "agency" | "store"; place: QuotedPlace; settings: DeliverySettingsResponse; disabled: boolean; invalid: ReadonlySet<string>; idPrefix: string;
  onChange: (place: QuotedPlace) => void;
  /** False while the place is the saved one: nothing is quoted and no rate is offered until the seller changes the district. */
  quoting?: boolean;
  /** Grows when a save was refused for a stale rate: the place quotes again even though the district did not change. */
  requote?: number;
}>) {
  const { t, i18n } = useTranslation();
  const ready = useClientReady();
  const [retry, setRetry] = useState(0);
  const [received, setReceived] = useState<{ key: string; quotation: QuotationResponse | null } | null>(null);
  const key = JSON.stringify([method, place.districtCode, retry, requote, settings.version]);
  const current = quoting && received?.key === key ? received : null;
  const rates = current?.quotation?.rates.filter(rate => rate.method === method) ?? [];
  const agencies = rates.find(rate => rate.id === place.rateId)?.method === "agency" ? (rates.find(rate => rate.id === place.rateId) as Extract<typeof rates[number], { method: "agency" }>).agencies : [];
  const quotes = quoting && method !== "store" && place.districtCode !== null && !disabled;
  // A new quotation carries new rate ids: a rate chosen from an older one is no longer valid, so it is cleared instead of sent stale.
  const staleRate = current?.quotation != null && place.rateId !== "" && !rates.some(item => item.id === place.rateId);
  useEffect(() => { if (staleRate) onChange({ ...place, rateId: "", agencyId: "", ratePrice: null }); }, [staleRate, place, onChange]);
  useEffect(() => {
    if (current || !quotes || !place.districtCode) return;
    const controller = new AbortController();
    void requestDeliveryQuotation({ districtCode: place.districtCode }, controller.signal).then(result => {
      if (!controller.signal.aborted) setReceived({ key, quotation: result.success ? result.data : null });
    });
    return () => controller.abort();
  }, [current, quotes, place.districtCode, key]);
  const text = (name: "address" | "instructions", label: string, required: boolean) => <Field data-invalid={invalid.has(name)}>
    <FieldLabel htmlFor={`${idPrefix}-${name}`}>{label}</FieldLabel>
    <Input id={`${idPrefix}-${name}`} value={place[name]} required={required} aria-invalid={invalid.has(name)} onChange={event => onChange({ ...place, [name]: event.target.value })} /></Field>;
  const rateItems = rates.map(item => ({ value: item.id, label: `${rateLabel(item, rates)} · ${item.price.amount === 0 ? t("deliveryZones.free") : formatCurrency(item.price.amount, item.price.currency, i18n.language)}` }));
  const agencyItems = agencies.map(item => ({ value: item.id, label: agencyLabel(item) }));
  const pickup = settings.store.pickupPoint;
  if (method === "store") return pickup ? <p>{pickup.name} · {pickup.address}{pickup.instructions && <> · {pickup.instructions}</>}</p> : null;
  return <FieldSet disabled={disabled || !ready} className="flex min-w-0 flex-col gap-4">
    <Field data-invalid={invalid.has("districtCode")}><div id={`${idPrefix}-districtCode`} tabIndex={-1} className="min-w-0 outline-none">
      <PeruDistrictSelect value={place.districtCode ? getPeruDistrict(place.districtCode)?.code ?? null : null} disabled={disabled}
        onChange={code => onChange({ ...place, districtCode: code, rateId: "", agencyId: "", ratePrice: null })} /></div></Field>
    {quotes && !current && <Alert><AlertDescription>{t("orderDelivery.quoting")}</AlertDescription></Alert>}
    {current && !current.quotation && <Alert variant="destructive"><AlertDescription>{t("orderDelivery.quoteError")}</AlertDescription>
      <Button type="button" variant="outline" onClick={() => setRetry(value => value + 1)}>{t("orderDelivery.retryRates")}</Button></Alert>}
    {current?.quotation && rates.length === 0 && <Alert><AlertDescription>{t("orderDelivery.noRates")}</AlertDescription></Alert>}
    {rates.length > 0 && <Field data-invalid={invalid.has("rateId")}><FieldLabel htmlFor={`${idPrefix}-rateId`}>{t("orderDelivery.rate")}</FieldLabel>
      <Select items={rateItems} value={rates.some(item => item.id === place.rateId) ? place.rateId : null} onValueChange={value => {
        const chosen = rates.find(item => item.id === value);
        onChange({ ...place, rateId: String(value ?? ""), ratePrice: chosen?.price ?? null, agencyId: chosen?.method === "agency" && chosen.agencies.length === 1 ? chosen.agencies[0].id : "" });
      }}><SelectTrigger id={`${idPrefix}-rateId`} aria-invalid={invalid.has("rateId")}><SelectValue placeholder={t("orderDelivery.chooseRate")} /></SelectTrigger>
        <SelectContent>{rateItems.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></Field>}
    {rates.length === 0 && quoting && invalid.has("rateId") && <Field data-invalid><FieldLabel htmlFor={`${idPrefix}-rateId`}>{t("orderDelivery.rate")}</FieldLabel>
      <div id={`${idPrefix}-rateId`} tabIndex={-1} className="text-sm text-muted-foreground outline-none">{t("orderDelivery.chooseRate")}</div></Field>}
    {agencies.length > 0 && <Field data-invalid={invalid.has("agencyId")}><FieldLabel htmlFor={`${idPrefix}-agencyId`}>{t("orderDelivery.agency")}</FieldLabel>
      <Select items={agencyItems} value={agencies.some(item => item.id === place.agencyId) ? place.agencyId : null} onValueChange={value => onChange({ ...place, agencyId: String(value ?? "") })}>
        <SelectTrigger id={`${idPrefix}-agencyId`} aria-invalid={invalid.has("agencyId")}><SelectValue placeholder={t("orderDelivery.chooseAgency")} /></SelectTrigger>
        <SelectContent>{agencyItems.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></Field>}
    {method === "home" && <>{text("address", t("orderDelivery.address"), true)}{text("instructions", t("orderDelivery.instructions"), false)}</>}
  </FieldSet>;
}
