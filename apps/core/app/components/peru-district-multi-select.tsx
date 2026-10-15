import { useTranslation } from "react-i18next";
import { useId, useState } from "react";
import { controlClass } from "@core/app/components/ui/field";
import { Combobox, ComboboxCheckboxItem, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxList } from "@core/app/components/ui/combobox";
import { filterPeruDistricts, getPeruDistrict, getPeruDistricts, getPeruProvinces, peruDepartments, type PeruDistrict, type PeruDistrictCode } from "@shared/peru-geography";

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
  // Catalog districts are shared references, so the combobox can compare them by identity.
  const selected = value.flatMap(code => getPeruDistrict(code) ?? []);
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
        <select id={`${id}-province`} className={controlClass} value={provinceCode} disabled={!department} onChange={event => {
          setProvinceCode(event.target.value); setQuery("");
        }}><option value="">{t("peruDistrict.selectProvince")}</option>{provinces.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}</select>
      </div>
    </div>
    <div className="flex flex-col gap-1.5"><label htmlFor={`${id}-search`} className="text-sm font-medium">{t("peruDistrict.districts")}</label>
      <Combobox multiple items={options} filteredItems={filterPeruDistricts(options, query)} value={selected} disabled={disabled || !province}
        inputValue={query} onInputValueChange={setQuery} itemToStringLabel={label}
        onValueChange={districts => onChange(districts.map(district => district.code))}>
        <ComboboxInput id={`${id}-search`} placeholder={province ? t("peruDistrict.searchPlaceholder") : t("peruDistrict.pickParents")} />
        <ComboboxContent>
          <ComboboxEmpty>{t("peruDistrict.noMatches")}</ComboboxEmpty>
          <ComboboxList>{(district: PeruDistrict) => <ComboboxCheckboxItem key={district.code} value={district}>{label(district)}</ComboboxCheckboxItem>}</ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
    <p className="text-sm"><span className="font-medium">{t("peruDistrict.selected", { count: selected.length })}</span>
      {selected.length > 0 && <span className="text-muted-foreground">: {selected.map(label).join(", ")}</span>}</p>
  </fieldset>;
}
