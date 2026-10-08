import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { filterPeruDistricts, getPeruDistrict, getPeruDistricts, getPeruProvinces, peruDepartments, type PeruDistrictCode } from "@shared/peru-geography";
import { Field, FieldLabel } from "@mobile/components/ui/field";
import { OptionSelector } from "@mobile/components/ui/option-selector";
import { Input } from "@mobile/components/ui/input";
import { ThemedText } from "@mobile/components/themed-text";

export function PeruDistrictSelect({ value, onChange, disabled = false }: Readonly<{
  value: PeruDistrictCode | null; onChange: (value: PeruDistrictCode | null) => void; disabled?: boolean;
}>) {
  const { t } = useTranslation();
  const selected = value ? getPeruDistrict(value) : null;
  const [departmentCode, setDepartmentCode] = useState<string | null>(selected?.departmentCode ?? null);
  const [provinceCode, setProvinceCode] = useState<string | null>(selected?.provinceCode ?? null);
  const [query, setQuery] = useState("");
  const department = peruDepartments.find(item => item.code === departmentCode);
  const provinces = department ? getPeruProvinces(department.code) : [];
  const province = provinces.find(item => item.code === provinceCode);
  const districts = filterPeruDistricts(province ? getPeruDistricts(province.code) : [], query);
  return <View style={styles.section}>
    <Field disabled={disabled} required><FieldLabel>{t("zoneDepartment")}</FieldLabel>
      <OptionSelector testID="delivery-department" options={peruDepartments.map(item => ({ value: item.code, label: item.name }))} value={departmentCode}
        onValueChange={code => { setDepartmentCode(code); setProvinceCode(null); setQuery(""); onChange(null); }} />
    </Field>
    <Field disabled={disabled || !department} required><FieldLabel>{t("zoneProvince")}</FieldLabel>
      <OptionSelector testID="delivery-province" options={provinces.map(item => ({ value: item.code, label: item.name }))} value={provinceCode}
        onValueChange={code => { setProvinceCode(code); setQuery(""); onChange(null); }} />
    </Field>
    <Field disabled={disabled || !province}><FieldLabel>{t("zoneDistrictSearch")}</FieldLabel>
      <Input value={query} onChangeText={setQuery} accessibilityLabel={t("zoneDistrictSearch")} />
    </Field>
    <Field disabled={disabled || !province} required><FieldLabel>{t("zoneDistrictChoice")}</FieldLabel>
      <OptionSelector testID="delivery-district" value={districts.some(item => item.code === value) ? value : null}
        options={districts.map(item => ({ value: item.code, label: `${item.name} · ${item.code}` }))}
        onValueChange={code => onChange(code ? getPeruDistrict(code)?.code ?? null : null)} />
    </Field>
    {province && districts.length === 0 ? <ThemedText type="small">{t("zoneDistrictEmpty")}</ThemedText> : null}
    {selected ? <ThemedText accessibilityLiveRegion="polite">{selected.name} · {getPeruProvinces(selected.departmentCode).find(item => item.code === selected.provinceCode)?.name} · {peruDepartments.find(item => item.code === selected.departmentCode)?.name} · {selected.code}</ThemedText> : null}
  </View>;
}
const styles = StyleSheet.create({ section: { gap: 12 } });
