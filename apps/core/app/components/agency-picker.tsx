import { useEffect, useState } from "react";
import { Button } from "@core/app/components/ui/button";
import { Input } from "@core/app/components/ui/input";
import { Field, FieldDescription, FieldLabel } from "@core/app/components/ui/field";
import { Checkbox } from "@core/app/components/ui/checkbox";
import { Alert, AlertDescription } from "@core/app/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@core/app/components/ui/select";
import { useTranslation } from "react-i18next";
import type { CatalogAgencyContract } from "@shared/contracts/delivery-settings";
import { filterAgencies } from "@shared/agency-search";
import { readAgencyCatalog, type AgencyCatalogClientError } from "@core/src/features/delivery-settings/infrastructure/agency-catalog-api";

const maxShown = 50;

export const describeAgency = (agency: CatalogAgencyContract) => `${agency.name} · ${agency.location.district} · ${agency.address}`;

type Courier = Readonly<{ courierId: string; name: string }>;

/** Chooses the catalog agencies of an agency option: selected ones on top, the courier's catalog below with a search box. */
export function AgencyPicker({ id, couriers, known, value, onChange }: Readonly<{
  id: string; couriers: readonly Courier[]; known: readonly CatalogAgencyContract[]; value: readonly string[]; onChange: (agencyIds: string[]) => void;
}>) {
  const { t } = useTranslation();
  const [chosenCourierId, setCourierId] = useState(couriers[0]?.courierId ?? "");
  const courierId = couriers.some(courier => courier.courierId === chosenCourierId) ? chosenCourierId : couriers[0]?.courierId ?? "";
  const [query, setQuery] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; agencies: readonly CatalogAgencyContract[] | null; error: AgencyCatalogClientError | null }>();
  const [picked, setPicked] = useState<ReadonlyMap<string, CatalogAgencyContract>>(new Map());
  const key = `${courierId}/${attempt}`;
  const current = loaded?.key === key ? loaded : null;
  useEffect(() => {
    if (!courierId) return;
    let active = true;
    void readAgencyCatalog(courierId).then(result => {
      if (active) setLoaded({ key, agencies: result.success ? result.data.agencies : null, error: result.success ? null : result.error });
    });
    return () => { active = false; };
  }, [courierId, key]);
  const details = new Map([...known, ...picked.values()].map(agency => [agency.id, agency] as const));
  const toggle = (agency: CatalogAgencyContract) => {
    if (value.includes(agency.id)) return onChange(value.filter(item => item !== agency.id));
    setPicked(previous => new Map(previous).set(agency.id, agency));
    onChange([...value, agency.id]);
  };
  const matches = current?.agencies ? filterAgencies(current.agencies, query) : [];
  return <div className="flex min-w-0 flex-col gap-3">
    <p className="font-medium">{t("deliveryZones.agencies")}</p>
    {value.length === 0 ? <FieldDescription>{t("deliveryZones.noAgencies")}</FieldDescription> : <ul className="flex flex-col gap-1">{value.map(agencyId => {
      const agency = details.get(agencyId);
      return <li key={agencyId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="break-words">{agency ? describeAgency(agency) : agencyId}{agency && !agency.enabled && ` · ${t("deliverySettings.inactive")}`}</span>
        <Button type="button" variant="ghost" className="max-md:min-h-touch" onClick={() => onChange(value.filter(item => item !== agencyId))}>{t("deliveryZones.removeAgency", { name: agency?.name ?? agencyId })}</Button>
      </li>;
    })}</ul>}
    {couriers.length === 0 ? <FieldDescription>{t("deliveryZones.noCouriers")}</FieldDescription> : <>
      <Field><FieldLabel htmlFor={`${id}-courier`}>{t("deliveryZones.agencyCourier")}</FieldLabel>
        <Select value={courierId} onValueChange={value => { setCourierId(String(value ?? "")); setQuery(""); }} items={couriers.map(courier => ({ value: courier.courierId, label: courier.name }))}>
          <SelectTrigger id={`${id}-courier`}><SelectValue /></SelectTrigger>
          <SelectContent>{couriers.map(courier => <SelectItem key={courier.courierId} value={courier.courierId}>{courier.name}</SelectItem>)}</SelectContent>
        </Select></Field>
      <Field><FieldLabel htmlFor={`${id}-search`}>{t("deliveryZones.searchAgencies")}</FieldLabel>
        <Input id={`${id}-search`} type="search" value={query} onChange={event => setQuery(event.target.value)} /></Field>
      {!current && <Alert><AlertDescription>{t("deliveryZones.loadingAgencies")}</AlertDescription></Alert>}
      {current?.error && <div className="flex flex-col gap-2"><Alert variant="destructive"><AlertDescription>{t("deliveryZones.agenciesError")}</AlertDescription></Alert>
        <Button type="button" variant="outline" onClick={() => setAttempt(value => value + 1)}>{t("deliveryZones.retryAgencies")}</Button></div>}
      {current?.agencies && matches.length === 0 && <Alert><AlertDescription>{t("deliveryZones.noAgencyMatches")}</AlertDescription></Alert>}
      {matches.length > 0 && <ul className="flex max-h-72 flex-col overflow-y-auto" aria-label={t("deliveryZones.agencyResults")}>{matches.slice(0, maxShown).map(agency =>
        <li key={agency.id}><Field orientation="horizontal">
          <Checkbox id={`${id}-agency-${agency.id}`} checked={value.includes(agency.id)} onCheckedChange={() => toggle(agency)} /><FieldLabel htmlFor={`${id}-agency-${agency.id}`} className="break-words">{describeAgency(agency)}</FieldLabel>
        </Field></li>)}</ul>}
      {matches.length > maxShown && <FieldDescription>{t("deliveryZones.moreAgencies", { count: matches.length - maxShown })}</FieldDescription>}
    </>}
  </div>;
}
