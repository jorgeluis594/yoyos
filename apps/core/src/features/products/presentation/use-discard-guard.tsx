import { useEffect, useRef, type ReactNode } from "react";
import { useBlocker } from "react-router";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@core/src/features/products/presentation/variant-dialogs";

/**
 * Leaving a form with unsaved changes asks first, in the app and, for a closing or reloading tab, with the browser's own notice.
 * `allowLeaving` lets a save navigate away; `holdLeaving` takes it back when the save is rejected.
 */
export function useDiscardGuard(dirty: boolean) {
  const { t } = useTranslation();
  const leaving = useRef(false);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !leaving.current && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { if (!leaving.current) event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const dialog: ReactNode = blocker.state === "blocked"
    ? <ConfirmDialog title={t("productEditor.discardTitle")} description={t("productEditor.discardDescription")} confirm={t("productEditor.discard")} cancel={t("productEditor.keepEditing")}
        onConfirm={() => blocker.proceed()} onCancel={() => blocker.reset()} />
    : null;
  return { dialog, allowLeaving: () => { leaving.current = true; }, holdLeaving: () => { leaving.current = false; } };
}
