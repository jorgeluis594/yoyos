import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { ThemedText } from "@mobile/components/themed-text";
import { ThemedView } from "@mobile/components/themed-view";
import { Button } from "@mobile/components/ui/button";
import { informationalErrorCodes } from "@mobile/features/whatsapp/application/reception-lifecycle";
import { QrCode } from "@mobile/features/whatsapp/presentation/qr-code";
import { useWhatsApp } from "@mobile/features/whatsapp/presentation/whatsapp-provider";
import { useTheme } from "@mobile/hooks/use-theme";

type Feedback = "linkError" | "unlinkError" | "remoteLogoutUnconfirmed" | null;

function useSecondsLeft(expiresAt: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return expiresAt === null ? null : Math.max(0, Math.ceil((expiresAt - now) / 1000));
}

export default function WhatsAppLinkScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { runtime, status, refresh } = useWhatsApp();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const secondsLeft = useSecondsLeft(status.qr?.expiresAt ?? null);

  const run = async (operation: () => Promise<Feedback>) => {
    if (!runtime || busy) return;
    setBusy(true);
    setFeedback(await operation());
    await refresh();
    setBusy(false);
  };
  const link = () => run(async () => (await runtime?.linkAccount())?.success ? null : "linkError");
  const unlink = () => run(async () => {
    const result = await runtime?.unlinkAccount();
    if (!result?.success) return "unlinkError";
    return result.data.remoteLogoutConfirmed ? null : "remoteLogoutUnconfirmed";
  });
  const relink = () => run(async () => {
    const result = await runtime?.unlinkAccount();
    if (!result?.success) return "unlinkError";
    return (await runtime?.linkAccount())?.success ? null : "linkError";
  });
  const newQr = () => run(async () => (await runtime?.reception.connect())?.success ? null : "linkError");

  const expired = secondsLeft === 0;
  const connectionLabel = status.connection === "connected" ? "whatsappConnected"
    : status.connection === "connecting" ? "whatsappConnecting"
    : status.connection === "reconnecting" ? "whatsappReconnecting" : "whatsappDisconnected";

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          <ThemedText type="title" accessibilityRole="header">{t("whatsappTitle")}</ThemedText>

          {status.link === "none" ? (
            <>
              <ThemedText themeColor="textSecondary">{t("whatsappDescription")}</ThemedText>
              <Button loading={busy} disabled={!runtime} onPress={() => void link()}>{t("whatsappLink")}</Button>
            </>
          ) : null}

          {status.link === "otherCompany" ? (
            <>
              <ThemedText accessibilityRole="alert">{t("whatsappOtherCompany")}</ThemedText>
              <Button variant="destructive" loading={busy} onPress={() => void unlink()}>{t("whatsappUnlink")}</Button>
            </>
          ) : null}

          {status.link === "linked" ? (
            <>
              <ThemedText type="subtitle">{t(connectionLabel)}</ThemedText>
              {status.connection === "sessionExpired" ? (
                <>
                  <ThemedText accessibilityRole="alert">{t("whatsappSessionExpired")}</ThemedText>
                  <Button loading={busy} onPress={() => void relink()}>{t("whatsappRelink")}</Button>
                </>
              ) : null}
              {status.qr ? (
                <View style={styles.qr}>
                  <ThemedText themeColor="textSecondary">{t("whatsappAwaitingQr")}</ThemedText>
                  {expired ? (
                    <>
                      <ThemedText accessibilityRole="alert">{t("whatsappQrExpired")}</ThemedText>
                      <Button loading={busy} onPress={() => void newQr()}>{t("whatsappNewQr")}</Button>
                    </>
                  ) : (
                    <>
                      <QrCode value={status.qr.value} accessibilityLabel={t("whatsappAwaitingQr")} />
                      <ThemedText type="small" themeColor="textSecondary">{t("whatsappQrExpiresIn", { seconds: secondsLeft ?? 0 })}</ThemedText>
                    </>
                  )}
                </View>
              ) : null}
              {status.unsynced > 0 ? <ThemedText type="small" themeColor="textSecondary">{t("whatsappUnsynced", { count: status.unsynced })}</ThemedText> : null}
              <Button variant="secondary" loading={busy} onPress={() => void unlink()}>{t("whatsappUnlink")}</Button>
            </>
          ) : null}

          {status.notice && informationalErrorCodes.includes(status.notice) ? (
            <View style={[styles.notice, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText type="small">{t(`whatsappNotice${status.notice}`)}</ThemedText>
            </View>
          ) : null}
          {status.lastError?.code === "LOCAL_STORAGE_FAILED" ? <ThemedText accessibilityRole="alert" style={{ color: theme.error }}>{t("whatsappLocalStorageFailed")}</ThemedText> : null}
          {feedback === "linkError" ? <ThemedText accessibilityRole="alert" style={{ color: theme.error }}>{t("whatsappLinkError")}</ThemedText> : null}
          {feedback === "unlinkError" ? <ThemedText accessibilityRole="alert" style={{ color: theme.error }}>{t("whatsappUnlinkError")}</ThemedText> : null}
          {feedback === "remoteLogoutUnconfirmed" ? <ThemedText accessibilityRole="alert">{t("whatsappRemoteLogoutUnconfirmed")}</ThemedText> : null}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 16, gap: 16 },
  qr: { alignItems: "center", gap: 12 },
  notice: { padding: 12, borderRadius: 8 },
});
