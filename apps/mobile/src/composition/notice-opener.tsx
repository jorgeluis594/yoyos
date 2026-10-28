import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { Alert } from "react-native";
import { useRootNavigationState, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { err, ok } from "@shared/functional";
import { showConfirmation } from "@mobile/components/ui/show-confirmation";
import { useOrderDraft } from "@mobile/features/orders/presentation/order-draft-guard";
import { useProductDraft } from "@mobile/features/products/presentation/draft-guard";
import { useAccess } from "@mobile/features/users/presentation/access-provider";
import { parseCompanyId, parseCoreMessageId } from "@mobile/features/whatsapp/domain/ids";
import { useWhatsApp } from "@mobile/features/whatsapp/presentation/whatsapp-provider";
import { openNotice, type NoticeInbox, type OpenNoticePorts } from "@mobile/features/notifications/application/open-notice";

type OpenerProps = Readonly<{ inbox: NoticeInbox; resolveOrder: OpenNoticePorts["resolveOrder"] }>;

/**
 * Opens the held destination once the company is known, the local message store and the navigator
 * are ready: the notice's chat or order for its own company, Home for another one.
 */
export function NoticeOpener({ inbox, resolveOrder }: OpenerProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const navigatorReady = useRootNavigationState()?.key !== undefined;
  const { state } = useAccess();
  const { runtime } = useWhatsApp();
  const productDraft = useProductDraft();
  const orderDraft = useOrderDraft();
  const companyId = state.status === "ready" ? state.company.id : null;

  const latest = useRef({ companyId, runtime, navigatorReady, router, t, productDraft, orderDraft });
  useLayoutEffect(() => { latest.current = { companyId, runtime, navigatorReady, router, t, productDraft, orderDraft }; });
  const opening = useRef(false);
  // `settle` runs again when an opening ends, in case another notice was tapped meanwhile.
  const settleAgain = useRef<() => void>(() => undefined);

  const settle = useCallback(() => {
    const current = latest.current;
    if (opening.current || current.companyId === null || !current.navigatorReady) return;
    // Only a message destination needs the local message store; order and Home notices open without it.
    const pending = inbox.settle({ companyId: current.companyId }, (destination) => destination.target !== "message" || current.runtime !== null);
    if (pending === null) return;
    if (pending.kind === "home") { current.router.navigate("/"); return; }
    const sessionCompanyId = current.companyId;
    const ports: OpenNoticePorts = {
      findChatOfMessage: async (messageId) => {
        const store = latest.current.runtime?.store;
        const scope = parseCompanyId(sessionCompanyId);
        const coreMessageId = parseCoreMessageId(messageId);
        if (!store) return err({ message: "The local message store is not available" });
        if (!scope.success) return scope;
        if (!coreMessageId.success) return coreMessageId;
        const found = await store.findByCoreMessageId(scope.data, coreMessageId.data);
        return found.success ? ok(found.data?.chatId ?? null) : found;
      },
      resolveOrder,
      confirmDiscard: () => new Promise<boolean>((resolve) => {
        const { productDraft: product, orderDraft: order, t: translate } = latest.current;
        if (!product.dirty && !order.dirty) { resolve(true); return; }
        showConfirmation({
          title: translate("discardChanges"),
          description: translate("discardDescription"),
          confirmLabel: translate("discard"),
          cancelLabel: translate("keepEditing"),
          destructive: true,
          onConfirm: () => { if (product.dirty) product.discard(); if (order.dirty) order.discard(); resolve(true); },
          onCancel: () => resolve(false),
        });
      }),
      go: {
        chat: (chatId, noticeMessageId) => latest.current.router.navigate({ pathname: "/whatsapp/chats/[chatId]", params: { chatId, noticeMessageId } }),
        chatsList: () => latest.current.router.navigate({ pathname: "/whatsapp/chats", params: { noticeChatMissing: "1" } }),
        order: (id) => latest.current.router.navigate({ pathname: "/orders/[id]", params: { id, noticeAt: String(Date.now()) } }),
        home: () => latest.current.router.navigate("/"),
      },
    };
    opening.current = true;
    void openNotice(pending.destination, ports)
      .then((outcome) => { if (outcome === "failed") Alert.alert(latest.current.t("noticeOpenFailed")); })
      .catch(() => Alert.alert(latest.current.t("noticeOpenFailed")))
      .finally(() => { opening.current = false; settleAgain.current(); });
  }, [inbox, resolveOrder]);

  useLayoutEffect(() => { settleAgain.current = settle; });
  useEffect(() => {
    settle();
    return inbox.subscribe(settle);
  }, [inbox, settle, companyId, runtime, navigatorReady]);
  return null;
}
