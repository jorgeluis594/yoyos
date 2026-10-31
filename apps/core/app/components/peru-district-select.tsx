import { useTranslation } from "react-i18next";
import { useId, useMemo, useState, type ReactNode } from "react";
import { LocationCombobox } from "@core/app/components/ui/location-combobox";
import { provinceLabel, titleCase } from "@core/app/components/zone-entries";
import {
  getPeruDistrict, getPeruDistricts, getPeruProvince, getPeruProvinces, offeredPeruDepartments, offeredPeruDistricts, offeredPeruProvinces, peruDepartments,
  type PeruArea, type PeruAreaSelection, type PeruDepartmentCode, type PeruDistrictCode, type PeruProvinceCode,
} from "@shared/peru-geography";

// The catalog names are uppercase and the ubigeo stays out of the options: codes only travel through the callbacks.
const named = (items: readonly { code: string; name: string }[], label: (code: string, name: string) => string = (_, name) => titleCase(name)) =>
  items.map(item => ({ code: item.code, name: label(item.code, item.name) }));

type LocationLevel = "department" | "province" | "district";

/** The codes of each level that a place fills: the levels below it stay empty. */
function levelsOf(area: PeruArea | null): Readonly<{ department: string | null; province: string | null; district: string | null }> {
  if (!area) return { department: null, province: null, district: null };
  if (area.kind === "department") return { department: area.code, province: null, district: null };
  if (area.kind === "province") return { department: area.code.slice(0, 2), province: area.code, district: null };
  const district = getPeruDistrict(area.code);
  return { department: district?.departmentCode ?? null, province: district?.provinceCode ?? null, district: area.code };
}

/**
 * The three controlled levels of a Peruvian delivery place. `places` limits what it offers (absent = the whole country); it must keep its identity across
 * renders, because the option lists are memoized on it.
 */
export function PeruLocationFields({ value, onChange, places, texts, disabled = false, themed = false }: Readonly<{
  value: PeruArea | null;
  /** The level the person changed; the levels below arrive already cleared. Clearing reports the parent (or null) with the cleared level. */
  onChange: (next: PeruArea | null, level: LocationLevel) => void;
  places?: PeruAreaSelection;
  /** Checkout texts: a hint under the group title that describes only Departamento, and the empty text of each level. */
  texts?: Readonly<{ groupHint: string; noResults: Readonly<Record<LocationLevel, string>> }>;
  disabled?: boolean;
  /** Carries the hooks of the checkout themes; the seller views keep their own look. */
  themed?: boolean;
}>) {
  const { t } = useTranslation();
  // The checkout themes lay these fields out as one group, like the buyer fields; the seller views keep their own layout.
  const fieldPart = themed ? { "data-store-part": "field" } : {};
  // Themed, the two columns are one field of the group, so its separator and padding stay one per row.
  const pair = (fields: ReactNode) => themed
    ? <div data-store-part="field" className="min-w-0"><div className="grid min-w-0 gap-3 grid-cols-2">{fields}</div></div>
    : <div className="grid min-w-0 gap-3 grid-cols-2">{fields}</div>;
  const group = (fields: ReactNode) => themed ? <div data-store-part="field-group" className="flex min-w-0 flex-col gap-3">{fields}</div> : fields;
  const id = useId();
  const { department, province, district } = levelsOf(value);
  // Options keep their identity across renders: base-ui reads a new selected object as a new choice and resets the typed query.
  const departmentOptions = useMemo(() => named(places ? offeredPeruDepartments(places) : peruDepartments), [places]);
  const provinceOptions = useMemo(() => {
    if (!department) return [];
    return named(places ? offeredPeruProvinces(places, department) : getPeruProvinces(department as PeruDepartmentCode), provinceLabel);
  }, [places, department]);
  const districtOptions = useMemo(() => {
    if (!province) return [];
    return named(places ? offeredPeruDistricts(places, province) : getPeruDistricts(province as PeruProvinceCode));
  }, [places, province]);
  const noResults = (level: LocationLevel) => texts?.noResults[level] ?? t("peruDistrict.noResults");
  const asArea = (kind: "department" | "province", code: string | null): PeruArea | null =>
    code ? { kind, code } as PeruArea : null;
  const hintId = `${id}-hint`;
  return <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-3">
    <legend className="mb-3 font-medium">{t("peruDistrict.deliveryTitle")}</legend>
    {texts && <p id={hintId} className="text-sm text-muted-foreground">{texts.groupHint}</p>}
    {group(<>
    {pair(<>
      <div className="flex min-w-0 flex-col gap-1.5">
        <LocationCombobox emptyText={noResults("department")} id={`${id}-department`} label={t("peruDistrict.department")} placeholder={t("peruDistrict.selectDepartment")}
          describedBy={texts ? hintId : undefined}
          options={departmentOptions} value={department} onChange={code => { if (code === department) return; onChange(asArea("department", code), "department"); }} />
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <LocationCombobox emptyText={noResults("province")} id={`${id}-province`} label={t("peruDistrict.province")} placeholder={t("peruDistrict.selectProvince")} disabled={!department}
          options={provinceOptions} value={province} onChange={code => { if (code === province) return; onChange(code ? asArea("province", code) : asArea("department", department), "province"); }} />
      </div>
    </>)}
    <div {...fieldPart} className="flex flex-col gap-1.5">
      <LocationCombobox emptyText={noResults("district")} id={`${id}-district`} label={t("peruDistrict.district")} placeholder={province ? t("peruDistrict.selectDistrict") : t("peruDistrict.pickParents")}
        disabled={!province} describedBy={texts ? undefined : hintId} options={districtOptions} value={district}
        onChange={code => { if (code === district) return; onChange(code ? { kind: "district", code: code as PeruDistrictCode } : asArea("province", province), "district"); }}>
        {!texts && <p id={hintId} className="text-sm text-muted-foreground">{t("peruDistrict.help")}</p>}
      </LocationCombobox>
    </div>
    </>)}
  </fieldset>;
}

export function PeruDistrictSelect({ value, onChange, disabled = false, themed = false }: Readonly<{
  value: PeruDistrictCode | null; onChange: (value: PeruDistrictCode | null) => void; disabled?: boolean;
  /** Carries the hooks of the checkout themes; the seller views keep their own look. */
  themed?: boolean;
}>) {
  // The chosen district comes from `value`; while it is null, the parents picked so far live here.
  const [partial, setPartial] = useState<PeruArea | null>(null);
  const area: PeruArea | null = value ? { kind: "district", code: value } : partial?.kind === "district" ? parentOf(partial) : partial;
  return <PeruLocationFields value={area} disabled={disabled} themed={themed}
    onChange={next => { setPartial(next); onChange(next?.kind === "district" ? next.code : null); }} />;
}

function parentOf(area: Extract<PeruArea, { kind: "district" }>): PeruArea | null {
  const province = getPeruDistrict(area.code)?.provinceCode;
  return province && getPeruProvince(province) ? { kind: "province", code: province } : null;
}
