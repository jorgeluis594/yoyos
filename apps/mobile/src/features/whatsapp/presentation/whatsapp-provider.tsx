import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState, Platform } from "react-native";
import type { WhatsAppRuntime } from "@mobile/features/whatsapp/composition";
import { useAccess } from "@mobile/features/users/presentation/access-provider";
import { initialWhatsAppStatus, toWhatsAppStatus, type WhatsAppStatus } from "@mobile/features/whatsapp/presentation/whatsapp-status";

type WhatsAppContextValue = Readonly<{
  runtime: WhatsAppRuntime | null;
  status: WhatsAppStatus;
  /** Re-reads the link and the unsynced counter after an operation changed them. */
  refresh: () => Promise<void>;
}>;

const WhatsAppContext = createContext<WhatsAppContextValue | null>(null);

type Props = Readonly<{ getRuntime: () => Promise<WhatsAppRuntime>; children?: ReactNode }>;

/**
 * Binds message reception to the Yoyos session: it starts when a user with a company is signed in
 * and stops, without logging out of WhatsApp, when the session ends (UC-07).
 */
export function WhatsAppProvider({ getRuntime, children }: Props) {
  const { state } = useAccess();
  const companyId = state.status === "ready" ? state.company.id : null;
  const userId = state.status === "ready" ? state.user.id : null;
  const [runtime, setRuntime] = useState<WhatsAppRuntime | null>(null);
  const [status, setStatus] = useState<WhatsAppStatus>(initialWhatsAppStatus);
  const current = useRef<{ runtime: WhatsAppRuntime; companyId: string } | null>(null);

  const refresh = useCallback(async () => {
    const active = current.current;
    if (!active) return;
    const [link, conversations] = await Promise.all([active.runtime.links.active(), active.runtime.store.listConversations(active.companyId as never)]);
    if (current.current !== active || !link.success) return;
    const unsynced = conversations.success ? conversations.data.reduce((sum, item) => sum + item.unsynced, 0) : 0;
    setStatus(toWhatsAppStatus({ activeLink: link.data, companyId: active.companyId, reception: active.runtime.reception.status(), unsynced }));
  }, []);

  useEffect(() => {
    if (Platform.OS === "web" || companyId === null || userId === null) return;
    let cancelled = false;
    let unsubscribe = () => undefined as void;
    let appStateSubscription: { remove(): void } | null = null;
    void getRuntime().then(async (created) => {
      if (cancelled) return;
      created.setIdentity({ companyId, userId });
      current.current = { runtime: created, companyId };
      setRuntime(created);
      unsubscribe = created.reception.subscribe(() => { void refresh(); });
      appStateSubscription = AppState.addEventListener("change", (next) => {
        if (next !== "active") return;
        void created.reception.signedIn().then(() => refresh());
      });
      await created.reception.signedIn();
      await refresh();
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      unsubscribe();
      appStateSubscription?.remove();
      const active = current.current;
      current.current = null;
      setRuntime(null);
      setStatus(initialWhatsAppStatus);
      if (active) {
        // signedOut stops sync and reception synchronously; the identity is cleared right after so a later sign-in is not affected.
        void active.runtime.reception.signedOut();
        active.runtime.setIdentity(null);
      }
    };
  }, [companyId, userId, getRuntime, refresh]);

  const value = useMemo(() => ({ runtime, status, refresh }), [runtime, status, refresh]);
  return <WhatsAppContext.Provider value={value}>{children}</WhatsAppContext.Provider>;
}

export function useWhatsApp(): WhatsAppContextValue {
  const value = useContext(WhatsAppContext);
  if (!value) throw new Error("useWhatsApp must be used inside WhatsAppProvider");
  return value;
}
