import { useCallback, useEffect, useRef } from "react";
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
  /** Lets the save's own navigation through. `holdLeaving` takes it back when the save is rejected. */
  allowLeaving: () => void;
  holdLeaving: () => void;
}>;

/**
 * Leaving the order view with unsaved edits, or while a save is in doubt, asks first. In-app navigation is held by the router;
 * a closing or reloading tab gets the browser's own notice. Moving within the same path (search params) never asks.
 */
export function useUnsavedChangesGuard({ dirty, inDoubt = false }: Readonly<{ dirty: boolean; inDoubt?: boolean }>): LeaveGuard {
  const active = dirty || inDoubt;
  const leaving = useRef(false);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => active && !leaving.current && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (!active) return;
    const warn = (event: BeforeUnloadEvent) => { if (!leaving.current) event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [active]);
  const stay = useCallback(() => { if (blocker.state === "blocked") blocker.reset(); }, [blocker]);
  const leave = useCallback(() => { if (blocker.state === "blocked") blocker.proceed(); }, [blocker]);
  const allowLeaving = useCallback(() => { leaving.current = true; }, []);
  const holdLeaving = useCallback(() => { leaving.current = false; }, []);
  return { blocked: blocker.state === "blocked", mode: inDoubt ? "doubt" : "changes", stay, leave, allowLeaving, holdLeaving };
}
