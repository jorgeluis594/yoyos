import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, FlatList, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { ThemedText } from "@mobile/components/themed-text";
import { ThemedView } from "@mobile/components/themed-view";
import { Button } from "@mobile/components/ui/button";
import { ScreenState } from "@mobile/components/ui/screen-state";
import { useAccess } from "@mobile/features/users/presentation/access-provider";
import { useNoticeArrivals } from "@mobile/features/notifications/presentation/notices-provider";
import { locateNoticeMessage } from "@mobile/features/whatsapp/application/locate-notice-message";
import { parseChatId, parseCoreMessageId, type CompanyId } from "@mobile/features/whatsapp/domain/ids";
import type { StoredMessage } from "@mobile/features/whatsapp/domain/stored-message";
import { abbreviateLid } from "@mobile/features/whatsapp/presentation/chat-labels";
import { MessageImage } from "@mobile/features/whatsapp/presentation/message-image";
import { useWhatsApp } from "@mobile/features/whatsapp/presentation/whatsapp-provider";
import { useTheme } from "@mobile/hooks/use-theme";
import i18n from "@mobile/i18n";

const pageSize = 30;

/** Messages are newest first: the latest page replaces its copies by id (sync state may have changed) and keeps the older pages already loaded. */
export function mergeLatest(previous: readonly StoredMessage[], latest: readonly StoredMessage[]): readonly StoredMessage[] {
  const latestIds = new Set(latest.map((message) => message.id));
  return [...latest, ...previous.filter((message) => !latestIds.has(message.id))];
}

const announceNotice = () => AccessibilityInfo.announceForAccessibility(i18n.t("whatsappNoticeAnnouncement"));

