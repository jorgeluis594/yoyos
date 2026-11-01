import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type { OrderReviewResponse } from "@shared/contracts/order-review";
import { Button } from "@core/app/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@core/app/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@core/app/components/ui/dialog";
import { messageSummary, undoStep, type ReviewChange } from "@core/src/features/orders/presentation/order-review-texts";

export type MessageRow = OrderReviewResponse["messageRows"][number];

/** Why a row cannot be undone, in the seller's words. */
export function refusalText(row: Extract<MessageRow["undo"], { kind: "refused" }>, t: TFunction): string {
  return t(`orderReview.changes.refused.${row.reason}`);
}

type BlockProps = Readonly<{
  rows: readonly MessageRow[]; moreRows: number; moreLoading: boolean; moreFailed: boolean;
  /** Unsaved edits of the order: undo would change the saved order they were made against. */
  blocked: boolean; time: (at: string) => string;
  onUndo: (row: MessageRow) => void; onMore: () => void;
}>;

/** «Cambios por mensajes»: one row per message that changed the order, newest first, with Deshacer or the reason it cannot be undone. */
export function MessageChangesBlock({ rows, moreRows, moreLoading, moreFailed, blocked, time, onUndo, onMore }: BlockProps) {
  const { t } = useTranslation();
  if (rows.length === 0) return null;
  return <Card aria-labelledby="message-changes-title">
    <CardHeader><CardTitle id="message-changes-title">{t("orderReview.changes.title")}</CardTitle></CardHeader>
    <CardContent className="grid gap-3">
      <ul className="divide-y">{rows.map((row) => {
        const summary = messageSummary(row.changes, t);
        const label = `${time(row.at)} · ${summary}`;
        return <li key={row.messageId} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
          <p className="min-w-0 flex-1 text-sm">{label}</p>
          {row.undo.kind === "available" && <>
            <Button type="button" variant="outline" size="sm" className="min-h-control max-md:min-h-touch aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
              aria-label={t("orderReview.changes.undoRow", { time: time(row.at), summary })} aria-disabled={blocked || undefined} aria-describedby={blocked ? "message-changes-blocked" : undefined}
              onClick={() => { if (!blocked) onUndo(row); }}>{t("orderReview.changes.undo")}</Button>
          </>}
          {row.undo.kind === "refused" && <p className="text-sm text-muted-foreground">{refusalText(row.undo, t)}</p>}
          {row.undo.kind === "undone" && <p className="text-sm font-medium text-muted-foreground">{t("orderReview.changes.undone")}</p>}
        </li>;
      })}</ul>
      <span id="message-changes-blocked" className="sr-only">{blocked ? t("orderReview.changes.blocked") : ""}</span>
      {moreRows > 0 && <Button type="button" variant="outline" className="w-fit" disabled={moreLoading} aria-busy={moreLoading || undefined} onClick={onMore}>{t(moreLoading ? "orderReview.changes.loadingMore" : "orderReview.changes.more")}</Button>}
      {moreFailed && <p role="alert" className="text-sm text-destructive">{t("orderReview.changes.moreFailed")}</p>}
    </CardContent>
  </Card>;
}

export type UndoProgress = "idle" | "working" | "in_doubt" | "failed";

/** «¿Deshacer lo que hizo este mensaje?» with the changes it will revert; nothing happens until **Deshacer cambios**. */
export function UndoConfirmDialog({ changes, progress, onApply, onKeep }: Readonly<{ changes: readonly ReviewChange[]; progress: UndoProgress; onApply: () => void; onKeep: () => void }>) {
  const { t } = useTranslation();
  const busy = progress === "working" || progress === "in_doubt";
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onKeep(); }}>
    <DialogContent aria-describedby={undefined}>
      <DialogHeader><DialogTitle>{t("orderReview.changes.confirmTitle")}</DialogTitle><DialogDescription className="sr-only">{messageSummary(changes, t)}</DialogDescription></DialogHeader>
      <ul className="grid list-disc gap-1 pl-5 text-sm">{changes.map((change) => <li key={change.id}>{undoStep(change, t)}</li>)}</ul>
      {progress === "in_doubt" && <p role="status" className="text-sm">{t("orderReview.changes.inDoubt")}</p>}
      {progress === "working" && <p role="status" className="text-sm">{t("orderReview.changes.working")}</p>}
      {progress === "failed" && <p role="alert" className="text-sm text-destructive">{t("orderReview.changes.failed")}</p>}
      <DialogFooter>
        <Button type="button" variant="outline" disabled={busy} onClick={onKeep}>{t("orderReview.changes.confirmKeep")}</Button>
        <Button type="button" disabled={busy} onClick={onApply}>{t("orderReview.changes.confirmApply")}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
