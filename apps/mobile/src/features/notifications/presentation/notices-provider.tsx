import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import type { Result } from "@shared/result";
import type { TransportError } from "@mobile/shared/application/transport-error";
import type { CatalogSearchReadinessState } from "@shared/contracts/catalog-search-readiness";
import type { NoticeDestination } from "../domain/notice-destination";
import type { NoticesController } from "../application/notices-controller";
import type { NoticePermission } from "../application/ports";

export type CatalogReadinessLoader = () => Promise<Result<CatalogSearchReadinessState, TransportError>>;

type NoticesContextValue = Readonly<{
  /** `null` until the first read. */
  permission: NoticePermission | null;
  enable: () => Promise<void>;
  promptOnConnected: () => Promise<void>;
  loadCatalogReadiness: CatalogReadinessLoader;
  /** Calls back with each notice of this company that reaches the running app; returns the unsubscribe. */
  watchArrivals: (listener: (destination: NoticeDestination) => void) => () => void;
}>;

const NoticesContext = createContext<NoticesContextValue | null>(null);

type Props = Readonly<{ controller: NoticesController; companyId: string; loadCatalogReadiness: CatalogReadinessLoader; children?: ReactNode }>;

/**
 * Binds notices to the signed-in company: it feeds the foreground filter, registers the phone on
 * sign-in, foreground and token change, and tracks the permission the link screen shows.
 */
export function NoticesProvider({ controller, companyId, loadCatalogReadiness, children }: Props) {
  const [permission, setPermission] = useState<NoticePermission | null>(null);
  const refreshPermission = useCallback(async () => setPermission(await controller.permission()), [controller]);

  useEffect(() => {
    controller.setSession({ companyId });
    return () => controller.setSession(null);
  }, [controller, companyId]);

  useEffect(() => {
    const check = () => { void controller.sync().then(refreshPermission).catch(() => undefined); };
    check();
    const appState = AppState.addEventListener("change", (next) => { if (next === "active") check(); });
    const unsubscribe = controller.onTokenChange(check);
    return () => { appState.remove(); unsubscribe(); };
  }, [controller, refreshPermission]);

  // Stable identities: the link screen prompts from an effect that must not re-run when the permission changes.
  const enable = useCallback(async () => {
    setPermission(await controller.enable());
    await controller.sync();
  }, [controller]);
  const promptOnConnected = useCallback(async () => {
    setPermission(await controller.promptOnConnected());
    await controller.sync();
  }, [controller]);
  const watchArrivals = useCallback<NoticesContextValue["watchArrivals"]>((listener) => controller.watchArrivals(listener), [controller]);
  const value = useMemo<NoticesContextValue>(
    () => ({ permission, enable, promptOnConnected, loadCatalogReadiness, watchArrivals }),
    [permission, enable, promptOnConnected, loadCatalogReadiness, watchArrivals],
  );
  return <NoticesContext.Provider value={value}>{children}</NoticesContext.Provider>;
}

/** `null` outside the provider (web, tests), where the link screen shows no notices UI. */
export function useNotices(): NoticesContextValue | null {
  return useContext(NoticesContext);
}

/**
 * Runs `listener` for each notice of the signed-in company that reaches the running app while
 * `active`. Outside the provider (web, tests) nothing arrives.
 */
export function useNoticeArrivals(listener: (destination: NoticeDestination) => void, active = true): void {
  const watchArrivals = useNotices()?.watchArrivals;
  const latest = useRef(listener);
  useEffect(() => { latest.current = listener; });
  useEffect(() => {
    if (!watchArrivals || !active) return;
    return watchArrivals((destination) => latest.current(destination));
  }, [watchArrivals, active]);
}
