import { useTranslation } from "react-i18next";
import { useId, useState } from "react";
import { controlClass } from "@core/app/components/ui/field";
import { Combobox, ComboboxCheckboxItem, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxList } from "@core/app/components/ui/combobox";
import { Checkbox } from "@core/app/components/ui/checkbox";
import { provinceLabel, titleCase, zoneEntries } from "@core/app/components/zone-entries";
import { filterPeruDistricts, getPeruDistrict, getPeruDistricts, getPeruProvince, getPeruProvinces, peruAreaDistricts, peruAreaEntries, peruDepartments, selectPeruArea,
  type PeruAreaSelection, type PeruDepartmentCode, type PeruDistrict, type PeruProvinceCode } from "@shared/peru-geography";

export function PeruDistrictMultiSelect({ value, onChange, disabled = false }: Readonly<{
  value: PeruAreaSelection; onChange: (value: PeruAreaSelection) => void; disabled?: boolean;
}>) {
  const { t } = useTranslation();
  const id = useId();
  // Opens on the first entry: its department, and its province unless the entry is a whole department.
  const first = peruAreaEntries(value)[0];
  const firstProvince = first?.kind === "province" ? getPeruProvince(first.code) : first?.kind === "district" ? getPeruProvince(getPeruDistrict(first.code)?.provinceCode ?? "") : null;
  const [departmentCode, setDepartmentCode] = useState<string>(first?.kind === "department" ? first.code : firstProvince?.departmentCode ?? "");
  const [provinceCode, setProvinceCode] = useState<string>(firstProvince?.code ?? "");
  const [query, setQuery] = useState("");
  const department = peruDepartments.find(item => item.code === departmentCode);
  const provinces = department ? getPeruProvinces(department.code) : [];
  const province = provinces.find(item => item.code === provinceCode);
  // Catalog districts are shared references, so the combobox can compare them by identity.
  const selected = value.districtCodes.flatMap(code => getPeruDistrict(code) ?? []);
  const departmentComplete = !!department && value.departmentCodes.includes(department.code);
  const provinceComplete = !!province && value.provinceCodes.includes(province.code);
  const mark = (area: Parameters<typeof selectPeruArea>[1]) => (checked: boolean | "indeterminate") => onChange(selectPeruArea(value, area, checked === true));
  const options = province ? [...selected.filter(district => district.provinceCode !== province.code), ...getPeruDistricts(province.code)] : selected;
  const label = (district: PeruDistrict) => district.provinceCode === province?.code ? district.name
    : `${district.name} (${getPeruProvinces(district.departmentCode).find(item => item.code === district.provinceCode)?.name})`;
  return <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-3">
    <legend className="mb-3 font-medium">{t("peruDistrict.zoneTitle")}</legend>
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-1.5"><label htmlFor={`${id}-department`} className="text-sm font-medium">{t("peruDistrict.department")}</label>
        <select id={`${id}-department`} className={controlClass} value={departmentCode} onChange={event => {
          setDepartmentCode(event.target.value); setProvinceCode(""); setQuery("");
        }}><option value="">{t("peruDistrict.selectDepartment")}</option>{peruDepartments.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}</select>
      </div>
      <div className="flex min-w-0 flex-col gap-1.5"><label htmlFor={`${id}-province`} className="text-sm font-medium">{t("peruDistrict.province")}</label>
        <select id={`${id}-province`} className={controlClass} value={provinceCode} disabled={!department || departmentComplete} onChange={event => {
          setProvinceCode(event.target.value); setQuery("");
        }}><option value="">{t("peruDistrict.selectProvince")}</option>{provinces.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}</select>
      </div>
    </div>
    {department && <label className="flex items-center gap-2 text-sm"><Checkbox checked={departmentComplete} onCheckedChange={mark({ kind: "department", code: department.code as PeruDepartmentCode })} />
      {t("peruDistrict.allDepartment", { name: titleCase(department.name) })}</label>}
    {province && !departmentComplete && <label className="flex items-center gap-2 text-sm"><Checkbox checked={provinceComplete} onCheckedChange={mark({ kind: "province", code: province.code as PeruProvinceCode })} />
      {t("peruDistrict.allProvince", { name: provinceLabel(province.code, province.name) })}</label>}
    {departmentComplete && <p className="text-sm text-muted-foreground">{t("peruDistrict.departmentComplete", { name: titleCase(department.name) })}</p>}
    {provinceComplete && <p className="text-sm text-muted-foreground">{t("peruDistrict.provinceComplete", { name: provinceLabel(province.code, province.name) })}</p>}
    <div className="flex flex-col gap-1.5"><label htmlFor={`${id}-search`} className="text-sm font-medium">{t("peruDistrict.districts")}</label>
      <Combobox multiple items={options} filteredItems={filterPeruDistricts(options, query)} value={selected} disabled={disabled || !province || departmentComplete || provinceComplete}
        inputValue={query} onInputValueChange={setQuery} itemToStringLabel={label}
        onValueChange={districts => onChange({ ...value, districtCodes: districts.map(district => district.code) })}>
        <ComboboxInput id={`${id}-search`} placeholder={province ? t("peruDistrict.searchPlaceholder") : t("peruDistrict.pickParents")} />
        <ComboboxContent>
          <ComboboxEmpty>{t("peruDistrict.noMatches")}</ComboboxEmpty>
          <ComboboxList>{(district: PeruDistrict) => <ComboboxCheckboxItem key={district.code} value={district}>{label(district)}</ComboboxCheckboxItem>}</ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
    <p className="text-sm"><span className="font-medium">{t("peruDistrict.selected", { count: peruAreaDistricts(value).length })}</span>
      {peruAreaEntries(value).length > 0 && <span className="text-muted-foreground">: {zoneEntries(value, t)}</span>}</p>
  </fieldset>;
}
