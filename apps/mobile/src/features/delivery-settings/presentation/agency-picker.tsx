import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Switch, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { AgencyCatalogResponse, CatalogAgencyContract } from "@shared/contracts/delivery-settings";
import { filterAgencies } from "@shared/agency-search";
import type { Result } from "@shared/result";
import type { DeliverySettingsError } from "@mobile/features/delivery-settings/application/delivery-settings";
import { ThemedText } from "@mobile/components/themed-text";
import { Button } from "@mobile/components/ui/button";
import { Field, FieldLabel } from "@mobile/components/ui/field";
import { Input } from "@mobile/components/ui/input";
import { OptionSelector } from "@mobile/components/ui/option-selector";
import { useTheme } from "@mobile/hooks/use-theme";

const maxShown = 50;
export const describeAgency = (agency: CatalogAgencyContract) => `${agency.name} · ${agency.location.district} · ${agency.address}`;

export type AgencyCourier = Readonly<{ courierId: string; name: string }>;

/** Chooses the catalog agencies of an agency option: the selected ones, then the courier's catalog with a search box. */
export function AgencyPicker({ couriers, known, value, disabled, loadCatalog, onChange }: Readonly<{
  couriers: readonly AgencyCourier[]; known: readonly CatalogAgencyContract[]; value: readonly string[]; disabled: boolean;
  loadCatalog: (courierId: string) => Promise<Result<AgencyCatalogResponse, DeliverySettingsError>>; onChange: (agencyIds: string[]) => void;
}>) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [chosenCourierId, setCourierId] = useState<string | null>(couriers[0]?.courierId ?? null);
  const courierId = couriers.some(courier => courier.courierId === chosenCourierId) ? chosenCourierId : couriers[0]?.courierId ?? null;
  const [query, setQuery] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; agencies: readonly CatalogAgencyContract[] | null }>();
  const [picked, setPicked] = useState<ReadonlyMap<string, CatalogAgencyContract>>(new Map());
  const key = `${courierId}/${attempt}`;
  const current = loaded?.key === key ? loaded : null;
  useEffect(() => {
    if (!courierId) return;
    let active = true;
    void loadCatalog(courierId).then(result => { if (active) setLoaded({ key, agencies: result.success ? result.data.agencies : null }); });
    return () => { active = false; };
  }, [courierId, key, loadCatalog]);
  const details = new Map([...known, ...picked.values()].map(agency => [agency.id, agency] as const));
  const toggle = (agency: CatalogAgencyContract, selected: boolean) => {
    if (!selected) return onChange(value.filter(item => item !== agency.id));
    setPicked(previous => new Map(previous).set(agency.id, agency));
    onChange([...value.filter(item => item !== agency.id), agency.id]);
  };
  const matches = current?.agencies ? filterAgencies(current.agencies, query) : [];
  return <View style={styles.section}>
    <ThemedText type="small" accessibilityRole="header">{t("agenciesTitle")}</ThemedText>
    {value.length === 0 ? <ThemedText type="small" themeColor="textSecondary">{t("agenciesNone")}</ThemedText> : value.map(agencyId => {
      const agency = details.get(agencyId);
      const name = agency ? describeAgency(agency) : agencyId;
      return <View key={agencyId} style={styles.row}>
        <ThemedText type="small" style={styles.label}>{name}{agency && !agency.enabled ? ` · ${t("optionInactive")}` : ""}</ThemedText>
        <Button variant="ghost" disabled={disabled} accessibilityLabel={t("agencyRemove", { name })} onPress={() => onChange(value.filter(item => item !== agencyId))}>{t("agencyRemove", { name: agency?.name ?? agencyId })}</Button>
      </View>;
    })}
    {couriers.length === 0 ? <ThemedText type="small" themeColor="textSecondary">{t("agenciesNoCouriers")}</ThemedText> : <>
      <Field disabled={disabled}><FieldLabel>{t("agencyCourier")}</FieldLabel>
        <OptionSelector testID="agency-courier" options={couriers.map(courier => ({ value: courier.courierId, label: courier.name }))} value={courierId}
          onValueChange={next => { if (next) { setCourierId(next); setQuery(""); } }} /></Field>
      <Field disabled={disabled}><FieldLabel>{t("agencySearch")}</FieldLabel><Input accessibilityLabel={t("agencySearch")} value={query} onChangeText={setQuery} /></Field>
      {!current ? <ThemedText type="small" themeColor="textSecondary" accessibilityLiveRegion="polite">{t("agenciesLoading")}</ThemedText> : null}
      {current && !current.agencies ? <View style={styles.section}><ThemedText type="small" accessibilityRole="alert" style={{ color: theme.error }}>{t("agenciesError")}</ThemedText>
        <Button variant="secondary" disabled={disabled} onPress={() => setAttempt(next => next + 1)}>{t("agenciesRetry")}</Button></View> : null}
      {current?.agencies && matches.length === 0 ? <ThemedText type="small" themeColor="textSecondary">{t("agenciesNoMatches")}</ThemedText> : null}
      {matches.length > 0 ? <ScrollView style={styles.matches} nestedScrollEnabled keyboardShouldPersistTaps="handled">
        {matches.slice(0, maxShown).map(agency => <View key={agency.id} style={styles.row}>
          <ThemedText type="small" style={styles.label}>{describeAgency(agency)}</ThemedText>
          <Switch accessibilityLabel={describeAgency(agency)} value={value.includes(agency.id)} disabled={disabled} trackColor={{ true: theme.primary }}
            onValueChange={selected => toggle(agency, selected)} />
        </View>)}
      </ScrollView> : null}
      {matches.length > maxShown ? <ThemedText type="small" themeColor="textSecondary">{t("agenciesMore", { count: matches.length - maxShown })}</ThemedText> : null}
    </>}
  </View>;
}
const styles = StyleSheet.create({ section: { gap: 8 }, matches: { maxHeight: 256 }, row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48 }, label: { flex: 1 } });
