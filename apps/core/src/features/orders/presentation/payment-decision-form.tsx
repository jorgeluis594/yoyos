import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { offersPartialStockDeduction } from "@shared/orders-payment";
import type { OrderAggregateResponse } from "@shared/contracts/orders";
import { Button } from "@core/app/components/ui/button";
import { Field, FieldLabel } from "@core/app/components/ui/field";
import { Input } from "@core/app/components/ui/input";
import { formatCurrency } from "@core/app/format-currency";
import type { action } from "@core/app/routes/order-detail";
import { isValidPaymentAmount, PaymentFields, type PaymentDraft } from "@core/src/features/orders/presentation/payment-fields";

export type DecisionKind = "approve" | "register" | "reject";

/** Text key of a failed payment decision. A conflicting decision means somebody reviewed that payment first. */
export function paymentErrorKey(error: string) {
  if (error === "ALREADY_REVIEWED") return "orders.paymentAlreadyReviewed" as const;
  if (error === "INSUFFICIENT_STOCK") return "orders.paymentStockError" as const;
  if (error === "NO_RESPONSE" || error === "INTERNAL_ERROR" || error === "PERSISTENCE_UNAVAILABLE") return "orders.paymentUncertain" as const;
  return "orders.paymentSaveError" as const;
}

type FormProps = Readonly<{ kind: DecisionKind; paymentId: string; order: Pick<OrderAggregateResponse, "stockDeducted" | "balanceDue" | "total">;
  heading: boolean; onDone: (paymentId: string) => void; onFailure: (error: string) => void; onCancel: () => void }>;

export function PaymentDecisionForm({ kind, paymentId, order, heading, onDone, onFailure, onCancel }: FormProps) {
  const { t, i18n } = useTranslation();
  const fetcher = useFetcher<typeof action>();
  const [draft, setDraft] = useState<PaymentDraft>({ amount: order.balanceDue.amount > 0 ? order.balanceDue.amount.toFixed(2) : "", method: "digital_wallet", deductStockIfPartial: false });
  const [reason, setReason] = useState("");
  const handled = useRef<unknown>(null);
  const pending = fetcher.state !== "idle";
  useEffect(() => {
    const result = fetcher.data;
    if (fetcher.state !== "idle" || !result || handled.current === result) return;
    handled.current = result;
    if ("success" in result && result.success) onDone(paymentId);
    else if ("error" in result && result.error) onFailure(String(result.error));
  }, [fetcher.state, fetcher.data, paymentId, onDone, onFailure]);

  const validAmount = isValidPaymentAmount(draft.amount);
  const typed = validAmount ? { amount: Number(draft.amount), currency: order.total.currency } : null;
  const stockBox = kind !== "reject" && offersPartialStockDeduction(order, typed);
  const submitLabel = kind === "reject" ? t("orders.rejectConfirm") : kind === "register" ? t("orders.confirmPayment")
    : typed ? t("orders.approvePaymentAmount", { amount: formatCurrency(typed.amount, typed.currency, i18n.language) }) : t("orders.approvePayment");

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || (kind !== "reject" && !validAmount)) return;
    onFailure("");
    const body = new FormData();
    body.set("paymentId", paymentId);
    if (kind === "reject") { body.set("operation", "reject"); body.set("reason", reason); }
    else {
      body.set("operation", "confirm"); body.set("source", kind === "register" ? "manual" : "buyer_report");
      body.set("currency", order.total.currency); body.set("amount", draft.amount); body.set("method", draft.method);
      if (stockBox && draft.deductStockIfPartial) body.set("deductStockIfPartial", "on");
    }
    fetcher.submit(body, { method: "post" });
  }

  return <form onSubmit={submit} noValidate className="grid gap-3 sm:grid-cols-2 sm:items-start">
    {kind === "reject" ? <>
      {heading && <div className="col-span-full flex flex-col gap-1"><h3 className="font-semibold">{t("orders.rejectTitle")}</h3><p className="text-muted-foreground">{t("orders.rejectBody")}</p></div>}
      <Field className="col-span-full min-w-0"><FieldLabel htmlFor={`reject-reason-${paymentId}`}>{t("orders.rejectReasonLabel")}</FieldLabel>
        <Input id={`reject-reason-${paymentId}`} className="h-control" maxLength={200} value={reason} onChange={event => setReason(event.target.value)} autoFocus /></Field>
    </> : <PaymentFields value={draft} onChange={setDraft} showStockBox={stockBox} autoFocusAmount />}
    <div className="col-span-full flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <Button type="button" variant="outline" className="min-h-touch md:min-h-control" onClick={onCancel}>{t(kind === "reject" ? "orders.backDecision" : "orders.cancelDecision")}</Button>
      <Button type="submit" variant={kind === "reject" ? "destructive" : "default"} className="min-h-touch md:min-h-control" disabled={pending || (kind !== "reject" && !validAmount)}>{submitLabel}</Button>
    </div>
  </form>;
}
