import { useCallback, useState } from "react";
import { Linking, Platform, ScrollView, Share, StyleSheet, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import { useTranslation } from "react-i18next";
import type { CatalogSettingsResponse } from "@shared/contracts/catalog";
import { catalogSettings } from "@mobile/features/catalog/composition";
import { ThemedText } from "@mobile/components/themed-text";
import { ThemedView } from "@mobile/components/themed-view";
import { Button } from "@mobile/components/ui/button";
import { ScreenState } from "@mobile/components/ui/screen-state";
import { useTheme } from "@mobile/hooks/use-theme";

export default function CatalogSettingsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const [settings, setSettings] = useState<CatalogSettingsResponse | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  // Every return to the screen re-reads, so a change made in Apariencia de la tienda shows. The last known state stays meanwhile, and a failed re-read keeps it.
  const load = useCallback(() => {
    void catalogSettings.get().then(result => { if (result.success) { setSettings(result.data); setLoadFailed(false); } else setLoadFailed(true); });
  }, []);
  useFocusEffect(load);

  if (!settings) return loadFailed
    ? <ScreenState status="error" title={t("catalogLoadError")} onRetry={() => { setLoadFailed(false); load(); }} />
    : <ScreenState status="loading" title={t("catalogLoading")} />;

  const { url } = settings;
  const copy = async () => { if (url !== null && await Clipboard.setStringAsync(url)) setCopied(true); };

  return <ThemedView style={styles.page}><SafeAreaView style={styles.page} edges={Platform.OS === "ios" ? ["top", "left", "right", "bottom"] : ["top", "left", "right"]}>
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <View style={styles.heading}><ThemedText type="title" accessibilityRole="header">{t("catalogSettingsTitle")}</ThemedText>
        <ThemedText themeColor="textSecondary">{t("catalogSettingsDescription")}</ThemedText></View>
      {settings.published && url !== null ? <View style={[styles.section, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}><View style={styles.heading}>
          <ThemedText type="small" themeColor="textSecondary">{t("catalogLink")}</ThemedText>
          <ThemedText selectable>{url}</ThemedText>
          <Button onPress={() => void copy()}>{t("catalogCopy")}</Button>
          <Button variant="secondary" onPress={() => void Share.share({ message: url }).catch(() => undefined)}>{t("catalogShare")}</Button>
          <Button variant="secondary" onPress={() => void Linking.openURL(url).catch(() => undefined)}>{t("catalogView")}</Button>
        </View></View> : null}
      {copied ? <ThemedText accessibilityLiveRegion="polite">{t("catalogCopied")}</ThemedText> : null}
      <View style={styles.heading}>
        <ThemedText themeColor="textSecondary">{t(settings.published ? "catalogHideElsewhere" : "catalogHiddenElsewhere")}</ThemedText>
        <Button variant="secondary" onPress={() => router.push("/settings/appearance")}>{t("catalogGoToAppearance")}</Button>
      </View>
    </ScrollView>
  </SafeAreaView></ThemedView>;
}

const styles = StyleSheet.create({ page: { flex: 1 }, content: { padding: 16, gap: 24, paddingBottom: 24, width: "100%", maxWidth: 640, alignSelf: "center" },
  heading: { gap: 8 }, section: { gap: 16, padding: 16, borderWidth: 1, borderRadius: 8 } });
