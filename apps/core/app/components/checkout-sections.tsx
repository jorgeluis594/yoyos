import type { ComponentProps, ReactNode } from "react";
import { add, type Money } from "@shared/money";
import type { PublicCheckoutResponse } from "@shared/contracts/order-checkout";
import type { BuyerPaymentView } from "@shared/contracts/orders";
import { Button } from "@core/app/components/ui/button";
import { Field, FieldError, FieldLabel } from "@core/app/components/ui/field";
import { Input } from "@core/app/components/ui/input";
import type { CheckoutDeliveryDraft } from "@core/app/components/checkout-delivery-fields";
import { formatCurrency } from "@core/app/format-currency";
import type { PublicCheckoutAppearance } from "@core/src/features/checkout-appearance/presentation/checkout-appearance-schemas";
import { CheckoutBrandHeader } from "@core/src/features/checkout-appearance/presentation/checkout-brand-header";
import { CheckoutTheme } from "@core/src/features/checkout-appearance/presentation/checkout-theme";
import { BuyerPaymentContent } from "@core/src/features/orders/presentation/buyer-payment-content";

export const checkoutAmount = (money: Money) => formatCurrency(money.amount, money.currency, "es");

/** Total the buyer would pay: the order total once confirmed, or items + the chosen delivery while pending. */
export function checkoutTotal(checkout: PublicCheckoutResponse, deliveryDraft: CheckoutDeliveryDraft | null): Money | null {
  const summed = deliveryDraft?.delivery.kind === "replace" ? add(deliveryDraft.price)(checkout.itemsTotal) : null;
  return checkout.state.kind !== "pending" || deliveryDraft?.delivery.kind === "keep" ? checkout.total : summed?.success ? summed.data : null;
}

export function CheckoutShell({ appearance, checkout, banner, children }: Readonly<{
  appearance: PublicCheckoutAppearance | null;
  checkout: Pick<PublicCheckoutResponse, "companyName" | "number">;
  /** Rendered inside the theme, above the page (the preview bar). */
  banner?: ReactNode;
  children: ReactNode;
}>) {
  return <CheckoutTheme appearance={appearance}>{banner}<main className="mx-auto flex max-w-lg flex-col gap-6 p-5 py-8">
    <header><CheckoutBrandHeader companyName={checkout.companyName} logoUrl={appearance?.logoUrl ?? null} /><h1 className="text-2xl font-semibold">Pedido #{checkout.number}</h1><p>Revisa los productos y el total de tu pedido.</p></header>
    {children}
  </main></CheckoutTheme>;
}

export function CheckoutOrderSummary({ checkout, deliveryDraft }: Readonly<{ checkout: PublicCheckoutResponse; deliveryDraft: CheckoutDeliveryDraft | null }>) {
  const total = checkoutTotal(checkout, deliveryDraft);
  const amount = checkoutAmount;
  return <>
    {checkout.state.kind === "cancelled" && <section role="status"><h2 className="text-xl font-semibold">Pedido cancelado</h2><p>Este pedido ya no puede confirmarse. Contacta al vendedor.</p></section>}
    {checkout.state.kind === "confirmed" && <section role="status"><h2 className="text-xl font-semibold">Pedido confirmado</h2><p>Recibimos tu confirmación. Esto no registra un pago.</p><p>Para solicitar cambios, contacta al vendedor por el canal que ya utilizan.</p></section>}
    <section aria-labelledby="products-title"><h2 id="products-title" className="font-semibold">Productos</h2><ul className="divide-y">{checkout.items.map((item, index) => <li key={index} className="flex justify-between gap-4 py-4"><div className="min-w-0 break-words"><p className="font-medium">{item.productName}</p><p className="text-sm text-muted-foreground">{Object.values(item.variantAttributes).join(" · ")}</p><p>{item.quantity} × {amount(item.unitPrice)}</p></div><strong className="shrink-0">{amount(item.subtotal)}</strong></li>)}</ul></section>
    <dl className="flex flex-col gap-2"><div className="flex justify-between gap-4"><dt>Subtotal de productos</dt><dd>{amount(checkout.itemsTotal)}</dd></div><div className="flex justify-between gap-4"><dt>Entrega</dt><dd>{checkout.state.kind !== "pending" ? (checkout.deliveryCharge.amount === 0 ? "Gratis" : amount(checkout.deliveryCharge)) : deliveryDraft ? (deliveryDraft.price.amount === 0 ? "Gratis" : amount(deliveryDraft.price)) : "Selecciona una opción"}</dd></div><div className="flex justify-between gap-4 text-xl font-semibold"><dt>Total a pagar</dt><dd>{total ? amount(total) : "Selecciona entrega"}</dd></div></dl>
  </>;
}

/** The content of the review form; whoever renders it supplies the `<form>`. */
export function CheckoutReviewFields({ message, name, nameError, phone, phoneError, delivery, confirm }: Readonly<{
  message: string | null;
  name: ComponentProps<typeof Input>; nameError?: string;
  phone: ComponentProps<typeof Input>; phoneError?: string;
  /** The delivery fieldset (`<CheckoutDeliveryFields>`). */
  delivery: ReactNode;
  confirm: Readonly<{ type: "submit" | "button"; disabled: boolean; pending: boolean }>;
}>) {
  const errors = { name: nameError, phone: phoneError };
  return <>
    <h2 className="text-lg font-semibold">Tus datos</h2>
    {message && <p role="alert">{message}</p>}
    <Field data-invalid={Boolean(errors?.name)}><FieldLabel htmlFor="buyer-name">Nombre</FieldLabel><Input {...name} id="buyer-name" autoComplete="name" required aria-invalid={Boolean(errors?.name)} aria-describedby={errors?.name ? "name-error" : undefined} />{errors?.name && <FieldError id="name-error">{errors.name}</FieldError>}</Field>
    <Field data-invalid={Boolean(errors?.phone)}><FieldLabel htmlFor="buyer-phone">Teléfono</FieldLabel><Input {...phone} id="buyer-phone" type="tel" autoComplete="tel" required aria-invalid={Boolean(errors?.phone)} aria-describedby="phone-hint phone-error" /><p id="phone-hint" className="text-sm text-muted-foreground">Incluye el código de país, por ejemplo +51987654321.</p>{errors?.phone && <FieldError id="phone-error">{errors.phone}</FieldError>}</Field>
    {delivery}
    <Button type={confirm.type} disabled={confirm.disabled}>{confirm.pending ? "Confirmando…" : "Confirmar pedido"}</Button><p className="text-sm text-muted-foreground">Confirmas tu intención de compra. El pago se coordina por separado.</p>
  </>;
}

export function CheckoutBuyerDetails({ buyer }: Readonly<{ buyer: PublicCheckoutResponse["buyer"] }>) {
  return buyer && <section><h2 className="font-semibold">Datos del comprador</h2><p>{buyer.name}</p><p>{buyer.phone}</p></section>;
}

export function CheckoutPayment({ view, notice }: Readonly<{ view: BuyerPaymentView; notice?: ReactNode }>) {
  return <section aria-label="Pago del pedido" className="flex flex-col gap-4">{notice}<BuyerPaymentContent view={view} /></section>;
}
