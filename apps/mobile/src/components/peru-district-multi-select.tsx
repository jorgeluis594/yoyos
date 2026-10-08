import { useState } from "react";
import { ScrollView, StyleSheet, Switch, View } from "react-native";
import { useTranslation } from "react-i18next";
import { filterPeruDistricts, getPeruDistrict, getPeruDistricts, getPeruProvinces, peruDepartments, type PeruDistrictCode } from "@shared/peru-geography";
import { Field, FieldLabel } from "@mobile/components/ui/field";
import { OptionSelector } from "@mobile/components/ui/option-selector";
import { Input } from "@mobile/components/ui/input";
import { Button } from "@mobile/components/ui/button";
import { ThemedText } from "@mobile/components/themed-text";
import { useTheme } from "@mobile/hooks/use-theme";

export function PeruDistrictMultiSelect({ value, onChange, disabled = false }: Readonly<{
  value: readonly PeruDistrictCode[]; onChange: (value: readonly PeruDistrictCode[]) => void; disabled?: boolean;
}>) {
  const { t } = useTranslation();
  const theme = useTheme();
  const initial = value[0] ? getPeruDistrict(value[0]) : null;
  const [departmentCode, setDepartmentCode] = useState<string | null>(initial?.departmentCode ?? null);
  const [provinceCode, setProvinceCode] = useState<string | null>(initial?.provinceCode ?? null);
  const [query, setQuery] = useState("");
  const department = peruDepartments.find(item => item.code === departmentCode);
  const provinces = department ? getPeruProvinces(department.code) : [];
  const province = provinces.find(item => item.code === provinceCode);
  const districts = filterPeruDistricts(province ? getPeruDistricts(province.code) : [], query);
  return <View style={styles.section}>
    <Field disabled={disabled}><FieldLabel>{t("zoneDepartment")}</FieldLabel>
      <OptionSelector testID="zone-department" options={peruDepartments.map(item => ({ value: item.code, label: item.name }))} value={departmentCode}
        onValueChange={code => { setDepartmentCode(code); setProvinceCode(null); setQuery(""); }} />
    </Field>
    <Field disabled={disabled || !department}><FieldLabel>{t("zoneProvince")}</FieldLabel>
      <OptionSelector testID="zone-province" options={provinces.map(item => ({ value: item.code, label: item.name }))} value={provinceCode}
        onValueChange={code => { setProvinceCode(code); setQuery(""); }} />
    </Field>
    <Field disabled={disabled || !province}><FieldLabel>{t("zoneDistrictSearch")}</FieldLabel>
      <Input value={query} onChangeText={setQuery} accessibilityLabel={t("zoneDistrictSearch")} />
    </Field>
    {!province ? <ThemedText type="small" themeColor="textSecondary">{t("zoneDistrictHierarchy")}</ThemedText> :
      districts.length === 0 ? <ThemedText type="small" themeColor="textSecondary">{t("zoneDistrictEmpty")}</ThemedText> :
        <ScrollView style={styles.matches} nestedScrollEnabled keyboardShouldPersistTaps="handled">
          {districts.map(district => <View key={district.code} style={styles.row}>
            <ThemedText style={styles.label}>{district.name} · {district.code}</ThemedText>
            <Switch accessibilityLabel={`${district.name} · ${district.code}`} value={value.includes(district.code)} disabled={disabled}
              trackColor={{ true: theme.primary }} onValueChange={selected => onChange(selected
                ? [...value.filter(code => code !== district.code), district.code] : value.filter(code => code !== district.code))} />
          </View>)}
        </ScrollView>}
    <ThemedText accessibilityLiveRegion="polite">{t("zoneDistrictSelected", { count: value.length })}</ThemedText>
    {value.map(code => {
      const district = getPeruDistrict(code);
      if (!district) return null;
      const province = getPeruProvinces(district.departmentCode).find(item => item.code === district.provinceCode);
      const department = peruDepartments.find(item => item.code === district.departmentCode);
      const name = `${district.name} · ${province?.name} · ${department?.name} · ${code}`;
      return <View key={code} style={styles.row}><ThemedText type="small" style={styles.label}>{name}</ThemedText>
        <Button variant="ghost" disabled={disabled} accessibilityLabel={t("zoneDistrictRemove", { name })} onPress={() => onChange(value.filter(item => item !== code))}>{t("zoneDistrictRemove", { name: district.name })}</Button>
      </View>;
    })}
  </View>;
}
const styles = StyleSheet.create({ section: { gap: 12 }, matches: { maxHeight: 256 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48 }, label: { flex: 1 } });
