import { useTranslation } from "react-i18next";
import { Input } from "@core/app/components/ui/input";

export type PaymentDraft = { amount: string; method: "digital_wallet" | "bank_transfer"; deductStockIfPartial: boolean };

export function PaymentFields({ value, onChange }: { value: PaymentDraft; onChange: (value: PaymentDraft) => void }) {
  const { t } = useTranslation();
  return <>
    <label className="flex flex-col gap-1 text-sm">{t("orders.paymentAmount")}<Input name="amount" type="number" min="0.01" step="0.01" value={value.amount} onChange={event => onChange({ ...value, amount: event.target.value })} required /></label>
    <label className="flex flex-col gap-1 text-sm">{t("orders.paymentMethod")}<select name="method" className="min-h-control rounded-md border bg-background px-3 max-md:min-h-touch" value={value.method} onChange={event => onChange({ ...value, method: event.target.value as PaymentDraft["method"] })}>
      <option value="digital_wallet">{t("orders.wallet")}</option><option value="bank_transfer">{t("orders.bankTransfer")}</option></select></label>
    <label className="flex min-h-touch items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="deductStockIfPartial" checked={value.deductStockIfPartial} onChange={event => onChange({ ...value, deductStockIfPartial: event.target.checked })} />{t("orders.deductStockIfPartial")}</label>
  </>;
}
