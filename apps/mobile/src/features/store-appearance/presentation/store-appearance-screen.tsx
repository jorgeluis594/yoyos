import type { ReactNode } from "react";
import { Platform, ScrollView, StyleSheet, View } from "react-native";
import { useNavigation } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { ThemedText } from "@mobile/components/themed-text";
import { ThemedView } from "@mobile/components/themed-view";
import { Button } from "@mobile/components/ui/button";
import { showConfirmation } from "@mobile/components/ui/show-confirmation";
import { useTheme } from "@mobile/hooks/use-theme";
import { useIosAnnouncement } from "@mobile/features/store-appearance/presentation/announce-on-ios";
import { LogoSection } from "@mobile/features/store-appearance/presentation/logo-section";
import { SaveBar } from "@mobile/features/store-appearance/presentation/save-bar";
import { ThemeList } from "@mobile/features/store-appearance/presentation/theme-list";
import { useStoreAppearance } from "@mobile/features/store-appearance/presentation/use-store-appearance";

/** `publication` is the «Publicar catálogo» card, composed by the route: it loads, fails and saves apart from the draft. */
export function StoreAppearanceScreen({ publication }: Readonly<{ publication: ReactNode }>) {
  const { t } = useTranslation();
  const theme = useTheme();
  const navigation = useNavigation();
  const appearance = useStoreAppearance();
  const { load, draft, logo, save, changed, uploading, saving } = appearance;
  useIosAnnouncement(save.kind === "saved" ? t("appearanceSaved") : null);
  // Only leaving the settings stack asks; switching tabs keeps the screen and its draft.
  usePreventRemove(changed, ({ data }) => showConfirmation({ title: t("appearanceLeaveTitle"), description: t("appearanceLeaveDescription"),
    confirmLabel: t("appearanceDiscardAndLeave"), cancelLabel: t("keepEditing"), destructive: true, onConfirm: () => navigation.dispatch(data.action) }));

  return <ThemedView style={styles.page}><SafeAreaView style={styles.page} edges={Platform.OS === "ios" ? ["top", "left", "right", "bottom"] : ["top", "left", "right"]}>
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <View style={styles.heading}><ThemedText type="title" accessibilityRole="header">{t("appearanceTitle")}</ThemedText>
        <ThemedText themeColor="textSecondary">{t("appearanceDescription")}</ThemedText>
        {save.kind === "saved" ? <ThemedText accessibilityLiveRegion="polite">{t("appearanceSaved")}</ThemedText> : null}</View>
      {load.status === "loading" ? <ThemedText themeColor="textSecondary" accessibilityLiveRegion="polite">{t("appearanceLoading")}</ThemedText> : null}
      {load.status === "error" ? <View style={[styles.section, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
        <ThemedText accessibilityRole="alert" style={{ color: theme.error }}>{t("appearanceLoadError")}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{t("appearanceLoadErrorDescription")}</ThemedText>
        <Button variant="secondary" onPress={appearance.retryLoad}>{t("retry")}</Button></View> : null}
      {load.status === "ready" ? <>
        {load.unknownTheme ? <View style={[styles.section, { backgroundColor: theme.warningSurface, borderColor: theme.warning }]}><ThemedText type="small">{t("appearanceUnknownTheme")}</ThemedText></View> : null}
        <LogoSection logo={draft.logo} state={logo} disabled={saving} onChoose={appearance.chooseLogo} onRetry={appearance.retryLogo} onRemove={appearance.removeLogo} />
        <ThemeList value={draft.theme} disabled={saving} onChange={appearance.chooseTheme} />
      </> : null}
      {publication}
    </ScrollView>
    {appearance.showBar ? <SaveBar changed={changed} uploading={uploading} save={save} onDiscard={appearance.discard} onSave={() => void appearance.submit()} /> : null}
  </SafeAreaView></ThemedView>;
}

const styles = StyleSheet.create({ page: { flex: 1 }, content: { padding: 16, gap: 24, paddingBottom: 24, width: "100%", maxWidth: 640, alignSelf: "center" },
  heading: { gap: 8 }, section: { gap: 12, padding: 16, borderWidth: 1, borderRadius: 8 } });
