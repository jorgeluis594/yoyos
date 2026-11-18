import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Checkbox } from "@core/app/components/ui/checkbox";
import { Field, FieldLabel } from "@core/app/components/ui/field";
import { Input } from "@core/app/components/ui/input";
import type { WalletProvider } from "@shared/wallet-providers";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@core/app/components/ui/select";
import { offeredChoiceName, offeredChoiceOf, offeredPayment, type OfferedChoice, type PaymentOptions } from "@core/src/features/orders/presentation/payment-options";

export type PaymentDraft = { amount: string; method: "digital_wallet" | "bank_transfer"; walletProvider?: WalletProvider; deductStockIfPartial: boolean };

type PaymentFieldsProps = { value: PaymentDraft; onChange: (value: PaymentDraft) => void; options: PaymentOptions; showStockBox?: boolean; autoFocusAmount?: boolean;
  /** A save attempt marked the amount from outside, as the view's invalid fields do. */
  invalid?: boolean;
  /** Why the typed amount cannot be sent, already worded: shown under the field. */
  error?: string | null };

export function PaymentFields({ value, onChange, options, showStockBox = true, autoFocusAmount = false, invalid = false, error = null }: PaymentFieldsProps) {
  const { t } = useTranslation();
  const id = useId();
  const methods = options.choices.map(item => ({ value: item, label: offeredChoiceName(item, options, { wallet: t("orders.wallet"), bankTransfer: t("orders.bankTransfer") }) }));
  return <>
    <Field className="min-w-0"><FieldLabel htmlFor={`${id}-amount`}>{t("orders.paymentAmount")}</FieldLabel><Input id={`${id}-amount`} name="amount" className="h-control" type="text" inputMode="decimal" autoComplete="off" value={value.amount} onChange={event => onChange({ ...value, amount: event.target.value.replace(/,/g, ".") })} autoFocus={autoFocusAmount}
      aria-invalid={error !== null || invalid} aria-describedby={error ? `${id}-amount-error` : undefined} required />
      {error && <p id={`${id}-amount-error`} role="alert" className="text-sm text-destructive">{error}</p>}</Field>
    <Field className="min-w-0"><FieldLabel htmlFor={`${id}-method`}>{t("orders.paymentMethod")}</FieldLabel>
      <Select items={methods} value={offeredChoiceOf(value)} onValueChange={picked => onChange({ amount: value.amount, deductStockIfPartial: value.deductStockIfPartial, ...offeredPayment(picked as OfferedChoice) })}>
        <SelectTrigger id={`${id}-method`} className="h-control"><SelectValue /></SelectTrigger>
        <SelectContent>{methods.map(method => <SelectItem key={method.value} value={method.value}>{method.label}</SelectItem>)}</SelectContent>
      </Select>
    </Field>
    {showStockBox && <Field orientation="horizontal" className="col-span-full min-h-touch items-center"><Checkbox id={`${id}-deduct`} name="deductStockIfPartial" checked={value.deductStockIfPartial} onCheckedChange={checked => onChange({ ...value, deductStockIfPartial: checked === true })} /><FieldLabel htmlFor={`${id}-deduct`}>{t("orders.deductStockIfPartial")}</FieldLabel></Field>}
  </>;
}
