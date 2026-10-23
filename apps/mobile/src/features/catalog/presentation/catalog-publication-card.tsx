import { useEffect, useState } from "react";
import { AccessibilityInfo, Keyboard, StyleSheet, Switch, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { CatalogSettingsResponse } from "@shared/contracts/catalog";
import { catalogSettings } from "@mobile/features/catalog/composition";
import { subdomainRequired } from "@mobile/features/catalog/infrastructure/catalog-settings-api";
import { linkStatus } from "@mobile/features/catalog/presentation/link-status";
import { useCatalogLink } from "@mobile/features/catalog/presentation/use-catalog-link";
import { useCopyLink } from "@mobile/features/catalog/presentation/use-copy-link";
import { ThemedText } from "@mobile/components/themed-text";
import { Button } from "@mobile/components/ui/button";
import { Input } from "@mobile/components/ui/input";
import { showConfirmation } from "@mobile/components/ui/show-confirmation";
import { useTheme } from "@mobile/hooks/use-theme";

type Notice = "catalogPublished" | "catalogHidden" | "catalogSaveError" | "catalogSubdomainRequired" | "";
export type CatalogPublicationCardProps = Readonly<{
  /** Tells the screen whether the typed link is edited and not saved, for its leave confirmation. */
  onUnsavedLinkChange?: (unsaved: boolean) => void;
  /** The field took focus: the screen scrolls so the field, its status line and Guardar link stay above the keyboard. */
  onFieldFocus?: () => void;
}>;

/** The «Publicar catálogo» card: the link (saved with its own button) and the publication switch (saved at once), with their own load, confirmation and errors, apart from the screen's draft. */
export function CatalogPublicationCard({ onUnsavedLinkChange, onFieldFocus }: CatalogPublicationCardProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [settings, setSettings] = useState<CatalogSettingsResponse | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>("");
  const [attempt, setAttempt] = useState(0);
  const link = useCatalogLink(settings, setSettings);
  const copying = useCopyLink(settings?.url ?? null);
  useEffect(() => {
    void catalogSettings.get().then(result => { if (result.success) setSettings(result.data); else setLoadFailed(true); });
  }, [attempt]);
  useEffect(() => { onUnsavedLinkChange?.(link.hasUnsavedLink); }, [link.hasUnsavedLink, onUnsavedLinkChange]);

  const status = settings ? linkStatus(t, link.field, link.notice, settings.domain, link.raceLost) : null;
  const announcement = status?.announce ? status.text : null;
  useEffect(() => { if (announcement) AccessibilityInfo.announceForAccessibility(announcement); }, [announcement]);

  const section = [styles.section, { backgroundColor: theme.backgroundElement, borderColor: theme.border }];
  if (!settings || !status) return <View style={section}>{loadFailed
    ? <View style={styles.heading}><ThemedText accessibilityRole="alert" style={{ color: theme.error }}>{t("catalogLoadError")}</ThemedText>
      <Button variant="secondary" onPress={() => { setLoadFailed(false); setAttempt(value => value + 1); }}>{t("catalogRetry")}</Button></View>
    : <ThemedText themeColor="textSecondary" accessibilityLiveRegion="polite">{t("catalogLoading")}</ThemedText>}</View>;

  const save = async (published: boolean) => {
    const previous = settings;
    setSettings({ ...previous, published }); setBusy(true); setNotice("");
    const result = await catalogSettings.setPublished(published);
    // A failed write returns the switch to its previous position.
    setSettings(result.success ? result.data : previous);
    setNotice(result.success ? (result.data.published ? "catalogPublished" : "catalogHidden")
      : subdomainRequired(result.error) ? "catalogSubdomainRequired" : "catalogSaveError");
    setBusy(false);
  };
  const toggle = (published: boolean) => published ? void save(true) : showConfirmation({ title: t("catalogHideTitle"),
    description: t("catalogHideDescription"), confirmLabel: t("catalogHide"), cancelLabel: t("catalogKeepPublished"), destructive: true,
    onConfirm: () => void save(false) });

  const linkBusy = link.phase !== "idle";
  const statusColor = status.tone === "error" ? theme.error : status.tone === "success" ? theme.success : theme.textSecondary;
  const needsLink = settings.subdomain === null;

  return <View style={section}>
    <View style={styles.heading}>
      <ThemedText type="subtitle" accessibilityRole="header">{t("catalogLinkLabel")}</ThemedText>
      <View style={styles.fieldRow}>
        <Input ref={link.inputRef} style={styles.field} value={link.value} onChangeText={link.edit} disabled={linkBusy}
          accessibilityLabel={t("catalogLinkLabel")} accessibilityHint={`.${settings.domain}. ${status.text}`}
          autoCapitalize="none" autoCorrect={false} spellCheck={false} keyboardType="url" returnKeyType="done" returnKeyLabel={t("catalogLinkReturnKey")}
          invalid={status.tone === "error"} onFocus={onFieldFocus}
          onSubmitEditing={() => { if (link.canSave) link.submit(); else Keyboard.dismiss(); }} />
        <ThemedText themeColor="textSecondary">{`.${settings.domain}`}</ThemedText>
      </View>
      <View style={styles.status}>
        <ThemedText style={{ color: statusColor }} accessible={false}>{status.success ? `✓ ${status.text}` : status.text}</ThemedText>
        {link.canRetry ? <Button variant="secondary" onPress={link.retry}>{t("catalogRetry")}</Button> : null}
      </View>
      <Button variant="secondary" disabled={!link.canSave} loading={link.phase === "saving"} onPress={link.submit}>
        {link.phase === "saving" ? t("catalogLinkSaving") : t("catalogLinkSave")}</Button>
      <ThemedText type="small" themeColor="textSecondary">{t("catalogLinkSaveHint")}</ThemedText>
      {settings.url !== null ? <ThemedText selectable>{t("catalogYourLink", { url: settings.url })}</ThemedText> : null}
      {settings.url !== null && settings.published ? <View style={styles.heading}>
        <Button variant="secondary" onPress={() => void copying.copy()}>{t("catalogCopy")}</Button>
        <Button variant="secondary" onPress={copying.open}>{t("catalogView")}</Button>
        {copying.copied ? <ThemedText accessibilityLiveRegion="polite">{t("catalogCopied")}</ThemedText> : null}
      </View> : null}
    </View>
    <View style={[styles.divider, { backgroundColor: theme.border }]} />
    <View style={styles.heading}>
      <View style={styles.toggle}><View style={[styles.label, styles.heading]}><ThemedText type="subtitle">{t("catalogPublish")}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{t("catalogPublishHint")}</ThemedText></View>
        <Switch accessibilityLabel={t("catalogPublish")} accessibilityHint={needsLink ? t("catalogSubdomainRequired") : undefined} value={settings.published}
          disabled={busy || linkBusy || needsLink} hitSlop={10} trackColor={{ true: theme.primary }} onValueChange={toggle} /></View>
      {needsLink ? <ThemedText type="small" themeColor="textSecondary">{t("catalogSubdomainRequired")}</ThemedText> : null}
      <ThemedText type="small" themeColor="textSecondary">{t("catalogSavedInstantly")}</ThemedText>
      {notice === "catalogSaveError" ? <View style={styles.heading}><ThemedText accessibilityRole="alert" style={{ color: theme.error }}>{t(notice)}</ThemedText>
        {/* The hide was already confirmed, so retrying does not ask again. */}
        <Button variant="secondary" disabled={busy} onPress={() => void save(!settings.published)}>{t("catalogRetry")}</Button></View>
        : notice === "catalogSubdomainRequired" ? <ThemedText accessibilityRole="alert" style={{ color: theme.error }}>{t(notice)}</ThemedText>
        : notice ? <ThemedText accessibilityLiveRegion="polite">{t(notice)}</ThemedText> : null}
    </View>
  </View>;
}

const styles = StyleSheet.create({ heading: { gap: 8 }, section: { gap: 16, padding: 16, borderWidth: 1, borderRadius: 8 },
  fieldRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 8, rowGap: 4 }, field: { flexGrow: 1, flexBasis: 200 },
  status: { gap: 8 }, divider: { height: StyleSheet.hairlineWidth },
  toggle: { flexDirection: "row", alignItems: "center", gap: 16, minHeight: 48 }, label: { flex: 1 } });
