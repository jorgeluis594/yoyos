import { useTranslation } from "react-i18next";
import { useId, useState } from "react";
import { Input } from "@core/app/components/ui/input";
import { Button } from "@core/app/components/ui/button";
import { controlClass } from "@core/app/components/ui/field";
import { filterPeruDistricts } from "@core/app/components/peru-district-select";
import { getPeruDistrict, getPeruDistricts, getPeruProvinces, peruDepartments, type PeruDistrictCode } from "@shared/peru-geography";

export function PeruDistrictMultiSelect({ value, onChange, disabled = false }: Readonly<{
  value: readonly PeruDistrictCode[]; onChange: (value: readonly PeruDistrictCode[]) => void; disabled?: boolean;
}>) {
  const { t } = useTranslation();
  const id = useId();
  const initial = value[0] ? getPeruDistrict(value[0]) : null;
  const [departmentCode, setDepartmentCode] = useState<string>(initial?.departmentCode ?? "");
  const [provinceCode, setProvinceCode] = useState<string>(initial?.provinceCode ?? "");
  const [query, setQuery] = useState("");
  const department = peruDepartments.find(item => item.code === departmentCode);
  const provinces = department ? getPeruProvinces(department.code) : [];
  const province = provinces.find(item => item.code === provinceCode);
  const districts = filterPeruDistricts(province ? getPeruDistricts(province.code) : [], query);
  const selected = value.flatMap(code => {
    const district = getPeruDistrict(code);
    if (!district) return [];
    const department = peruDepartments.find(item => item.code === district.departmentCode);
    const province = getPeruProvinces(district.departmentCode).find(item => item.code === district.provinceCode);
    return [{ ...district, location: `${district.name} · ${province?.name} · ${department?.name} · ${district.code}` }];
  });
  return <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-3">
    <legend className="mb-3 font-medium">{t("peruDistrict.zoneTitle")}</legend>
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-1.5"><label htmlFor={`${id}-department`} className="text-sm font-medium">{t("peruDistrict.department")}</label>
        <select id={`${id}-department`} className={controlClass} value={departmentCode} onChange={event => {
          setDepartmentCode(event.target.value); setProvinceCode(""); setQuery("");
        }}><option value="">{t("peruDistrict.selectDepartment")}</option>{peruDepartments.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}</select>
      </div>
      <div className="flex min-w-0 flex-col gap-1.5"><label htmlFor={`${id}-province`} className="text-sm font-medium">{t("peruDistrict.province")}</label>
        <select id={`${id}-province`} className={controlClass} value={provinceCode} disabled={!department} onChange={event => {
          setProvinceCode(event.target.value); setQuery("");
        }}><option value="">{t("peruDistrict.selectProvince")}</option>{provinces.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}</select>
      </div>
    </div>
    <div className="flex flex-col gap-1.5"><label htmlFor={`${id}-search`} className="text-sm font-medium">{t("peruDistrict.search")}</label>
      <Input id={`${id}-search`} type="search" disabled={!province} value={query} onChange={event => setQuery(event.target.value)} placeholder={t("peruDistrict.searchPlaceholder")} />
    </div>
    <p role="status" className="text-sm text-muted-foreground">{!province ? t("peruDistrict.pickParents") : districts.length === 0 ? t("peruDistrict.noMatches") : t("peruDistrict.available", { count: districts.length, province: province.name })}</p>
    {province && <div className="max-h-64 overflow-y-auto rounded-md border border-border p-2" aria-label={t("peruDistrict.districtsOf", { province: province.name })}>
      {districts.map(district => <label key={district.code} className="flex min-h-touch cursor-pointer items-center gap-3 rounded px-2 py-2 hover:bg-muted">
        <input type="checkbox" className="size-4 shrink-0 accent-primary" checked={value.includes(district.code)} onChange={event => {
          onChange(event.target.checked ? [...value.filter(code => code !== district.code), district.code] : value.filter(code => code !== district.code));
        }} /><span className="text-sm">{district.name} · {district.code}</span>
      </label>)}
    </div>}
    <div className="flex flex-col gap-2"><p className="text-sm font-medium">{t("peruDistrict.selected", { count: selected.length })}</p>
      <p className="text-sm text-muted-foreground">{t("peruDistrict.multiHint")}</p>
      <ul className="divide-y divide-border">{selected.map(district => <li key={district.code} className="flex min-w-0 items-center justify-between gap-3 py-2">
        <span className="min-w-0 break-words text-sm">{district.location}</span>
        <Button type="button" variant="ghost" className="shrink-0 max-md:min-h-touch" aria-label={t("peruDistrict.removeNamed", { name: district.location })} onClick={() => onChange(value.filter(code => code !== district.code))}>{t("peruDistrict.remove")}</Button>
      </li>)}</ul>
    </div>
  </fieldset>;
}
