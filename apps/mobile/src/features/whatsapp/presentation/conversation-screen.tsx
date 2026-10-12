import { useEffect, useRef, useState } from "react";
import { FlatList, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { ThemedText } from "@mobile/components/themed-text";
import { ThemedView } from "@mobile/components/themed-view";
import { Button } from "@mobile/components/ui/button";
import { ScreenState } from "@mobile/components/ui/screen-state";
import { useAccess } from "@mobile/features/users/presentation/access-provider";
import { parseChatId, type CompanyId } from "@mobile/features/whatsapp/domain/ids";
import type { StoredMessage } from "@mobile/features/whatsapp/domain/stored-message";
import { abbreviateLid } from "@mobile/features/whatsapp/presentation/chat-labels";
import { MessageImage } from "@mobile/features/whatsapp/presentation/message-image";
import { useWhatsApp } from "@mobile/features/whatsapp/presentation/whatsapp-provider";
import { useTheme } from "@mobile/hooks/use-theme";

const pageSize = 30;

/** Messages are newest first: the latest page replaces its copies by id (sync state may have changed) and keeps the older pages already loaded. */
export function mergeLatest(previous: readonly StoredMessage[], latest: readonly StoredMessage[]): readonly StoredMessage[] {
  const latestIds = new Set(latest.map((message) => message.id));
  return [...latest, ...previous.filter((message) => !latestIds.has(message.id))];
}

export default function ConversationScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const { chatId: rawChatId } = useLocalSearchParams<{ chatId: string }>();
  const { state } = useAccess();
  const { runtime, messagesVersion } = useWhatsApp();
  const companyId = state.status === "ready" ? state.company.id : null;
  const chat = parseChatId(String(rawChatId ?? ""));
  const [messages, setMessages] = useState<readonly StoredMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  const chatId = chat.success ? chat.data : null;
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    if (!runtime || !companyId || chatId === null) return;
    let cancelled = false;
    void runtime.store.listMessages(companyId as CompanyId, chatId, { beforeArrivalSeq: null, limit: pageSize }).then((result) => {
      if (cancelled) return;
      if (!result.success) { setStatus("error"); return; }
      setMessages(result.data);
      setHasMore(result.data.length === pageSize);
      setStatus("ready");
    });
    return () => { cancelled = true; };
  }, [runtime, companyId, chatId, reloads]);

  // A change in any chat merges the newest page in place, so older pages the user loaded stay on screen.
  const handledVersion = useRef(messagesVersion);
  useEffect(() => {
    if (handledVersion.current === messagesVersion) return;
    handledVersion.current = messagesVersion;
    if (!runtime || !companyId || chatId === null) return;
    let cancelled = false;
    void runtime.store.listMessages(companyId as CompanyId, chatId, { beforeArrivalSeq: null, limit: pageSize }).then((result) => {
      if (!cancelled && result.success) setMessages((previous) => mergeLatest(previous, result.data));
    });
    return () => { cancelled = true; };
  }, [runtime, companyId, chatId, messagesVersion]);

  const loadOlder = async (before: number | null) => {
    if (!runtime || !companyId || chatId === null) return;
    const result = await runtime.store.listMessages(companyId as CompanyId, chatId, { beforeArrivalSeq: before, limit: pageSize });
    if (!result.success) { setStatus("error"); return; }
    setMessages((previous) => [...previous, ...result.data]);
    setHasMore(result.data.length === pageSize);
  };

  if (!chat.success) return <ScreenState status="empty" title={t("whatsappChatNotFound")} />;
  if (status === "loading") return <ScreenState status="loading" title={abbreviateLid(chat.data)} />;
  if (status === "error") return <ScreenState status="error" title={t("whatsappLoadError")} onRetry={() => { setStatus("loading"); setReloads((value) => value + 1); }} />;

  const when = (date: Date | null) => date === null ? t("whatsappUnknownDate")
    : new Intl.DateTimeFormat(i18n.language, { dateStyle: "short", timeStyle: "short" }).format(date);
  const oldest = messages[messages.length - 1]?.arrivalSeq ?? null;

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.root}>
        <FlatList
          data={messages}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={<ThemedText type="title" accessibilityRole="header" style={styles.title}>{abbreviateLid(chat.data)}</ThemedText>}
          ListEmptyComponent={<ScreenState status="empty" title={t("whatsappChatNotFound")} />}
          ListFooterComponent={hasMore ? <Button variant="ghost" onPress={() => void loadOlder(oldest)}>{t("whatsappLoadMore")}</Button> : null}
          renderItem={({ item }) => (
            <View style={[styles.bubble, { backgroundColor: item.direction === "incoming" ? theme.backgroundElement : theme.backgroundSelected }]}>
              {item.content.type === "image" && runtime && companyId ? <MessageImage runtime={runtime} companyId={companyId} messageId={item.id} /> : null}
              {item.content.type === "text" ? <ThemedText>{item.content.text}</ThemedText> : item.content.caption ? <ThemedText>{item.content.caption}</ThemedText> : null}
              <ThemedText type="small" themeColor="textSecondary">
                {`${item.direction === "incoming" ? t("whatsappIncoming") : t("whatsappOutgoing")} · ${when(item.sentAt)}`}
              </ThemedText>
            </View>
          )}
        />
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  title: { padding: 16 },
  bubble: { marginHorizontal: 16, marginVertical: 4, padding: 12, borderRadius: 12, gap: 6 },
});
