import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import * as Network from "expo-network";
import type { Result } from "@shared/result";
import { orders } from "@mobile/features/orders/composition";
import { createPendingOrderSync } from "@mobile/features/orders/application/pending-order-sync";
import type { PendingOrderConfirmation, PendingOrderStoreError } from "@mobile/features/orders/application/order-operations";
import { useAccess } from "@mobile/features/users/presentation/access-provider";

type PendingOrders = Result<readonly PendingOrderConfirmation[], PendingOrderStoreError> | null;
const Context = createContext<Readonly<{
  /** The company's queued sales; null while the first read is running. */
  pending: PendingOrders;
  refresh: () => Promise<void>;
  /** Sends queued sales now, e.g. right after one is queued. */
  trigger: () => void;
}> | null>(null);

const timers = { setTimeout: (run: () => void, ms: number) => setTimeout(run, ms),
  clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>), random: Math.random };

/** Keeps sending the signed-in company's queued sales: on sign-in, when the app returns, when back online and with backoff in between. */
export function PendingOrderSyncProvider({ children }: { children: ReactNode }) {
  const { state } = useAccess();
  const companyId = state.status === "ready" ? state.company.id : "";
  // Keyed by company so another company's queue is never shown after switching.
  const [stored, setStored] = useState<Readonly<{ companyId: string; pending: PendingOrders }> | null>(null);
  const pending = stored?.companyId === companyId ? stored.pending : null;
  const sync = useRef<ReturnType<typeof createPendingOrderSync> | null>(null);
  const refresh = useCallback(async () => {
    if (companyId) setStored({ companyId, pending: await orders.listPendingOrders(companyId) });
  }, [companyId]);
  useEffect(() => {
    if (!companyId) return;
    let active = true;
    const load = () => { void orders.listPendingOrders(companyId).then(result => { if (active) setStored({ companyId, pending: result }); }); };
    const created = createPendingOrderSync(orders.syncPendingOrders, timers, load);
    sync.current = created;
    load();
    created.start(companyId);
    const appState = AppState.addEventListener("change", next => { if (next === "active") created.trigger(); });
    const network = Network.addNetworkStateListener(next => { if (next.isConnected && next.isInternetReachable !== false) created.trigger(); });
    return () => { active = false; created.stop(); appState.remove(); network.remove(); sync.current = null; };
  }, [companyId]);
  const value = useMemo(() => ({ pending, refresh, trigger: () => sync.current?.trigger() }), [pending, refresh]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function usePendingOrders() {
  const value = useContext(Context);
  if (!value) throw new Error("PendingOrderSyncProvider is required");
  return value;
}
