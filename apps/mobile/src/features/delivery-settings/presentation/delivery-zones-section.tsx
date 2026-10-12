import { useState } from "react";
import { StyleSheet, Switch, View } from "react-native";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import type { AgencyCatalogResponse, DeliveryZonesResponse, SaveDeliveryZonesRequest } from "@shared/contracts/delivery-settings";
import type { Result } from "@shared/result";
import { getPeruDistrict, type PeruDistrictCode } from "@shared/peru-geography";
import type { DeliveryOptionDraft, DeliverySettingsError, DeliveryZonesError } from "@mobile/features/delivery-settings/application/delivery-settings";
import { PeruDistrictMultiSelect } from "@mobile/components/peru-district-multi-select";
import { ThemedText } from "@mobile/components/themed-text";
import { Button } from "@mobile/components/ui/button";
import { Field, FieldLabel } from "@mobile/components/ui/field";
import { Input } from "@mobile/components/ui/input";
import { useTheme } from "@mobile/hooks/use-theme";
import { AgencyPicker, type AgencyCourier } from "@mobile/features/delivery-settings/presentation/agency-picker";

const amountSchema = z.string().regex(/^\d+(?:[.,]\d{1,2})?$/).refine(value => Number(value.replace(",", ".")) <= 9999999999999.99);
const draftSchema = z.object({ name: z.string().trim().min(1).max(120), enabled: z.boolean(),
  districtCodes: z.array(z.string().refine(code => getPeruDistrict(code) !== null)).min(1).refine(codes => new Set(codes).size === codes.length),
  options: z.array(z.object({ name: z.string().trim().min(1).max(120), amount: amountSchema }).loose())
    .refine(options => new Set(options.map(option => option.name.trim().toLowerCase())).size === options.length),
});
type Draft = Readonly<{ name: string; enabled: boolean; districtCodes: string[]; options: DeliveryOptionDraft[] }>;
type ZoneInput = SaveDeliveryZonesRequest["zones"][number];
type OptionInput = ZoneInput["options"][number];
const nextKey = (options: readonly DeliveryOptionDraft[]) => Math.max(0, ...options.map(value => value.kind === "new" ? value.localKey : 0)) + 1;
const empty: Draft = { name: "", enabled: true, districtCodes: [], options: [] };

const existingOptionInput = (option: DeliveryZonesResponse["zones"][number]["options"][number]): OptionInput => option.method === "home"
  ? { kind: "existing", id: option.id, method: "home", name: option.name, enabled: option.enabled, price: option.price }
  : { kind: "existing", id: option.id, method: "agency", name: option.name, enabled: option.enabled, price: option.price, agencyIds: option.agencyIds };
const optionDraft = (option: DeliveryZonesResponse["zones"][number]["options"][number]): DeliveryOptionDraft => ({ kind: "existing", id: option.id,
  name: option.name, amount: String(option.price.amount), enabled: option.enabled,
  ...(option.method === "home" ? { method: "home" as const } : { method: "agency" as const, agencyIds: option.agencyIds }) });
const optionInput = (option: DeliveryOptionDraft, currency: DeliveryZonesResponse["currency"]): OptionInput => {
  const fields = { name: option.name.trim(), enabled: option.enabled, price: { amount: Number(option.amount.replace(",", ".")), currency } };
  const method = option.method === "home" ? { method: "home" as const } : { method: "agency" as const, agencyIds: [...option.agencyIds] };
  return option.kind === "existing" ? { kind: "existing", id: option.id, ...method, ...fields } : { kind: "new", ...method, ...fields };
};

type ZoneOption = DeliveryZonesResponse["zones"][number]["options"][number];
// An agency option is only offered while an associated agency is enabled and so is its courier; callers pass the saved couriers.
export const hasEligibleAgency = (option: ZoneOption, state: DeliveryZonesResponse, couriers: readonly (AgencyCourier & Readonly<{ enabled: boolean }>)[]) =>
  option.method === "agency" && option.agencyIds.some(id => {
    const agency = state.agencies.find(value => value.id === id);
    return !!agency?.enabled && couriers.some(courier => courier.courierId === agency.courierId && courier.enabled);
  });

