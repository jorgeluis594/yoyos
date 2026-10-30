import { useTranslation } from "react-i18next";
import { Clock } from "lucide-react";
import type { OrderAggregateResponse } from "@shared/contracts/orders";
import { Alert, AlertDescription, AlertTitle } from "@core/app/components/ui/alert";
import { shortItemLines } from "@core/src/features/orders/presentation/stock-due";

/** Static warning between the page header and the cards; an order that is deducted or not due shows nothing. */
export function StockDueNotice({ order }: Readonly<{ order: Pick<OrderAggregateResponse, "items" | "stockDue" | "stockDeducted"> }>) {
  const { t } = useTranslation();
  if (order.stockDue === null || order.stockDeducted) return null;
  const waiting = order.stockDue.kind === "waiting";
  return <Alert variant="warning" role="group" aria-labelledby="stock-due-title">
    <Clock aria-hidden="true" />
    <AlertTitle><h2 id="stock-due-title">{t(waiting ? "orderStock.waitingTitle" : "orderStock.deductingTitle")}</h2></AlertTitle>
    <AlertDescription className="flex flex-col gap-2">
      {waiting ? <>
        <ul className="flex flex-col gap-1">{shortItemLines(order).map(line => <li key={line.variantId}>{t("orderStock.shortItem", { name: line.name, quantity: line.quantity, available: line.available })}</li>)}</ul>
        <p>{t("orderStock.waitingBody")}</p>
      </> : <p>{t("orderStock.deductingBody")}</p>}
    </AlertDescription>
  </Alert>;
}