export default function ConversationScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const { chatId: rawChatId, noticeMessageId: rawNoticeMessageId } = useLocalSearchParams<{ chatId: string; noticeMessageId?: string }>();
  const noticeMessageId = typeof rawNoticeMessageId === "string" && rawNoticeMessageId !== "" ? rawNoticeMessageId : null;
  const { state } = useAccess();
  const { runtime, messagesVersion } = useWhatsApp();
  const companyId = state.status === "ready" ? state.company.id : null;
  const chat = parseChatId(String(rawChatId ?? ""));
  const [messages, setMessages] = useState<readonly StoredMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState<"loading" | "searching" | "ready" | "error" | "notice_error" | "chat_missing">(noticeMessageId === null ? "loading" : "searching");
  const [noticeGone, setNoticeGone] = useState(false);
  // Messages carrying the «Aviso» label; they keep it until the seller leaves the chat.
  const [marked, setMarked] = useState<ReadonlySet<string>>(new Set());
  const list = useRef<FlatList<StoredMessage>>(null);
  // The message to bring into view once, right after the notice's range is first laid out.
  const scrollTarget = useRef<string | null>(null);

  const chatId = chat.success ? chat.data : null;
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    if (!runtime || !companyId || chatId === null) return;
    let cancelled = false;
    const loadLatest = async (onFailure: "error" | "notice_error") => {
      const result = await runtime.store.listMessages(companyId as CompanyId, chatId, { beforeArrivalSeq: null, limit: pageSize });
      if (cancelled) return null;
      if (!result.success) { setStatus(onFailure); return null; }
      setMessages(result.data);
      setHasMore(result.data.length === pageSize);
      return result.data;
    };
    const openNotice = async (coreMessageId: string) => {
      setStatus("searching");
      setNoticeGone(false);
      const parsed = parseCoreMessageId(coreMessageId);
      const located = parsed.success ? await locateNoticeMessage(runtime.store, companyId as CompanyId, chatId, parsed.data) : null;
      if (cancelled) return;
      if (located?.success) {
        setMessages(located.data.messages);
        setHasMore(true);
        setMarked((previous) => new Set(previous).add(located.data.target.id));
        scrollTarget.current = located.data.target.id;
        setStatus("ready");
        announceNotice();
        return;
      }
      if (located !== null && located.error.code !== "MESSAGE_NOT_FOUND") { setStatus("notice_error"); return; }
      // The message is gone: show the chat as it is, or say the chat is gone when nothing is left of it.
      const latest = await loadLatest("notice_error");
      if (latest === null) return;
      if (latest.length === 0) { setStatus("chat_missing"); return; }
      setNoticeGone(true);
      setStatus("ready");
    };
    if (noticeMessageId !== null) void openNotice(noticeMessageId);
    else void loadLatest("error").then((latest) => { if (latest !== null) setStatus("ready"); });
    return () => { cancelled = true; };
  }, [runtime, companyId, chatId, reloads, noticeMessageId]);

  // A notice for this chat marks its message in place: the list is neither reloaded nor scrolled.
  useNoticeArrivals(useCallback((destination) => {
    if (destination.target !== "message" || !runtime || !companyId || chatId === null) return;
    const parsed = parseCoreMessageId(destination.messageId);
    if (!parsed.success) return;
    void runtime.store.findByCoreMessageId(companyId as CompanyId, parsed.data).then((found) => {
      if (!found.success || found.data === null || found.data.chatId !== chatId) return;
      const id = found.data.id;
      setMarked((previous) => (previous.has(id) ? previous : new Set(previous).add(id)));
      announceNotice();
    });
  }, [runtime, companyId, chatId]));

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
  if (status === "searching") return <ScreenState status="loading" title={t("whatsappNoticeSearching")} />;
  if (status === "chat_missing") return <ScreenState status="empty" title={t("whatsappNoticeChatGone")} />;
  if (status === "notice_error") return <ScreenState status="error" title={t("whatsappNoticeLoadError")} onRetry={() => { setStatus("searching"); setReloads((value) => value + 1); }} />;
  if (status === "error") return <ScreenState status="error" title={t("whatsappLoadError")} onRetry={() => { setStatus("loading"); setReloads((value) => value + 1); }} />;

  const when = (date: Date | null) => date === null ? t("whatsappUnknownDate")
    : new Intl.DateTimeFormat(i18n.language, { dateStyle: "short", timeStyle: "short" }).format(date);
  const oldest = messages[messages.length - 1]?.arrivalSeq ?? null;

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.root}>
        <FlatList
          ref={list}
          data={messages}
          extraData={marked}
          keyExtractor={(item) => item.id}
          // The notice's message can be far from the newest: render down to it so it can be scrolled to.
          initialNumToRender={Math.max(10, scrollTarget.current === null ? 0 : Math.min(messages.findIndex((message) => message.id === scrollTarget.current) + 3, 100))}
          onContentSizeChange={() => {
            const target = scrollTarget.current;
            const index = target === null ? -1 : messages.findIndex((message) => message.id === target);
            if (index < 0) return;
            scrollTarget.current = null;
            list.current?.scrollToIndex({ index, animated: false, viewPosition: 0.3 });
          }}
          onScrollToIndexFailed={(info) => {
            list.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
            setTimeout(() => list.current?.scrollToIndex({ index: info.index, animated: false, viewPosition: 0.3 }), 100);
          }}
          ListHeaderComponent={<>
            <ThemedText type="title" accessibilityRole="header" style={styles.title}>{abbreviateLid(chat.data)}</ThemedText>
            {noticeGone ? <ThemedText themeColor="textSecondary" accessibilityRole="alert" style={styles.gone}>{t("whatsappNoticeMessageGone")}</ThemedText> : null}
          </>}
          ListEmptyComponent={<ScreenState status="empty" title={t("whatsappChatNotFound")} />}
          ListFooterComponent={hasMore ? <Button variant="ghost" onPress={() => void loadOlder(oldest)}>{t("whatsappLoadMore")}</Button> : null}
          renderItem={({ item }) => (
            <View style={[styles.bubble, { backgroundColor: item.direction === "incoming" ? theme.backgroundElement : theme.backgroundSelected },
              marked.has(item.id) && { borderWidth: 2, borderColor: theme.primary }]}>
              {marked.has(item.id) ? <ThemedText type="small" style={{ color: theme.primary }}>{t("whatsappNoticeLabel")}</ThemedText> : null}
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
  gone: { paddingHorizontal: 16, paddingBottom: 8 },
  bubble: { marginHorizontal: 16, marginVertical: 4, padding: 12, borderRadius: 12, gap: 6 },
});
