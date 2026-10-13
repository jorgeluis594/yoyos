import type { ComponentProps, ReactNode } from "react";
import { useTranslation } from "react-i18next";
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

const checkoutAmount = (money: Money, language: string) => formatCurrency(money.amount, money.currency, language);

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
  const { t } = useTranslation();
  return <CheckoutTheme appearance={appearance}>{banner}<main className="mx-auto flex max-w-lg flex-col gap-6 p-5 py-8">
    <header><CheckoutBrandHeader companyName={checkout.companyName} logoUrl={appearance?.logoUrl ?? null} /><h1 className="text-2xl font-semibold">{t("checkoutSections.order", { number: checkout.number })}</h1><p>{t("checkoutSections.reviewHint")}</p></header>
    {children}
  </main></CheckoutTheme>;
}

export function CheckoutOrderSummary({ checkout, deliveryDraft }: Readonly<{ checkout: PublicCheckoutResponse; deliveryDraft: CheckoutDeliveryDraft | null }>) {
  const { t, i18n } = useTranslation();
  const amount = (money: Money) => checkoutAmount(money, i18n.language);
  const total = checkoutTotal(checkout, deliveryDraft);
  return <>
    {checkout.state.kind === "cancelled" && <section role="status"><h2 className="text-xl font-semibold">{t("checkoutSections.cancelledTitle")}</h2><p>{t("checkoutSections.cancelledBody")}</p></section>}
    {checkout.state.kind === "confirmed" && <section role="status"><h2 className="text-xl font-semibold">{t("checkoutSections.confirmedTitle")}</h2><p>{t("checkoutSections.confirmedBody")}</p><p>{t("checkoutSections.confirmedChanges")}</p></section>}
    <section aria-labelledby="products-title"><h2 id="products-title" className="font-semibold">{t("checkoutSections.products")}</h2><ul className="divide-y">{checkout.items.map((item, index) => <li key={index} className="flex justify-between gap-4 py-4"><div className="min-w-0 break-words"><p className="font-medium">{item.productName}</p><p className="text-sm text-muted-foreground">{Object.values(item.variantAttributes).join(" · ")}</p><p>{item.quantity} × {amount(item.unitPrice)}</p></div><strong className="shrink-0">{amount(item.subtotal)}</strong></li>)}</ul></section>
    <dl className="flex flex-col gap-2"><div className="flex justify-between gap-4"><dt>{t("checkoutSections.subtotal")}</dt><dd>{amount(checkout.itemsTotal)}</dd></div><div className="flex justify-between gap-4"><dt>{t("checkoutSections.delivery")}</dt><dd>{checkout.state.kind !== "pending" ? (checkout.deliveryCharge.amount === 0 ? t("checkoutSections.free") : amount(checkout.deliveryCharge)) : deliveryDraft ? (deliveryDraft.price.amount === 0 ? t("checkoutSections.free") : amount(deliveryDraft.price)) : t("checkoutSections.selectOption")}</dd></div><div className="flex justify-between gap-4 text-xl font-semibold"><dt>{t("checkoutSections.total")}</dt><dd>{total ? amount(total) : t("checkoutSections.selectDelivery")}</dd></div></dl>
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
  const { t } = useTranslation();
  return <>
    <h2 className="text-lg font-semibold">{t("checkoutSections.yourData")}</h2>
    {message && <p role="alert">{message}</p>}
    <Field data-invalid={Boolean(nameError)}><FieldLabel htmlFor="buyer-name">{t("checkoutSections.name")}</FieldLabel><Input {...name} id="buyer-name" autoComplete="name" required aria-invalid={Boolean(nameError)} aria-describedby={nameError ? "name-error" : undefined} />{nameError && <FieldError id="name-error">{nameError}</FieldError>}</Field>
    <Field data-invalid={Boolean(phoneError)}><FieldLabel htmlFor="buyer-phone">{t("checkoutSections.phone")}</FieldLabel><Input {...phone} id="buyer-phone" type="tel" autoComplete="tel" required aria-invalid={Boolean(phoneError)} aria-describedby="phone-hint phone-error" /><p id="phone-hint" className="text-sm text-muted-foreground">{t("checkoutSections.phoneHint")}</p>{phoneError && <FieldError id="phone-error">{phoneError}</FieldError>}</Field>
    {delivery}
    <Button type={confirm.type} disabled={confirm.disabled}>{confirm.pending ? t("checkoutSections.confirming") : t("checkoutSections.confirm")}</Button><p className="text-sm text-muted-foreground">{t("checkoutSections.confirmNote")}</p>
  </>;
}

export function CheckoutBuyerDetails({ buyer }: Readonly<{ buyer: PublicCheckoutResponse["buyer"] }>) {
  const { t } = useTranslation();
  return buyer && <section><h2 className="font-semibold">{t("checkoutSections.buyerDetails")}</h2><p>{buyer.name}</p><p>{buyer.phone}</p></section>;
}

export function CheckoutPayment({ view, notice }: Readonly<{ view: BuyerPaymentView; notice?: ReactNode }>) {
  const { t } = useTranslation();
  return <section aria-label={t("checkoutSections.payment")} className="flex flex-col gap-4">{notice}<BuyerPaymentContent view={view} /></section>;
}
