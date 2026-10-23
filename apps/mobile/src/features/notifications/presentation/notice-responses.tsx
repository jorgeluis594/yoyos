import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { Alert } from "react-native";
import { useRootNavigationState, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { ok } from "@shared/functional";
import { showConfirmation } from "@mobile/components/ui/show-confirmation";
import { useOrderDraft } from "@mobile/features/orders/presentation/order-draft-guard";
import { useProductDraft } from "@mobile/features/products/presentation/draft-guard";
import { useAccess } from "@mobile/features/users/presentation/access-provider";
import type { CompanyId, CoreMessageId } from "@mobile/features/whatsapp/domain/ids";
import { useWhatsApp } from "@mobile/features/whatsapp/presentation/whatsapp-provider";
import type { NoticesController } from "../application/notices-controller";
import { openNotice, type NoticeInbox, type OpenNoticePorts } from "../application/open-notice";

/**
 * Keeps every notice the seller taps, signed in or not, until a session can open it. It sits above
 * the access state because a tap can arrive while the session is restoring or signed out.
 */
export function NoticeResponseCapture({ controller, inbox }: Readonly<{ controller: NoticesController; inbox: NoticeInbox }>) {
  useEffect(() => controller.watchResponses((destination) => inbox.hold(destination)), [controller, inbox]);
  return null;
}

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
    if (opening.current || current.companyId === null || current.runtime === null || !current.navigatorReady) return;
    const pending = inbox.settle({ companyId: current.companyId });
    if (pending === null) return;
    if (pending.kind === "home") { current.router.navigate("/"); return; }
    const { store } = current.runtime;
    const scope = current.companyId as CompanyId;
    const ports: OpenNoticePorts = {
      findChatOfMessage: async (messageId) => {
        const found = await store.findByCoreMessageId(scope, messageId as CoreMessageId);
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
        order: (id) => latest.current.router.navigate({ pathname: "/orders/[id]", params: { id } }),
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
