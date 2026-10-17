import { useEffect, useState } from "react";
import { Linking, Platform, ScrollView, Share, StyleSheet, Switch, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import { useTranslation } from "react-i18next";
import type { CatalogSettingsResponse } from "@shared/contracts/catalog";
import { catalogSettings } from "@mobile/features/catalog/composition";
import { ThemedText } from "@mobile/components/themed-text";
import { ThemedView } from "@mobile/components/themed-view";
import { Button } from "@mobile/components/ui/button";
import { ScreenState } from "@mobile/components/ui/screen-state";
import { showConfirmation } from "@mobile/components/ui/show-confirmation";
import { useTheme } from "@mobile/hooks/use-theme";

type Notice = "catalogPublished" | "catalogHidden" | "catalogCopied" | "catalogSaveError" | "";

export default function CatalogSettingsScreen() {
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

  if (!settings) return loadFailed
    ? <ScreenState status="error" title={t("catalogLoadError")} onRetry={() => { setLoadFailed(false); setAttempt(value => value + 1); }} />
    : <ScreenState status="loading" title={t("catalogLoading")} />;

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
  const copy = async () => { if (await Clipboard.setStringAsync(settings.url)) setNotice("catalogCopied"); };

  return <ThemedView style={styles.page}><SafeAreaView style={styles.page} edges={Platform.OS === "ios" ? ["top", "left", "right", "bottom"] : ["top", "left", "right"]}>
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <View style={styles.heading}><ThemedText type="title" accessibilityRole="header">{t("catalogSettingsTitle")}</ThemedText>
        <ThemedText themeColor="textSecondary">{t("catalogSettingsDescription")}</ThemedText></View>
      <View style={[styles.section, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
        <View style={styles.toggle}><View style={[styles.label, styles.heading]}><ThemedText type="subtitle">{t("catalogPublish")}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{t("catalogPublishHint")}</ThemedText></View>
          <Switch accessibilityLabel={t("catalogPublish")} value={settings.published} disabled={busy} hitSlop={10} trackColor={{ true: theme.primary }} onValueChange={toggle} /></View>
        {settings.published ? <View style={styles.heading}>
          <ThemedText type="small" themeColor="textSecondary">{t("catalogLink")}</ThemedText>
          <ThemedText selectable>{settings.url}</ThemedText>
          <Button onPress={() => void copy()}>{t("catalogCopy")}</Button>
          <Button variant="secondary" onPress={() => void Share.share({ message: settings.url })}>{t("catalogShare")}</Button>
          <Button variant="secondary" onPress={() => void Linking.openURL(settings.url)}>{t("catalogView")}</Button>
        </View> : null}
      </View>
      {notice === "catalogSaveError" ? <ThemedText accessibilityRole="alert" style={{ color: theme.error }}>{t(notice)}</ThemedText>
        : notice ? <ThemedText accessibilityLiveRegion="polite">{t(notice)}</ThemedText> : null}
    </ScrollView>
  </SafeAreaView></ThemedView>;
}

const styles = StyleSheet.create({ page: { flex: 1 }, content: { padding: 16, gap: 24, paddingBottom: 24, width: "100%", maxWidth: 640, alignSelf: "center" },
  heading: { gap: 8 }, section: { gap: 16, padding: 16, borderWidth: 1, borderRadius: 8 }, toggle: { flexDirection: "row", alignItems: "center", gap: 16, minHeight: 48 }, label: { flex: 1 } });
