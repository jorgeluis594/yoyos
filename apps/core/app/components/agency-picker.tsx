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

/** Chooses the catalog agencies of an agency option: the courier first, its catalog with a search box, and the chosen agencies below. */
export function AgencyPicker({ id, couriers, known, value, onChange, onCourierChange }: Readonly<{
  id: string; couriers: readonly Courier[]; known: readonly CatalogAgencyContract[]; value: readonly string[]; onChange: (agencyIds: string[]) => void;
  onCourierChange?: (courier: Courier) => void;
}>) {
  const { t } = useTranslation();
  // A saved option opens on the courier of its first agency.
  const [chosenCourierId, setCourierId] = useState(() => known.find(agency => value.includes(agency.id))?.courierId ?? couriers[0]?.courierId ?? "");
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
  const chosen = value.length === 0 ? <FieldDescription id={`${id}-chosen`}>{t("deliveryZones.noAgencies")}</FieldDescription>
    : <ul id={`${id}-chosen`} className="flex flex-col divide-y divide-border rounded-[var(--radius-control)] border border-border">{value.map(agencyId => {
      const agency = details.get(agencyId);
      return <li key={agencyId} className="flex min-w-0 items-center justify-between gap-2 py-1 pl-3 pr-1 text-sm">
        <span className="min-w-0 break-words">{agency ? describeAgency(agency) : agencyId}{agency && !agency.enabled && ` · ${t("deliverySettings.inactive")}`}</span>
        <Button type="button" variant="ghost" className="shrink-0 max-md:min-h-touch" aria-label={t("deliveryZones.removeAgency", { name: agency?.name ?? agencyId })}
          onClick={() => onChange(value.filter(item => item !== agencyId))}>{t("deliveryZones.remove")}</Button>
      </li>;
    })}</ul>;
  if (couriers.length === 0) return <div className="flex min-w-0 flex-col gap-2">{chosen}<FieldDescription>{t("deliveryZones.noCatalog")}</FieldDescription></div>;
  return <div className="flex min-w-0 flex-col gap-4">
    <Field><FieldLabel htmlFor={`${id}-courier`}>{t("deliveryZones.agencyCourier")}</FieldLabel>
      <Select value={courierId} onValueChange={next => {
        const courier = couriers.find(entry => entry.courierId === next);
        if (!courier) return;
        setCourierId(courier.courierId); setQuery(""); onCourierChange?.(courier);
      }} items={couriers.map(courier => ({ value: courier.courierId, label: courier.name }))}>
        <SelectTrigger id={`${id}-courier`}><SelectValue /></SelectTrigger>
        <SelectContent>{couriers.map(courier => <SelectItem key={courier.courierId} value={courier.courierId}>{courier.name}</SelectItem>)}</SelectContent>
      </Select></Field>
    <div className="flex min-w-0 flex-col gap-2">
      <p className="text-sm font-medium">{t("deliveryZones.agencies", { count: value.length })}</p>
      {chosen}
    </div>
    <Field><FieldLabel htmlFor={`${id}-search`}>{t("deliveryZones.searchAgencies")}</FieldLabel>
      <Input id={`${id}-search`} type="search" value={query} onChange={event => setQuery(event.target.value)} /></Field>
    {!current && <FieldDescription role="status">{t("deliveryZones.loadingAgencies")}</FieldDescription>}
    {current?.error && <div className="flex flex-col items-start gap-2"><Alert variant="destructive"><AlertDescription>{t("deliveryZones.agenciesError")}</AlertDescription></Alert>
      <Button type="button" variant="outline" onClick={() => setAttempt(value => value + 1)}>{t("deliveryZones.retryAgencies")}</Button></div>}
    {current?.agencies && matches.length === 0 && <FieldDescription>{t("deliveryZones.noAgencyMatches")}</FieldDescription>}
    {matches.length > 0 && <ul className="flex max-h-72 flex-col overflow-y-auto rounded-[var(--radius-control)] border border-border px-3 py-1" aria-label={t("deliveryZones.agencyResults")}>{matches.slice(0, maxShown).map(agency =>
      <li key={agency.id}><Field orientation="horizontal" className="py-1.5">
        <Checkbox id={`${id}-agency-${agency.id}`} checked={value.includes(agency.id)} onCheckedChange={() => toggle(agency)} /><FieldLabel htmlFor={`${id}-agency-${agency.id}`} className="break-words font-normal">{describeAgency(agency)}</FieldLabel>
      </Field></li>)}</ul>}
    {matches.length > maxShown && <FieldDescription>{t("deliveryZones.moreAgencies", { count: matches.length - maxShown })}</FieldDescription>}
  </div>;
}
