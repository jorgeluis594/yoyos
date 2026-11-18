import { useTranslation } from "react-i18next";
import { Button } from "@core/app/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@core/app/components/ui/dialog";
import { formatCurrency } from "@core/app/format-currency";
import type { Money } from "@shared/money";

/**
 * «¿Anular el pago de S/ 20.00?»: voiding a payment never happens by accident. It names the amount, the order and the buyer when there is one;
 * **Mantener pago** (or closing) leaves the payment confirmed.
 */
export function VoidPaymentDialog({ amount, orderNumber, buyerName, onVoid, onKeep }: Readonly<{
  amount: Money; orderNumber: number; buyerName: string | null; onVoid: () => void; onKeep: () => void;
}>) {
  const { t, i18n } = useTranslation();
  const formatted = formatCurrency(amount.amount, amount.currency, i18n.language);
  const description = buyerName ? t("orders.voidDescriptionBuyer", { number: orderNumber, buyer: buyerName }) : t("orders.voidDescription", { number: orderNumber });
  return <Dialog open onOpenChange={open => { if (!open) onKeep(); }}>
    <DialogContent>
      <DialogHeader><DialogTitle>{t("orders.voidTitle", { amount: formatted })}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
      <DialogFooter>
        <Button type="button" variant="outline" className="min-h-touch md:min-h-control" onClick={onKeep}>{t("orders.voidKeep")}</Button>
        <Button type="button" variant="destructive" className="min-h-touch md:min-h-control" onClick={onVoid}>{t("orders.voidConfirm")}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
