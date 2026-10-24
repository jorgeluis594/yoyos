import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import type { OrderAggregateResponse } from "@shared/contracts/orders";
import { Alert, AlertDescription } from "@core/app/components/ui/alert";
import { Button } from "@core/app/components/ui/button";
import { SelectPortalContainer } from "@core/app/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@core/app/components/ui/dialog";
import { paymentErrorKey, PaymentDecisionForm, type DecisionKind, type PaymentDecisionResult } from "@core/src/features/orders/presentation/payment-decision-form";
import { paymentDate, reportedAt, type PaymentFormat } from "@core/src/features/orders/presentation/payment-row";

type Order = OrderAggregateResponse;
export type PaymentDialogKind = "receipt" | DecisionKind;
type Step = "choose" | "approve" | "reject";

type Props = Readonly<{ kind: PaymentDialogKind; paymentId: string; payment: Order["payments"][number] | null; order: Order; receiptUrl: string | null;
  format: PaymentFormat; onClose: () => void; onDone: (paymentId: string) => void; onUncertain: (paymentId: string) => void; onCloseAutoFocus: (event: Event) => void }>;

function ReceiptImage({ url, className }: { url: string; className: string }) {
  const { t } = useTranslation();
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  if (failed) return <div role="alert" className="flex flex-col items-center gap-2 rounded-lg border p-4 text-sm">{t("orders.receiptLoadFailed")}
    <Button type="button" variant="outline" onClick={() => { setFailed(false); setAttempt(attempt + 1); }}>{t("orders.receiptRetry")}</Button></div>;
  return <img key={attempt} src={url} alt={t("orders.receiptAlt")} loading="eager" onError={() => setFailed(true)} className={`mx-auto w-auto max-w-full rounded-md object-contain ${className}`} />;
}

export function PaymentDialog({ kind, paymentId, payment, order, receiptUrl, format, onClose, onDone, onUncertain, onCloseAutoFocus }: Props) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>(kind === "receipt" ? "choose" : kind === "reject" ? "reject" : "approve");
  // A failure is shown until the seller changes step or submits again; the fetcher keeps the last answer.
  const [dismissed, setDismissed] = useState<unknown>(null);
  // The modal traps outside clicks, so the method select opens inside the dialog itself (as the sheets do).
  const [content, setContent] = useState<HTMLDivElement | null>(null);
  const fetcher = useFetcher<PaymentDecisionResult>();
  const handled = useRef<unknown>(null);
  useEffect(() => {
    const result = fetcher.data;
    if (fetcher.state !== "idle" || !result || handled.current === result) return;
    handled.current = result;
    if ("success" in result && result.success) onDone(paymentId);
    else if ("error" in result && result.error && paymentErrorKey(String(result.error)) === "orders.paymentUncertain") onUncertain(paymentId);
  }, [fetcher.state, fetcher.data, paymentId, onDone, onUncertain]);
  const answer = fetcher.state === "idle" && fetcher.data !== dismissed ? fetcher.data : undefined;
  const failure = answer && "error" in answer && answer.error ? String(answer.error) : "";
  const clearFailure = () => setDismissed(fetcher.data);
  const withReceipt = kind === "receipt" && receiptUrl !== null;
  const reviewable = kind === "register" || (payment?.status === "reported" && !order.cancelled);
  const back = () => kind === "receipt" ? (clearFailure(), setStep("choose")) : onClose();
  const title = kind === "receipt" ? t("orders.receiptTitle") : kind === "register" ? t("orders.registerPaymentTitle")
    : kind === "approve" ? t("orders.approvePaymentTitle") : t("orders.rejectTitle");
  const description = kind === "receipt" && payment ? t("orders.receiptSubtitle", { number: order.number, date: format.date(reportedAt(payment) ?? paymentDate(payment)) })
    : kind === "reject" ? t("orders.rejectBody") : kind === "register" ? t("orders.registerPaymentHint") : t("orders.orderPendingBalance", { amount: format.amount(order.balanceDue) });
  const state = payment?.status === "confirmed" ? "paymentStateConfirmed" : payment?.status === "rejected" ? "paymentStateRejected"
    : payment?.status === "voided" ? "paymentStateVoided" : "paymentStateCancelled";
  const deciding = step !== "choose" && reviewable;
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent ref={setContent} closeLabel={t("orders.receiptClose")} onCloseAutoFocus={onCloseAutoFocus} className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
      <SelectPortalContainer.Provider value={content}>
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
      <div className={withReceipt && deciding ? "grid gap-4 sm:grid-cols-2" : "grid gap-4"}>
        {withReceipt && <div className={deciding ? "sticky top-0 z-10 bg-popover pb-2 sm:static" : ""}>
          <ReceiptImage url={receiptUrl} className={deciding ? "max-h-32 sm:max-h-[50dvh]" : "max-h-[60dvh]"} /></div>}
        <div className="flex flex-col gap-3">
          {deciding ? <PaymentDecisionForm kind={kind === "receipt" ? step as DecisionKind : kind} paymentId={paymentId} order={order}
              heading={kind === "receipt"} fetcher={fetcher} onSubmit={clearFailure} onCancel={back} />
            : reviewable ? <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-medium tabular-nums">{t("orders.orderPendingBalance", { amount: format.amount(order.balanceDue) })}</p>
              <div className="flex gap-2">
                <Button type="button" variant="outline" className="min-h-touch text-destructive md:min-h-control" onClick={() => { clearFailure(); setStep("reject"); }}>{t("orders.reject")}</Button>
                <Button type="button" className="min-h-touch md:min-h-control" onClick={() => { clearFailure(); setStep("approve"); }}>{t("orders.approve")}</Button></div></div>
            : <p className="text-sm font-medium">{t(`orders.${state}`)}</p>}
          {failure && <Alert variant="destructive"><AlertDescription role="alert">{t(paymentErrorKey(failure))}</AlertDescription></Alert>}
        </div>
      </div>
      </SelectPortalContainer.Provider>
    </DialogContent>
  </Dialog>;
}