export function DeliveryZonesSection({ state, couriers, loadAgencies, disabled, blocked, onSave, onReload }: Readonly<{
  state: DeliveryZonesResponse; couriers: readonly (AgencyCourier & Readonly<{ enabled: boolean }>)[]; disabled: boolean; blocked: boolean;
  loadAgencies: (courierId: string) => Promise<Result<AgencyCatalogResponse, DeliverySettingsError>>;
  onSave: (request: SaveDeliveryZonesRequest) => Promise<Result<DeliveryZonesResponse, DeliveryZonesError>>;
  onReload: () => void;
}>) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [editing, setEditing] = useState<string | null | undefined>();
  const [draft, setDraft] = useState<Draft>(empty);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const zones = state.zones;
  const save = async (toggle?: string) => {
    if (disabled || blocked) return;
    const parsed = toggle ? null : draftSchema.safeParse(draft);
    if (parsed && !parsed.success) { setError("zonesInvalid"); return; }
    const values = parsed?.success ? draft : null;
    const inputs: ZoneInput[] = zones.map(zone => values && editing === zone.id
      ? { kind: "existing", id: zone.id, name: values.name, enabled: values.enabled, districtCodes: values.districtCodes,
        options: values.options.map(option => optionInput(option, state.currency)) }
      : { kind: "existing", id: zone.id, name: zone.name, districtCodes: zone.districtCodes, enabled: toggle === zone.id ? !zone.enabled : zone.enabled,
        options: zone.options.map(existingOptionInput) });
    if (values && editing === null) inputs.push({ kind: "new", name: values.name, enabled: values.enabled, districtCodes: values.districtCodes,
      options: values.options.map(option => optionInput(option, state.currency)) });
    setSaved(false);
    const result = await onSave({ expectedVersion: state.version, zones: inputs });
    if (result.success) { setEditing(undefined); setDraft(empty); setError(""); setSaved(true); }
    else setError(result.error.code === "DELIVERY_SETTINGS_CONFLICT" ? "zonesConflict"
      : ["INVALID_DELIVERY_ZONE", "INVALID_DELIVERY_OPTION", "INVALID_INPUT"].includes(result.error.code) ? "zonesInvalid" : "zonesSaveError");
  };
  const setOption = (index: number, change: Partial<Pick<DeliveryOptionDraft, "name" | "amount" | "enabled">> | { agencyIds: string[] }) =>
    setDraft({ ...draft, options: draft.options.map((option, i) => i === index ? { ...option, ...change } : option) });
  const locked = disabled || blocked;
  return <View testID="delivery-zones" style={styles.section}>
    <ThemedText type="subtitle" accessibilityRole="header">{t("zonesTitle")}</ThemedText>
    <ThemedText type="small" themeColor="textSecondary">{t("zonesHint")}</ThemedText>
    {(["home", "agency"] as const).filter(method => state[method].enabled && !zones.some(zone => zone.enabled && zone.options.some(option => option.enabled && option.method === method))).map(method =>
      <ThemedText key={method} type="small" themeColor="textSecondary" accessibilityLiveRegion="polite">{t(method === "home" ? "zonesMissingHome" : "zonesMissingAgency")}</ThemedText>)}
    {zones.length === 0 ? <ThemedText themeColor="textSecondary">{t("zonesEmpty")}</ThemedText> : null}
    {zones.map(zone => <View key={zone.id} style={[styles.zone, { borderColor: theme.input }]}>
      <ThemedText style={styles.name}>{zone.name}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{zone.districtCodes.map(code => `${getPeruDistrict(code)?.name} · ${code}`).join(", ")}</ThemedText>
      {zone.options.map(option => <ThemedText key={option.id} type="small">{`${option.name} · ${t(option.method === "home" ? "optionHome" : "optionAgency")} · ${option.price.amount === 0 ? t("zonesFree") : `S/ ${option.price.amount.toFixed(2)}`}${option.enabled ? "" : ` · ${t("optionInactive")}`}${option.method === "agency" && !hasEligibleAgency(option, state, couriers) ? ` · ${t("optionNoEligibleAgencies")}` : ""}`}</ThemedText>)}
      <ThemedText type="small">{t(zone.enabled ? "zonesActive" : "zonesInactive")}</ThemedText>
      <Button variant="secondary" disabled={locked} onPress={() => { setDraft({ name: zone.name, enabled: zone.enabled, districtCodes: zone.districtCodes, options: zone.options.map(optionDraft) }); setEditing(zone.id); setSaved(false); setError(""); }}>{t("zonesEdit", { name: zone.name })}</Button>
      <Button variant="ghost" disabled={locked || editing !== undefined} onPress={() => void save(zone.id)}>{t(zone.enabled ? "zonesDisable" : "zonesEnable", { name: zone.name })}</Button>
    </View>)}
    {editing === undefined ? <Button variant="secondary" disabled={locked} onPress={() => { setDraft(empty); setEditing(null); setSaved(false); setError(""); }}>{t("zonesAdd")}</Button> :
      <View style={styles.section}>
        <Field disabled={locked} required><FieldLabel>{t("zonesName")}</FieldLabel><Input accessibilityLabel={t("zonesName")} maxLength={120} value={draft.name} onChangeText={name => setDraft({ ...draft, name })} /></Field>
        <PeruDistrictMultiSelect value={draft.districtCodes as PeruDistrictCode[]} disabled={locked} onChange={codes => setDraft({ ...draft, districtCodes: [...codes] })} />
        <View style={styles.toggle}><ThemedText style={styles.label}>{t("zonesActive")}</ThemedText><Switch accessibilityLabel={t("zonesActive")} value={draft.enabled} disabled={locked} trackColor={{ true: theme.primary }} onValueChange={enabled => setDraft({ ...draft, enabled })} /></View>
        <ThemedText type="subtitle" accessibilityRole="header">{t("optionsTitle")}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{t("zonesPriceHint")}</ThemedText>
        {draft.options.map((option, index) => <View key={option.kind === "existing" ? option.id : `new-${option.localKey}`} style={[styles.zone, { borderColor: theme.input }]}>
          <ThemedText type="small">{t(option.method === "home" ? "optionHome" : "optionAgency")}</ThemedText>
          <Field disabled={locked} required><FieldLabel>{t("optionName")}</FieldLabel><Input accessibilityLabel={t("optionName")} maxLength={120} value={option.name} onChangeText={name => setOption(index, { name })} /></Field>
          <Field disabled={locked} required><FieldLabel>{t("zonesPrice")}</FieldLabel><Input accessibilityLabel={t("zonesPrice")} keyboardType="decimal-pad" value={option.amount} onChangeText={amount => setOption(index, { amount })} /></Field>
          {option.method === "agency" ? <AgencyPicker couriers={couriers} known={state.agencies} value={option.agencyIds} disabled={locked} loadCatalog={loadAgencies}
            onChange={agencyIds => setOption(index, { agencyIds })} /> : null}
          <View style={styles.toggle}><ThemedText style={styles.label}>{t("optionActive")}</ThemedText><Switch accessibilityLabel={`${t("optionActive")} ${index + 1}`} value={option.enabled} disabled={locked} trackColor={{ true: theme.primary }} onValueChange={enabled => setOption(index, { enabled })} /></View>
          {option.kind === "new" ? <Button variant="ghost" disabled={locked} onPress={() => setDraft({ ...draft, options: draft.options.filter((_, i) => i !== index) })}>{t("optionRemove")}</Button> : null}
        </View>)}
        <Button variant="secondary" disabled={locked} onPress={() => setDraft({ ...draft, options: [...draft.options, { kind: "new", localKey: nextKey(draft.options), method: "home", name: "", amount: "", enabled: true }] })}>{t("optionAddHome")}</Button>
        {state.agency.enabled ? <Button variant="secondary" disabled={locked} onPress={() => setDraft({ ...draft, options: [...draft.options, { kind: "new", localKey: nextKey(draft.options), method: "agency", agencyIds: [], name: "", amount: "", enabled: true }] })}>{t("optionAddAgency")}</Button> : null}
        <Button disabled={locked} loading={disabled} onPress={() => void save()}>{t("zonesSave")}</Button>
        <Button variant="ghost" disabled={locked} onPress={() => { setDraft(empty); setEditing(undefined); setError(""); }}>{t("zonesCancel")}</Button>
      </View>}
    {error ? <ThemedText accessibilityRole="alert" style={{ color: theme.error }}>{t(error)}</ThemedText> : null}
    {saved ? <ThemedText accessibilityLiveRegion="polite">{t("zonesSaved")}</ThemedText> : null}
    {blocked && error ? <Button variant="secondary" disabled={disabled} onPress={onReload}>{t("reloadDeliverySettings")}</Button> : null}
  </View>;
}
const styles = StyleSheet.create({ section: { gap: 12 }, zone: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 16, gap: 8 },
  name: { fontWeight: "600" }, toggle: { flexDirection: "row", alignItems: "center", gap: 16, minHeight: 48 }, label: { flex: 1 } });
