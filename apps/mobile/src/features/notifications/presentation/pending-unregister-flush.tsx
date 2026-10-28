import { useEffect } from "react";
import { AppState } from "react-native";
import type { NoticesController } from "../application/notices-controller";

/**
 * Sends the pending unregister at start and on every foreground, signed in or not, so an
 * offline sign-out stops notices as soon as the phone is back online.
 */
export function PendingUnregisterFlush({ controller }: Readonly<{ controller: NoticesController }>) {
  useEffect(() => {
    const flush = () => { void controller.flushPending().catch(() => undefined); };
    flush();
    const appState = AppState.addEventListener("change", (next) => { if (next === "active") flush(); });
    return () => appState.remove();
  }, [controller]);
  return null;
}
