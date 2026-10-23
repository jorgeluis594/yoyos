import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, type LayoutChangeEvent } from "react-native";
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

/** What the screen needs from the «Publicar catálogo» card: whether its link is edited and unsaved, and when its field takes focus. */
export type PublicationSlot = Readonly<{ onUnsavedLinkChange: (unsaved: boolean) => void; onFieldFocus: () => void }>;

/**
 * `publication` is the «Publicar catálogo» card, composed by the route: it loads, fails and saves apart from the draft.
 * `focus="catalog"` opens the editor scrolled to the card, without focusing its field.
 */
export function StoreAppearanceScreen({ publication: Publication, focus }: Readonly<{ publication: ComponentType<PublicationSlot>; focus?: string }>) {
  const { t } = useTranslation();
  const theme = useTheme();
  const navigation = useNavigation();
  const appearance = useStoreAppearance();
  const { load, draft, logo, save, changed, uploading, saving } = appearance;
  const [unsavedLink, setUnsavedLink] = useState(false);
  const scroll = useRef<ScrollView>(null);
  const cardTop = useRef<number | null>(null);
  // Set while the card must be on screen: from opening with focus=catalog, and while its field has focus. The seller scrolling by hand ends the first.
  const revealing = useRef(focus === "catalog");
  const typing = useRef(false);
  const revealCard = useCallback(() => {
    if (cardTop.current !== null) scroll.current?.scrollTo({ y: Math.max(cardTop.current - 8, 0), animated: false });
  }, []);
  const onCardLayout = (event: LayoutChangeEvent) => { cardTop.current = event.nativeEvent.layout.y; if (revealing.current) revealCard(); };
  const slot: PublicationSlot = { onUnsavedLinkChange: setUnsavedLink, onFieldFocus: () => { typing.current = true; revealCard(); } };
  useEffect(() => {
    const shown = Keyboard.addListener("keyboardDidShow", () => { if (typing.current) revealCard(); });
    const hidden = Keyboard.addListener("keyboardDidHide", () => { typing.current = false; });
    return () => { shown.remove(); hidden.remove(); };
  }, [revealCard]);
  useIosAnnouncement(save.kind === "saved" ? t("appearanceSaved") : null);
  const leaveDescription = changed && unsavedLink ? "appearanceLeaveBothDescription" : unsavedLink ? "appearanceLeaveLinkDescription" : "appearanceLeaveDescription";
  // Only leaving the settings stack asks; switching tabs keeps the screen and its draft.
  usePreventRemove(changed || unsavedLink, ({ data }) => showConfirmation({ title: t("appearanceLeaveTitle"), description: t(leaveDescription),
    confirmLabel: t("appearanceDiscardAndLeave"), cancelLabel: t("keepEditing"), destructive: true, onConfirm: () => navigation.dispatch(data.action) }));

  return <ThemedView style={styles.page}><SafeAreaView style={styles.page} edges={Platform.OS === "ios" ? ["top", "left", "right", "bottom"] : ["top", "left", "right"]}>
    <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === "ios" ? "padding" : undefined}>
    <ScrollView ref={scroll} style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" onScrollBeginDrag={() => { revealing.current = false; }}>
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
      <View onLayout={onCardLayout}><Publication {...slot} /></View>
    </ScrollView>
    {appearance.showBar ? <SaveBar changed={changed} uploading={uploading} save={save} onDiscard={appearance.discard} onSave={() => void appearance.submit()} /> : null}
    </KeyboardAvoidingView>
  </SafeAreaView></ThemedView>;
}

const styles = StyleSheet.create({ page: { flex: 1 }, content: { padding: 16, gap: 24, paddingBottom: 24, width: "100%", maxWidth: 640, alignSelf: "center" },
  heading: { gap: 8 }, section: { gap: 12, padding: 16, borderWidth: 1, borderRadius: 8 } });
