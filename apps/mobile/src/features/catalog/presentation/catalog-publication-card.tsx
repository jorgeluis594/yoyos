import { useEffect, useState } from "react";
import { StyleSheet, Switch, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { CatalogSettingsResponse } from "@shared/contracts/catalog";
import { catalogSettings } from "@mobile/features/catalog/composition";
import { ThemedText } from "@mobile/components/themed-text";
import { Button } from "@mobile/components/ui/button";
import { showConfirmation } from "@mobile/components/ui/show-confirmation";
import { useTheme } from "@mobile/hooks/use-theme";

type Notice = "catalogPublished" | "catalogHidden" | "catalogSaveError" | "";

/** The «Publicar catálogo» switch with its own load, confirmation and error: it saves at once and never depends on another part of its screen. */
export function CatalogPublicationCard() {
  const { t } = useTranslation();
  const theme = useTheme();
  const [settings, setSettings] = useState<CatalogSettingsResponse | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    void catalogSettings.get().then(result => { if (result.success) setSettings(result.data); else setLoadFailed(true); });
  }, [attempt]);

  const section = [styles.section, { backgroundColor: theme.backgroundElement, borderColor: theme.border }];
  if (!settings) return <View style={section}>{loadFailed
    ? <View style={styles.heading}><ThemedText accessibilityRole="alert" style={{ color: theme.error }}>{t("catalogLoadError")}</ThemedText>
      <Button variant="secondary" onPress={() => { setLoadFailed(false); setAttempt(value => value + 1); }}>{t("catalogRetry")}</Button></View>
    : <ThemedText themeColor="textSecondary" accessibilityLiveRegion="polite">{t("catalogLoading")}</ThemedText>}</View>;

  const save = async (published: boolean) => {
    const previous = settings;
    setSettings({ ...previous, published }); setBusy(true); setNotice("");
    const result = await catalogSettings.setPublished(published);
    // A failed write returns the switch to its previous position.
    setSettings(result.success ? result.data : previous);
    setNotice(result.success ? (result.data.published ? "catalogPublished" : "catalogHidden") : "catalogSaveError");
    setBusy(false);
  };
  const toggle = (published: boolean) => published ? void save(true) : showConfirmation({ title: t("catalogHideTitle"),
    description: t("catalogHideDescription"), confirmLabel: t("catalogHide"), cancelLabel: t("catalogKeepPublished"), destructive: true,
    onConfirm: () => void save(false) });

  return <View style={section}>
    <View style={styles.toggle}><View style={[styles.label, styles.heading]}><ThemedText type="subtitle">{t("catalogPublish")}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{t("catalogPublishHint")}</ThemedText></View>
      <Switch accessibilityLabel={t("catalogPublish")} value={settings.published} disabled={busy} hitSlop={10} trackColor={{ true: theme.primary }} onValueChange={toggle} /></View>
    <ThemedText type="small" themeColor="textSecondary">{t("catalogSavedInstantly")}</ThemedText>
    {notice === "catalogSaveError" ? <View style={styles.heading}><ThemedText accessibilityRole="alert" style={{ color: theme.error }}>{t(notice)}</ThemedText>
      {/* The hide was already confirmed, so retrying does not ask again. */}
      <Button variant="secondary" disabled={busy} onPress={() => void save(!settings.published)}>{t("catalogRetry")}</Button></View>
      : notice ? <ThemedText accessibilityLiveRegion="polite">{t(notice)}</ThemedText> : null}
  </View>;
}

const styles = StyleSheet.create({ heading: { gap: 8 }, section: { gap: 16, padding: 16, borderWidth: 1, borderRadius: 8 },
  toggle: { flexDirection: "row", alignItems: "center", gap: 16, minHeight: 48 }, label: { flex: 1 } });
