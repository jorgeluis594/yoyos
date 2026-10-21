import { useTranslation } from "react-i18next";
import { useId, useState } from "react";
import { Input } from "@core/app/components/ui/input";
import { controlClass } from "@core/app/components/ui/field";
import { filterPeruDistricts, getPeruDistrict, getPeruDistricts, getPeruProvinces, peruDepartments, type PeruDistrictCode } from "@shared/peru-geography";

export { filterPeruDistricts } from "@shared/peru-geography";

export function PeruDistrictSelect({ value, onChange, disabled = false, themed = false }: Readonly<{
  value: PeruDistrictCode | null; onChange: (value: PeruDistrictCode | null) => void; disabled?: boolean;
  /** Carries the hooks of the checkout themes; the seller views keep their own look. */
  themed?: boolean;
}>) {
  const { t } = useTranslation();
  const selectSlot = themed ? { "data-slot": "select" } : {};
  const labelSlot = themed ? { "data-slot": "label" } : {};
  const id = useId();
  const selected = value ? getPeruDistrict(value) : null;
  const [departmentCode, setDepartmentCode] = useState<string>(selected?.departmentCode ?? "");
  const [provinceCode, setProvinceCode] = useState<string>(selected?.provinceCode ?? "");
  const [query, setQuery] = useState("");
  const department = peruDepartments.find(item => item.code === (selected?.departmentCode ?? departmentCode));
  const provinces = department ? getPeruProvinces(department.code) : [];
  const province = provinces.find(item => item.code === (selected?.provinceCode ?? provinceCode));
  const districts = province ? getPeruDistricts(province.code) : [];
  const matches = filterPeruDistricts(districts, query);
  const options = selected && !matches.some(item => item.code === selected.code) ? [selected, ...matches] : matches;
  return <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-3">
    <legend className="mb-3 font-medium">{t("peruDistrict.deliveryTitle")}</legend>
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-1.5"><label htmlFor={`${id}-department`} {...labelSlot} className="text-sm font-medium">{t("peruDistrict.department")}</label>
        <select id={`${id}-department`} {...selectSlot} className={controlClass} value={department?.code ?? ""} onChange={event => {
          setDepartmentCode(event.target.value); setProvinceCode(""); setQuery(""); onChange(null);
        }}><option value="">{t("peruDistrict.selectDepartment")}</option>{peruDepartments.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}</select>
      </div>
      <div className="flex min-w-0 flex-col gap-1.5"><label htmlFor={`${id}-province`} {...labelSlot} className="text-sm font-medium">{t("peruDistrict.province")}</label>
        <select id={`${id}-province`} {...selectSlot} className={controlClass} value={province?.code ?? ""} disabled={!department} onChange={event => {
          setProvinceCode(event.target.value); setQuery(""); onChange(null);
        }}><option value="">{t("peruDistrict.selectProvince")}</option>{provinces.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}</select>
      </div>
    </div>
    <div className="flex flex-col gap-1.5"><label htmlFor={`${id}-search`} {...labelSlot} className="text-sm font-medium">{t("peruDistrict.search")}</label>
      <Input id={`${id}-search`} type="search" disabled={!province} value={query} onChange={event => setQuery(event.target.value)} placeholder={t("peruDistrict.searchPlaceholder")} />
    </div>
    <div className="flex flex-col gap-1.5"><label htmlFor={`${id}-district`} {...labelSlot} className="text-sm font-medium">{t("peruDistrict.district")}</label>
      <select id={`${id}-district`} {...selectSlot} className={controlClass} value={value ?? ""} disabled={!province} aria-describedby={`${id}-hint`} onChange={event => {
        onChange(districts.find(item => item.code === event.target.value)?.code ?? null);
      }}><option value="">{t("peruDistrict.selectDistrict")}</option>{options.map(item => <option key={item.code} value={item.code}>{item.name} · {item.code}</option>)}</select>
      <p id={`${id}-hint`} className="text-sm text-muted-foreground" role="status">{!province ? t("peruDistrict.pickParents") : matches.length === 0 ? t("peruDistrict.noMatches") : t("peruDistrict.available", { count: matches.length, province: province.name })}</p>
    </div>
  </fieldset>;
}
