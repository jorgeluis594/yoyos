import { useState } from "react";
import type { FetcherWithComponents } from "react-router";
import { useTranslation } from "react-i18next";
import { offersPartialStockDeduction } from "@shared/orders-payment";
import type { OrderAggregateResponse } from "@shared/contracts/orders";
import { Button } from "@core/app/components/ui/button";
import { Field, FieldLabel } from "@core/app/components/ui/field";
import { Input } from "@core/app/components/ui/input";
import { formatCurrency } from "@core/app/format-currency";
import { isValidPaymentAmount, PaymentFields, type PaymentDraft } from "@core/src/features/orders/presentation/payment-fields";
import { offeredPayment, type OfferedChoice, type PaymentOptions } from "@core/src/features/orders/presentation/payment-options";

/** What the route action answers to a payment decision. A recorded payment carries the order it left, which chooses the success text. */
export type PaymentDecisionResult = Readonly<{ success: boolean; error: string | false; recorded?: boolean; order?: Pick<OrderAggregateResponse, "stockDue"> }>;

export type DecisionKind = "approve" | "register" | "reject";

/** Text key of a failed payment decision. A conflicting decision means somebody reviewed that payment first. */
export function paymentErrorKey(error: string) {
  if (error === "ALREADY_REVIEWED") return "orders.paymentAlreadyReviewed" as const;
  if (error === "NO_RESPONSE" || error === "INTERNAL_ERROR" || error === "PERSISTENCE_UNAVAILABLE") return "orders.paymentUncertain" as const;
  return "orders.paymentSaveError" as const;
}

/** The fetcher belongs to the dialog: the form unmounts as soon as the reload shows the payment decided, before it could report the answer. */
type FormProps = Readonly<{ kind: DecisionKind; paymentId: string; order: Pick<OrderAggregateResponse, "stockDeducted" | "balanceDue" | "total">;
  heading: boolean; fetcher: FetcherWithComponents<unknown>; onSubmit: () => void; onCancel: () => void; options: PaymentOptions;
  /** The method the form opens with; the first offered choice when absent. */
  initialChoice?: OfferedChoice }>;

export function PaymentDecisionForm({ kind, paymentId, order, heading, fetcher, onSubmit, onCancel, options, initialChoice }: FormProps) {
  const { t, i18n } = useTranslation();
  const [draft, setDraft] = useState<PaymentDraft>({ amount: order.balanceDue.amount > 0 ? order.balanceDue.amount.toFixed(2) : "", ...offeredPayment(initialChoice ?? options.choices[0]), deductStockIfPartial: false });
  const [reason, setReason] = useState("");
  const pending = fetcher.state !== "idle";

  const validAmount = isValidPaymentAmount(draft.amount);
  const typed = validAmount ? { amount: Number(draft.amount), currency: order.total.currency } : null;
  const stockBox = kind !== "reject" && offersPartialStockDeduction(order, typed);
  const submitLabel = kind === "reject" ? t("orders.rejectConfirm") : kind === "register" ? t("orders.confirmPayment")
    : typed ? t("orders.approvePaymentAmount", { amount: formatCurrency(typed.amount, typed.currency, i18n.language) }) : t("orders.approvePayment");

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || (kind !== "reject" && !validAmount)) return;
    onSubmit();
    const body = new FormData();
    body.set("paymentId", paymentId);
    if (kind === "reject") { body.set("operation", "reject"); body.set("reason", reason); }
    else {
      body.set("operation", "confirm"); body.set("source", kind === "register" ? "manual" : "buyer_report");
      body.set("currency", order.total.currency); body.set("amount", draft.amount); body.set("method", draft.method);
      if (draft.walletProvider) body.set("walletProvider", draft.walletProvider);
      if (stockBox && draft.deductStockIfPartial) body.set("deductStockIfPartial", "on");
    }
    fetcher.submit(body, { method: "post" });
  }

  return <form onSubmit={submit} noValidate className="grid gap-3 sm:grid-cols-2 sm:items-start">
    {kind === "reject" ? <>
      {heading && <div className="col-span-full flex flex-col gap-1"><h3 className="font-semibold">{t("orders.rejectTitle")}</h3><p className="text-muted-foreground">{t("orders.rejectBody")}</p></div>}
      <Field className="col-span-full min-w-0"><FieldLabel htmlFor={`reject-reason-${paymentId}`}>{t("orders.rejectReasonLabel")}</FieldLabel>
        <Input id={`reject-reason-${paymentId}`} className="h-control" maxLength={200} value={reason} onChange={event => setReason(event.target.value)} autoFocus /></Field>
    </> : <PaymentFields value={draft} onChange={setDraft} options={options} showStockBox={stockBox} autoFocusAmount />}
    <div className="col-span-full flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <Button type="button" variant="outline" className="min-h-touch md:min-h-control" onClick={onCancel}>{t(kind === "reject" ? "orders.backDecision" : "orders.cancelDecision")}</Button>
      <Button type="submit" variant={kind === "reject" ? "destructive" : "default"} className="min-h-touch md:min-h-control" disabled={pending || (kind !== "reject" && !validAmount)}>{submitLabel}</Button>
    </div>
  </form>;
}
