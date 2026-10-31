import { useCallback, useEffect } from "react";
import { useBlocker } from "react-router";

export type LeaveGuardMode = "changes" | "doubt";
export type LeaveGuard = Readonly<{
  /** A navigation is waiting for the seller's answer. */
  blocked: boolean;
  /** «changes»: unsaved edits would be lost. «doubt»: a save may or may not have gone through. */
  mode: LeaveGuardMode;
  /** **Seguir editando** / **Quedarme**: the navigation is cancelled. */
  stay: () => void;
  /** **Descartar cambios** / **Salir**: the waiting navigation goes ahead. */
  leave: () => void;
}>;

/**
 * Leaving the order view with unsaved edits, or while a save is in doubt, asks first. In-app navigation is held by the router;
 * a closing or reloading tab gets the browser's own notice. Moving within the same path (search params) never asks, and neither
 * does the navigation to `allowedPath`, the order a save has just created: the guard stays active while the save is in flight.
 */
export function useUnsavedChangesGuard({ dirty, inDoubt = false, allowedPath }: Readonly<{ dirty: boolean; inDoubt?: boolean; allowedPath?: string }>): LeaveGuard {
  const active = dirty || inDoubt;
  const blocker = useBlocker(({ currentLocation, nextLocation }) => active && nextLocation.pathname !== allowedPath && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (!active) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [active]);
  const stay = useCallback(() => { if (blocker.state === "blocked") blocker.reset(); }, [blocker]);
  const leave = useCallback(() => { if (blocker.state === "blocked") blocker.proceed(); }, [blocker]);
  return { blocked: blocker.state === "blocked", mode: inDoubt ? "doubt" : "changes", stay, leave };
}
