import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Checkbox } from "@core/app/components/ui/checkbox";
import { Field, FieldLabel } from "@core/app/components/ui/field";
import { Input } from "@core/app/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@core/app/components/ui/select";

export type PaymentDraft = { amount: string; method: "digital_wallet" | "bank_transfer"; deductStockIfPartial: boolean };

/** Whether the typed amount is a positive money value with at most two decimals. */
export function isValidPaymentAmount(amount: string): boolean {
  return /^\d+(\.\d{1,2})?$/.test(amount.trim()) && Number(amount) >= 0.01;
}

type PaymentFieldsProps = { value: PaymentDraft; onChange: (value: PaymentDraft) => void; showStockBox?: boolean; autoFocusAmount?: boolean };

export function PaymentFields({ value, onChange, showStockBox = true, autoFocusAmount = false }: PaymentFieldsProps) {
  const { t } = useTranslation();
  const id = useId();
  const invalidAmount = value.amount !== "" && !isValidPaymentAmount(value.amount);
  const methods = [{ value: "digital_wallet", label: t("orders.wallet") }, { value: "bank_transfer", label: t("orders.bankTransfer") }];
  return <>
    <Field className="min-w-0"><FieldLabel htmlFor={`${id}-amount`}>{t("orders.paymentAmount")}</FieldLabel><Input id={`${id}-amount`} name="amount" className="h-control" type="number" min="0.01" step="0.01" value={value.amount} onChange={event => onChange({ ...value, amount: event.target.value })} autoFocus={autoFocusAmount}
      aria-invalid={invalidAmount} aria-describedby={invalidAmount ? `${id}-amount-error` : undefined} required />
      {invalidAmount && <p id={`${id}-amount-error`} role="alert" className="text-sm text-destructive">{t("orders.paymentInvalidAmount")}</p>}</Field>
    <Field className="min-w-0"><FieldLabel htmlFor={`${id}-method`}>{t("orders.paymentMethod")}</FieldLabel>
      <Select name="method" items={methods} value={value.method} onValueChange={method => onChange({ ...value, method: method as PaymentDraft["method"] })}>
        <SelectTrigger id={`${id}-method`} className="h-control"><SelectValue /></SelectTrigger>
        <SelectContent>{methods.map(method => <SelectItem key={method.value} value={method.value}>{method.label}</SelectItem>)}</SelectContent>
      </Select>
    </Field>
    {showStockBox && <Field orientation="horizontal" className="col-span-full min-h-touch items-center"><Checkbox id={`${id}-deduct`} name="deductStockIfPartial" checked={value.deductStockIfPartial} onCheckedChange={checked => onChange({ ...value, deductStockIfPartial: checked === true })} /><FieldLabel htmlFor={`${id}-deduct`}>{t("orders.deductStockIfPartial")}</FieldLabel></Field>}
  </>;
}
