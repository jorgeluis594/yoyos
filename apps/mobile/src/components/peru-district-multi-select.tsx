import { useState } from "react";
import { ScrollView, StyleSheet, Switch, View } from "react-native";
import { useTranslation } from "react-i18next";
import { filterPeruDistricts, getPeruDistrict, getPeruDistricts, getPeruProvince, getPeruProvinces, peruAreaDistricts, peruAreaEntries, peruDepartments, selectPeruArea,
  type PeruAreaSelection, type PeruDepartmentCode, type PeruProvinceCode } from "@shared/peru-geography";
import { Field, FieldLabel } from "@mobile/components/ui/field";
import { OptionSelector } from "@mobile/components/ui/option-selector";
import { Input } from "@mobile/components/ui/input";
import { Button } from "@mobile/components/ui/button";
import { ThemedText } from "@mobile/components/themed-text";
import { entryLabel, entryName, provinceLabel, titleCase } from "@mobile/components/zone-entries";
import { useTheme } from "@mobile/hooks/use-theme";

export function PeruDistrictMultiSelect({ value, onChange, disabled = false }: Readonly<{
  value: PeruAreaSelection; onChange: (value: PeruAreaSelection) => void; disabled?: boolean;
}>) {
  const { t } = useTranslation();
  const theme = useTheme();
  // Opens on the first entry: its department, and its province unless the entry is a whole department.
  const first = peruAreaEntries(value)[0];
  const firstProvince = first?.kind === "province" ? getPeruProvince(first.code) : first?.kind === "district" ? getPeruProvince(getPeruDistrict(first.code)?.provinceCode ?? "") : null;
  const [departmentCode, setDepartmentCode] = useState<string | null>(first?.kind === "department" ? first.code : firstProvince?.departmentCode ?? null);
  const [provinceCode, setProvinceCode] = useState<string | null>(firstProvince?.code ?? null);
  const [query, setQuery] = useState("");
  const department = peruDepartments.find(item => item.code === departmentCode);
  const provinces = department ? getPeruProvinces(department.code) : [];
  const province = provinces.find(item => item.code === provinceCode);
  const departmentComplete = !!department && value.departmentCodes.includes(department.code);
  const provinceComplete = !!province && value.provinceCodes.includes(province.code);
  const districts = filterPeruDistricts(province ? getPeruDistricts(province.code) : [], query);
  const entries = peruAreaEntries(value);
  const mark = (area: Parameters<typeof selectPeruArea>[1]) => (selected: boolean) => onChange(selectPeruArea(value, area, selected));
  return <View style={styles.section}>
    <Field disabled={disabled}><FieldLabel>{t("zoneDepartment")}</FieldLabel>
      <OptionSelector testID="zone-department" options={peruDepartments.map(item => ({ value: item.code, label: item.name }))} value={departmentCode}
        onValueChange={code => { setDepartmentCode(code); setProvinceCode(null); setQuery(""); }} />
    </Field>
    {department ? <View style={styles.row}>
      <ThemedText style={styles.label}>{t("zoneAllDepartment", { name: titleCase(department.name) })}</ThemedText>
      <Switch accessibilityLabel={t("zoneAllDepartment", { name: titleCase(department.name) })} value={departmentComplete} disabled={disabled}
        trackColor={{ true: theme.primary }} onValueChange={mark({ kind: "department", code: department.code as PeruDepartmentCode })} />
    </View> : null}
    <Field disabled={disabled || !department || departmentComplete}><FieldLabel>{t("zoneProvince")}</FieldLabel>
      <OptionSelector testID="zone-province" options={provinces.map(item => ({ value: item.code, label: item.name }))} value={provinceCode}
        onValueChange={code => { setProvinceCode(code); setQuery(""); }} />
    </Field>
    {province && !departmentComplete ? <View style={styles.row}>
      <ThemedText style={styles.label}>{t("zoneAllProvince", { name: provinceLabel(province.code, province.name) })}</ThemedText>
      <Switch accessibilityLabel={t("zoneAllProvince", { name: provinceLabel(province.code, province.name) })} value={provinceComplete} disabled={disabled}
        trackColor={{ true: theme.primary }} onValueChange={mark({ kind: "province", code: province.code as PeruProvinceCode })} />
    </View> : null}
    <Field disabled={disabled || !province || departmentComplete || provinceComplete}><FieldLabel>{t("zoneDistrictSearch")}</FieldLabel>
      <Input value={query} onChangeText={setQuery} accessibilityLabel={t("zoneDistrictSearch")} />
    </Field>
    {departmentComplete && department ? <ThemedText type="small" themeColor="textSecondary">{t("zoneDepartmentComplete", { name: titleCase(department.name) })}</ThemedText> :
      provinceComplete && province ? <ThemedText type="small" themeColor="textSecondary">{t("zoneProvinceComplete", { name: provinceLabel(province.code, province.name) })}</ThemedText> :
      !province ? <ThemedText type="small" themeColor="textSecondary">{t("zoneDistrictHierarchy")}</ThemedText> :
      districts.length === 0 ? <ThemedText type="small" themeColor="textSecondary">{t("zoneDistrictEmpty")}</ThemedText> :
        <ScrollView style={styles.matches} nestedScrollEnabled keyboardShouldPersistTaps="handled">
          {districts.map(district => <View key={district.code} style={styles.row}>
            <ThemedText style={styles.label}>{district.name} · {district.code}</ThemedText>
            <Switch accessibilityLabel={`${district.name} · ${district.code}`} value={value.districtCodes.includes(district.code)} disabled={disabled}
              trackColor={{ true: theme.primary }} onValueChange={mark({ kind: "district", code: district.code })} />
          </View>)}
        </ScrollView>}
    <ThemedText accessibilityLiveRegion="polite">{t("zoneDistrictSelected", { count: peruAreaDistricts(value).length })}</ThemedText>
    {entries.map(entry => <View key={`${entry.kind}-${entry.code}`} style={styles.row}>
      <ThemedText type="small" style={styles.label}>{entryLabel(entry, t)}</ThemedText>
      <Button variant="ghost" disabled={disabled} accessibilityLabel={t("zoneDistrictRemove", { name: entryName(entry, t) })}
        onPress={() => onChange(selectPeruArea(value, entry, false))}>{t("zoneDistrictRemove", { name: entryName(entry, t) })}</Button>
    </View>)}
  </View>;
}
const styles = StyleSheet.create({ section: { gap: 12 }, matches: { maxHeight: 256 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48 }, label: { flex: 1 } });
