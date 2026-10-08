import { useState } from "react";
import { StyleSheet, Switch, View } from "react-native";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import type { DeliveryZonesResponse, SaveDeliveryZonesRequest } from "@shared/contracts/delivery-settings";
import type { Result } from "@shared/result";
import { getPeruDistrict, type PeruDistrictCode } from "@shared/peru-geography";
import type { DeliveryZonesError } from "@mobile/features/delivery-settings/application/delivery-settings";
import { PeruDistrictMultiSelect } from "@mobile/components/peru-district-multi-select";
import { ThemedText } from "@mobile/components/themed-text";
import { Button } from "@mobile/components/ui/button";
import { Field, FieldLabel } from "@mobile/components/ui/field";
import { Input } from "@mobile/components/ui/input";
import { useTheme } from "@mobile/hooks/use-theme";

const draftSchema = z.object({ name: z.string().trim().min(1).max(120), enabled: z.boolean(),
  districtCodes: z.array(z.string().refine(code => getPeruDistrict(code) !== null)).min(1).refine(codes => new Set(codes).size === codes.length),
  amount: z.string().regex(/^\d+(?:[.,]\d{1,2})?$/).refine(value => Number(value.replace(",", ".")) <= 9999999999999.99),
});
type Draft = z.infer<typeof draftSchema>;
const empty: Draft = { name: "", enabled: true, districtCodes: [], amount: "" };

export function DeliveryZonesSection({ method, state, disabled, blocked, onSave, onReload }: Readonly<{
  method: "home" | "agency"; state: DeliveryZonesResponse; disabled: boolean; blocked: boolean;
  onSave: (request: SaveDeliveryZonesRequest) => Promise<Result<DeliveryZonesResponse, DeliveryZonesError>>;
  onReload: () => void;
}>) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [editing, setEditing] = useState<string | null | undefined>();
  const [draft, setDraft] = useState<Draft>(empty);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const zones = state.zones.filter(zone => zone.method === method);
  const save = async (toggle?: string) => {
    if (disabled || blocked) return;
    const parsed = toggle ? null : draftSchema.safeParse(draft);
    if (parsed && !parsed.success) { setError("zonesInvalid"); return; }
    const values = parsed?.success ? parsed.data : null;
    const price = values ? { amount: Number(values.amount.replace(",", ".")), currency: state.currency } : null;
    const inputs: SaveDeliveryZonesRequest["zones"] = zones.map(zone => ({ kind: "existing", id: zone.id,
      name: values && editing === zone.id ? values.name : zone.name,
      districtCodes: values && editing === zone.id ? values.districtCodes : zone.districtCodes,
      enabled: toggle === zone.id ? !zone.enabled : values && editing === zone.id ? values.enabled : zone.enabled,
      price: price && editing === zone.id ? price : zone.price }));
    if (values && price && editing === null) inputs.push({ kind: "new", name: values.name, enabled: values.enabled, districtCodes: values.districtCodes, price });
    setSaved(false);
    const result = await onSave({ method, expectedVersion: state.version, zones: inputs });
    if (result.success) { setEditing(undefined); setDraft(empty); setError(""); setSaved(true); }
    else setError(result.error.code === "DELIVERY_SETTINGS_CONFLICT" ? "zonesConflict"
      : result.error.code === "INVALID_DELIVERY_ZONE" || result.error.code === "INVALID_INPUT" ? "zonesInvalid" : "zonesSaveError");
  };
  const locked = disabled || blocked;
  return <View testID={`delivery-zones-${method}`} style={styles.section}>
    <ThemedText type="subtitle" accessibilityRole="header">{t("zonesTitle")}</ThemedText>
    <ThemedText type="small" themeColor="textSecondary">{t("zonesHint")}</ThemedText>
    {state[method].enabled && !zones.some(zone => zone.enabled) ? <ThemedText accessibilityLiveRegion="polite">{t("zonesMissing")}</ThemedText> : null}
    {zones.length === 0 ? <ThemedText themeColor="textSecondary">{t("zonesEmpty")}</ThemedText> : null}
    {zones.map(zone => <View key={zone.id} style={[styles.zone, { borderColor: theme.input }]}>
      <ThemedText style={styles.name}>{zone.name}</ThemedText>
      <ThemedText>{zone.price.amount === 0 ? t("zonesFree") : `S/ ${zone.price.amount.toFixed(2)}`}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{zone.districtCodes.map(code => `${getPeruDistrict(code)?.name} · ${code}`).join(", ")}</ThemedText>
      <ThemedText type="small">{t(zone.enabled ? "zonesActive" : "zonesInactive")}</ThemedText>
      <Button variant="secondary" disabled={locked} onPress={() => { setDraft({ name: zone.name, enabled: zone.enabled, districtCodes: zone.districtCodes, amount: String(zone.price.amount) }); setEditing(zone.id); setSaved(false); }}>{t("zonesEdit", { name: zone.name })}</Button>
      <Button variant="ghost" disabled={locked || editing !== undefined} onPress={() => void save(zone.id)}>{t(zone.enabled ? "zonesDisable" : "zonesEnable", { name: zone.name })}</Button>
    </View>)}
    {editing === undefined ? <Button variant="secondary" disabled={locked} onPress={() => { setDraft(empty); setEditing(null); setSaved(false); setError(""); }}>{t("zonesAdd")}</Button> :
      <View style={styles.section}>
        <Field disabled={locked} required><FieldLabel>{t("zonesName")}</FieldLabel><Input accessibilityLabel={t("zonesName")} maxLength={120} value={draft.name} onChangeText={name => setDraft({ ...draft, name })} /></Field>
        <PeruDistrictMultiSelect value={draft.districtCodes as PeruDistrictCode[]} disabled={locked} onChange={codes => setDraft({ ...draft, districtCodes: [...codes] })} />
        <Field disabled={locked} required><FieldLabel>{t("zonesPrice")}</FieldLabel><Input accessibilityLabel={t("zonesPrice")} keyboardType="decimal-pad" value={draft.amount} onChangeText={amount => setDraft({ ...draft, amount })} /></Field>
        <ThemedText type="small" themeColor="textSecondary">{t("zonesPriceHint")}</ThemedText>
        <View style={styles.toggle}><ThemedText style={styles.label}>{t("zonesActive")}</ThemedText><Switch accessibilityLabel={t("zonesActive")} value={draft.enabled} disabled={locked} trackColor={{ true: theme.primary }} onValueChange={enabled => setDraft({ ...draft, enabled })} /></View>
        <Button disabled={locked} loading={disabled} onPress={() => void save()}>{t("zonesSave")}</Button>
        <Button variant="ghost" disabled={disabled} onPress={() => { setDraft(empty); setEditing(undefined); setError(""); }}>{t("zonesCancel")}</Button>
      </View>}
    {error ? <ThemedText accessibilityRole="alert" style={{ color: theme.error }}>{t(error)}</ThemedText> : null}
    {saved ? <ThemedText accessibilityLiveRegion="polite">{t("zonesSaved")}</ThemedText> : null}
    {blocked && error ? <Button variant="secondary" disabled={disabled} onPress={onReload}>{t("reloadDeliverySettings")}</Button> : null}
  </View>;
}
const styles = StyleSheet.create({ section: { gap: 12 }, zone: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 16, gap: 8 },
  name: { fontWeight: "600" }, toggle: { flexDirection: "row", alignItems: "center", gap: 16, minHeight: 48 }, label: { flex: 1 } });
