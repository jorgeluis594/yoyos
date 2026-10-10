import type { ChangeEvent, MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@core/app/components/ui/button";
import { Field, FieldLabel } from "@core/app/components/ui/field";
import { Input } from "@core/app/components/ui/input";
import { CheckoutDeliveryFields } from "@core/app/components/checkout-delivery-fields";
import { formatCurrency } from "@core/app/format-currency";
import { BuyerPaymentContent } from "@core/src/features/orders/presentation/buyer-payment-content";
import type { PreviewPaymentMethod } from "@core/src/features/checkout-appearance/application/checkout-appearance";
import type { PublicCheckoutAppearance } from "@core/src/features/checkout-appearance/presentation/checkout-appearance-schemas";
import { CheckoutBrandHeader } from "@core/src/features/checkout-appearance/presentation/checkout-brand-header";
import { CheckoutTheme } from "@core/src/features/checkout-appearance/presentation/checkout-theme";
import {
  previewCheckout, previewDeliveryOptions, previewOrderId, previewPaymentView, samplePaymentMethods, type PreviewState,
} from "@core/src/features/checkout-appearance/presentation/preview-fixtures";

type CheckoutPreviewPageProps = Readonly<{
  companyName: string;
  appearance: PublicCheckoutAppearance;
  state: PreviewState;
  /** The company's real payment methods, or `null` to show labelled samples. */
  paymentMethods: readonly PreviewPaymentMethod[] | null;
}>;

const ignoreDelivery = () => {};
const keepFromSubmitting = (event: { preventDefault: () => void }) => event.preventDefault();

/** The preview has no action: uploads are stopped before the real handlers see them. */
function stopUploads(event: ChangeEvent<HTMLElement>) {
  if (event.target instanceof HTMLInputElement && event.target.type === "file") event.stopPropagation();
}
function stopFilePicker(event: MouseEvent<HTMLElement>) {
  if (event.target instanceof HTMLInputElement && event.target.type === "file") event.preventDefault();
}

export function CheckoutPreviewPage({ companyName, appearance, state, paymentMethods }: CheckoutPreviewPageProps) {
  const { t } = useTranslation();
  const checkout = previewCheckout(companyName, state);
  const amount = (money: typeof checkout.total) => formatCurrency(money.amount, money.currency, "es");
  return <CheckoutTheme appearance={appearance}>
    <p data-slot="preview-bar" className="sticky top-0 z-10 border-b bg-muted px-4 py-2 text-center text-sm font-medium text-muted-foreground">{t("checkoutPreview.bar")}</p>
    <main className="mx-auto flex max-w-lg flex-col gap-6 p-5 py-8">
      <CheckoutBrandHeader companyName={companyName} logoUrl={appearance.logoUrl} />
      <header><h1 className="text-2xl font-semibold">Pedido #{checkout.number}</h1><p>Revisa los productos y el total de tu pedido.</p></header>
      {state === "payment" && <section role="status"><h2 className="text-xl font-semibold">Pedido confirmado</h2><p>Recibimos tu confirmación. Esto no registra un pago.</p></section>}
      <section aria-labelledby="products-title"><h2 id="products-title" className="font-semibold">Productos</h2><ul className="divide-y">{checkout.items.map((item) =>
        <li key={item.productName} className="flex justify-between gap-4 py-4"><div className="min-w-0 break-words"><p className="font-medium">{item.productName}</p>
          <p className="text-sm text-muted-foreground">{Object.values(item.variantAttributes).join(" · ")}</p><p>{item.quantity} × {amount(item.unitPrice)}</p></div>
          <strong className="shrink-0">{amount(item.subtotal)}</strong></li>)}</ul></section>
      <dl className="flex flex-col gap-2"><div className="flex justify-between gap-4"><dt>Subtotal de productos</dt><dd>{amount(checkout.itemsTotal)}</dd></div>
        <div className="flex justify-between gap-4"><dt>Entrega</dt><dd>{state === "payment" ? amount(checkout.deliveryCharge) : "Gratis"}</dd></div>
        <div className="flex justify-between gap-4 text-xl font-semibold"><dt>Total a pagar</dt><dd>{amount(checkout.total)}</dd></div></dl>
      {state === "review"
        ? <form noValidate className="flex flex-col gap-5" onSubmit={keepFromSubmitting}>
          <h2 className="text-lg font-semibold">Tus datos</h2>
          <Field><FieldLabel htmlFor="buyer-name">Nombre</FieldLabel><Input id="buyer-name" autoComplete="off" defaultValue="Ana Pérez" /></Field>
          <Field><FieldLabel htmlFor="buyer-phone">Teléfono</FieldLabel><Input id="buyer-phone" type="tel" autoComplete="off" defaultValue="+51987654321" />
            <p className="text-sm text-muted-foreground">Incluye el código de país, por ejemplo +51987654321.</p></Field>
          <CheckoutDeliveryFields orderId={previewOrderId} checkout={checkout} options={previewDeliveryOptions} onChange={ignoreDelivery} />
          <Button type="button">Confirmar pedido</Button>
          <p className="text-sm text-muted-foreground">Confirmas tu intención de compra. El pago se coordina por separado.</p>
        </form>
        : <div onChangeCapture={stopUploads} onClickCapture={stopFilePicker}>
          {paymentMethods === null && <p role="note" className="mb-4 rounded-md border border-dashed p-3 text-sm text-muted-foreground">{t("checkoutPreview.sampleMethods")}</p>}
          <BuyerPaymentContent view={previewPaymentView(paymentMethods ?? samplePaymentMethods)} />
        </div>}
    </main>
  </CheckoutTheme>;
}
