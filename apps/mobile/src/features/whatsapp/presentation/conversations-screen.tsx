import { useEffect, useState } from "react";
import { FlatList, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { ThemedText } from "@mobile/components/themed-text";
import { ThemedView } from "@mobile/components/themed-view";
import { ListRow } from "@mobile/components/ui/list-row";
import { ScreenState } from "@mobile/components/ui/screen-state";
import { useAccess } from "@mobile/features/users/presentation/access-provider";
import type { CompanyId } from "@mobile/features/whatsapp/domain/ids";
import type { ConversationSummary } from "@mobile/features/whatsapp/domain/stored-message";
import { abbreviateLid } from "@mobile/features/whatsapp/presentation/chat-labels";
import { useWhatsApp } from "@mobile/features/whatsapp/presentation/whatsapp-provider";

type Load = { kind: "loading" } | { kind: "error" } | { kind: "ready"; items: readonly ConversationSummary[] };

export default function ConversationsScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { state } = useAccess();
  const { runtime, status } = useWhatsApp();
  const companyId = state.status === "ready" ? state.company.id : null;
  const [load, setLoad] = useState<Load>({ kind: "loading" });

  const [version, setVersion] = useState(0);

  // The unsynced counter changes whenever a message is stored or synced, so it doubles as the refresh signal.
  useEffect(() => {
    if (!runtime || !companyId) return;
    let cancelled = false;
    void runtime.store.listConversations(companyId as CompanyId).then((result) => {
      if (!cancelled) setLoad(result.success ? { kind: "ready", items: result.data } : { kind: "error" });
    });
    return () => { cancelled = true; };
  }, [runtime, companyId, status.unsynced, status.connection, version]);

  if (load.kind === "loading") return <ScreenState status="loading" title={t("whatsappChats")} />;
  if (load.kind === "error") return <ScreenState status="error" title={t("whatsappLoadError")} onRetry={() => { setLoad({ kind: "loading" }); setVersion((value) => value + 1); }} />;
  const when = (date: Date | null) => date === null ? t("whatsappUnknownDate")
    : new Intl.DateTimeFormat(i18n.language, { dateStyle: "short", timeStyle: "short" }).format(date);

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.root}>
        <FlatList
          data={load.items}
          keyExtractor={(item) => item.chatId}
          ListHeaderComponent={<ThemedText type="title" accessibilityRole="header" style={styles.title}>{t("whatsappChats")}</ThemedText>}
          ListEmptyComponent={<ScreenState status="empty" title={t("whatsappNoChats")} description={t("whatsappNoChatsDescription")} />}
          renderItem={({ item }) => (
            <ListRow
              title={abbreviateLid(item.chatId)}
              description={`${item.lastMessage.preview ?? t("whatsappImage")} · ${when(item.lastMessage.sentAt)}`}
              trailing={item.unsynced > 0 ? <ThemedText type="small" themeColor="textSecondary">{t("whatsappUnsyncedBadge")}</ThemedText> : undefined}
              onPress={() => router.push({ pathname: "/whatsapp/chats/[chatId]", params: { chatId: item.chatId } })}
            />
          )}
        />
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 }, title: { padding: 16 } });
