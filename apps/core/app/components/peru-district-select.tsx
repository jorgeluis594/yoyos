import { useTranslation } from "react-i18next";
import { useId, useMemo, useState, type ReactNode } from "react";
import { LocationCombobox } from "@core/app/components/ui/location-combobox";
import { provinceLabel, titleCase } from "@core/app/components/zone-entries";
import { getPeruDistrict, getPeruDistricts, getPeruProvinces, peruDepartments, type PeruDistrictCode } from "@shared/peru-geography";

// The catalog names are uppercase and the ubigeo stays out of the options: codes only travel through the callbacks.
const named = (items: readonly { code: string; name: string }[], label: (code: string, name: string) => string = (_, name) => titleCase(name)) =>
  items.map(item => ({ code: item.code, name: label(item.code, item.name) }));

export function PeruDistrictSelect({ value, onChange, disabled = false, themed = false }: Readonly<{
  value: PeruDistrictCode | null; onChange: (value: PeruDistrictCode | null) => void; disabled?: boolean;
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
  const selected = value ? getPeruDistrict(value) : null;
  const [departmentCode, setDepartmentCode] = useState<string>(selected?.departmentCode ?? "");
  const [provinceCode, setProvinceCode] = useState<string>(selected?.provinceCode ?? "");
  const department = peruDepartments.find(item => item.code === (selected?.departmentCode ?? departmentCode));
  const provinces = department ? getPeruProvinces(department.code) : [];
  const province = provinces.find(item => item.code === (selected?.provinceCode ?? provinceCode));
  const districts = province ? getPeruDistricts(province.code) : [];
  // Options keep their identity across renders: base-ui reads a new selected object as a new choice and resets the typed query.
  const departmentOptions = useMemo(() => named(peruDepartments), []);
  const departmentKey = department?.code;
  const provinceKey = province?.code;
  const provinceOptions = useMemo(() => named(departmentKey ? getPeruProvinces(departmentKey) : [], provinceLabel), [departmentKey]);
  const districtOptions = useMemo(() => named(provinceKey ? getPeruDistricts(provinceKey) : []), [provinceKey]);
  const common = { emptyText: t("peruDistrict.noResults") };
  return <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-3">
    <legend className="mb-3 font-medium">{t("peruDistrict.deliveryTitle")}</legend>
    {group(<>
    {pair(<>
      <div className="flex min-w-0 flex-col gap-1.5">
        <LocationCombobox {...common} id={`${id}-department`} label={t("peruDistrict.department")} placeholder={t("peruDistrict.selectDepartment")}
          options={departmentOptions} value={department?.code ?? null} onChange={code => { if (code === (department?.code ?? null)) return; setDepartmentCode(code ?? ""); setProvinceCode(""); onChange(null); }} />
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <LocationCombobox {...common} id={`${id}-province`} label={t("peruDistrict.province")} placeholder={t("peruDistrict.selectProvince")} disabled={!department}
          options={provinceOptions} value={province?.code ?? null} onChange={code => { if (code === (province?.code ?? null)) return; setProvinceCode(code ?? ""); onChange(null); }} />
      </div>
    </>)}
    <div {...fieldPart} className="flex flex-col gap-1.5">
      <LocationCombobox {...common} id={`${id}-district`} label={t("peruDistrict.district")} placeholder={province ? t("peruDistrict.selectDistrict") : t("peruDistrict.pickParents")}
        disabled={!province} describedBy={`${id}-hint`} options={districtOptions} value={value} onChange={code => onChange(districts.find(item => item.code === code)?.code ?? null)}>
        <p id={`${id}-hint`} className="text-sm text-muted-foreground">{t("peruDistrict.help")}</p>
      </LocationCombobox>
    </div>
    </>)}
  </fieldset>;
}
