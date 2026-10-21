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
import { ProductThumbnail } from "@core/src/features/checkout-appearance/presentation/product-thumbnail";
import { CheckoutTheme } from "@core/src/features/checkout-appearance/presentation/checkout-theme";
import { BuyerPaymentContent } from "@core/src/features/orders/presentation/buyer-payment-content";
import { CircleCheck } from "lucide-react";

const checkoutAmount = (money: Money, language: string) => formatCurrency(money.amount, money.currency, language);

/** Total the buyer would pay: the order total once confirmed, or items + the chosen delivery while pending. */
export function checkoutTotal(checkout: PublicCheckoutResponse, deliveryDraft: CheckoutDeliveryDraft | null): Money | null {
  const summed = deliveryDraft?.delivery.kind === "replace" ? add(deliveryDraft.price)(checkout.itemsTotal) : null;
  return checkout.state.kind !== "pending" || deliveryDraft?.delivery.kind === "keep" ? checkout.total : summed?.success ? summed.data : null;
}

/** One coherent group of the checkout; every section shares this surface so groups read apart from each other. */
export const checkoutCard = "flex flex-col gap-4 rounded-[var(--radius-card)] border bg-card p-4 text-card-foreground sm:p-6";
const sectionTitle = "text-lg font-semibold";
const page = "mx-auto w-full max-w-5xl px-4 sm:px-8";

export function CheckoutShell({ appearance, checkout, banner, summary, children }: Readonly<{
  appearance: PublicCheckoutAppearance | null;
  checkout: Pick<PublicCheckoutResponse, "companyName" | "number" | "state">;
  /** Rendered inside the theme, above the page (the preview bar). */
  banner?: ReactNode;
  /** `<CheckoutOrderSummary>`: products above the form on small screens, beside it on wide ones. */
  summary?: ReactNode;
  children: ReactNode;
}>) {
  const { t } = useTranslation();
  return <CheckoutTheme appearance={appearance}>{banner}
    <header>
      <div data-checkout-part="header" className="border-b bg-card"><div className={`${page} flex min-h-16 items-center py-3`}><CheckoutBrandHeader companyName={checkout.companyName} logoUrl={appearance?.logoUrl ?? null} /></div></div>
      <div className={`${page} pt-6 pb-5 sm:pt-10 sm:pb-8`}><h1 data-checkout-part="order-title" className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">{t("checkoutSections.order", { number: checkout.number })}</h1><p className="mt-1 text-muted-foreground">{t("checkoutSections.reviewHint")}</p><CheckoutStatus state={checkout.state} /></div>
    </header>
    <main className={`${page} grid gap-4 pb-12 [grid-template-areas:'products'_'main'_'totals'] lg:grid-cols-[minmax(0,1fr)_22rem] lg:grid-rows-[auto_1fr] lg:gap-x-10 lg:[grid-template-areas:'main_products'_'main_totals']`}>
      <div className="flex min-w-0 flex-col gap-4 [grid-area:main]">{children}</div>
      {summary}
    </main>
  </CheckoutTheme>;
}

function CheckoutStatus({ state }: Readonly<{ state: PublicCheckoutResponse["state"] }>) {
  const { t } = useTranslation();
  if (state.kind === "cancelled") return <section role="status" data-checkout-part="status" className="mt-5 flex flex-col gap-1 rounded-[var(--radius-card)] border border-transparent bg-[var(--error-surface)] p-4 text-[var(--error)] sm:p-6"><h2 className={sectionTitle} data-checkout-part="section-title">{t("checkoutSections.cancelledTitle")}</h2><p>{t("checkoutSections.cancelledBody")}</p></section>;
  if (state.kind === "confirmed") return <section role="status" data-checkout-part="status" className="mt-5 flex flex-col gap-1 rounded-[var(--radius-card)] border border-transparent bg-[var(--success-surface)] p-4 text-[var(--success)] sm:p-6"><h2 data-checkout-part="section-title" className={`${sectionTitle} flex items-center gap-2`}><CircleCheck className="size-5" aria-hidden="true" />{t("checkoutSections.confirmedTitle")}</h2><p>{t("checkoutSections.confirmedBody")}</p><p>{t("checkoutSections.confirmedChanges")}</p></section>;
  return null;
}

export function CheckoutOrderSummary({ checkout, deliveryDraft, action }: Readonly<{
  checkout: PublicCheckoutResponse; deliveryDraft: CheckoutDeliveryDraft | null;
  /** `<CheckoutConfirmAction>`, kept beside the amount it commits to. */
  action?: ReactNode;
}>) {
  const { t, i18n } = useTranslation();
  const amount = (money: Money) => checkoutAmount(money, i18n.language);
  const total = checkoutTotal(checkout, deliveryDraft);
  const delivery = checkout.state.kind !== "pending" ? checkout.deliveryCharge : deliveryDraft?.price;
  return <>
    <section aria-labelledby="products-title" data-checkout-part="card" className={`${checkoutCard} [grid-area:products]`}><h2 id="products-title" data-checkout-part="section-title" className={sectionTitle}>{t("checkoutSections.products")}</h2>
      <ul className="-my-3 divide-y">{checkout.items.map((item, index) => <li key={index} data-checkout-part="product-row" className="flex items-center gap-3 py-3">
        <ProductThumbnail name={item.productName} url={item.imageUrl} />
        <div className="min-w-0 flex-1 break-words"><p data-checkout-part="product-name" className="font-medium">{item.productName}</p>{Object.keys(item.variantAttributes).length > 0 && <p data-checkout-part="product-meta" className="text-sm text-muted-foreground">{Object.values(item.variantAttributes).join(" · ")}</p>}<p data-checkout-part="product-meta" className="text-sm text-muted-foreground tabular-nums">{item.quantity} × {amount(item.unitPrice)}</p></div>
        <span data-checkout-part="price" className="shrink-0 font-medium tabular-nums">{amount(item.subtotal)}</span></li>)}</ul>
    </section>
    <section aria-label={t("checkoutSections.total")} data-checkout-part="card" className={`${checkoutCard} self-start [grid-area:totals] lg:sticky lg:top-6 ${checkout.state.kind === "confirmed" ? "max-lg:hidden" : ""}`}>
      <dl className="flex flex-col gap-2 text-sm">
        <div className="flex justify-between gap-4"><dt className="text-muted-foreground">{t("checkoutSections.subtotal")}</dt><dd className="tabular-nums">{amount(checkout.itemsTotal)}</dd></div>
        <div className="flex justify-between gap-4"><dt className="text-muted-foreground">{t("checkoutSections.delivery")}</dt><dd data-checkout-part={delivery?.amount === 0 ? "free" : undefined} className={delivery ? "tabular-nums" : "text-muted-foreground"}>{delivery ? (delivery.amount === 0 ? t("checkoutSections.free") : amount(delivery)) : t("checkoutSections.selectOption")}</dd></div>
        <div data-checkout-part="total" className="mt-2 flex items-baseline justify-between gap-4 border-t pt-4"><dt data-checkout-part="total-label" className="text-base font-semibold">{t("checkoutSections.total")}</dt><dd data-checkout-part="total-amount" className={total ? "text-2xl font-semibold tabular-nums" : "text-muted-foreground"}>{total ? amount(total) : t("checkoutSections.selectDelivery")}</dd></div>
      </dl>
      {action}
    </section>
  </>;
}

/** The content of the review form; whoever renders it supplies the `<form>`. */
export function CheckoutReviewFields({ message, name, nameError, phone, phoneError, delivery }: Readonly<{
  message: string | null;
  name: ComponentProps<typeof Input>; nameError?: string;
  phone: ComponentProps<typeof Input>; phoneError?: string;
  /** The delivery fieldset (`<CheckoutDeliveryFields>`). */
  delivery: ReactNode;
}>) {
  const { t } = useTranslation();
  return <>
    {message && <p role="alert" data-checkout-part="status" className="rounded-[var(--radius-card)] border border-transparent bg-[var(--error-surface)] p-4 text-[var(--error)]">{message}</p>}
    <section aria-labelledby="buyer-title" data-checkout-part="card" className={checkoutCard}><h2 id="buyer-title" data-checkout-part="section-title" className={sectionTitle}>{t("checkoutSections.yourData")}</h2><div data-checkout-part="field-group" className="flex flex-col gap-4">
      <Field data-checkout-part="field" data-invalid={Boolean(nameError)}><FieldLabel htmlFor="buyer-name">{t("checkoutSections.name")}</FieldLabel><Input {...name} id="buyer-name" autoComplete="name" required aria-invalid={Boolean(nameError)} aria-describedby={nameError ? "name-error" : undefined} />{nameError && <FieldError id="name-error">{nameError}</FieldError>}</Field>
      <Field data-checkout-part="field" data-invalid={Boolean(phoneError)}><FieldLabel htmlFor="buyer-phone">{t("checkoutSections.phone")}</FieldLabel><Input {...phone} id="buyer-phone" type="tel" autoComplete="tel" required aria-invalid={Boolean(phoneError)} aria-describedby="phone-hint phone-error" /><p id="phone-hint" className="text-sm text-muted-foreground">{t("checkoutSections.phoneHint")}</p>{phoneError && <FieldError id="phone-error">{phoneError}</FieldError>}</Field></div>
    </section>
    <div data-checkout-part="card" className={checkoutCard}>{delivery}</div>
  </>;
}

/** The single confirmation button; `form` ties it to the review form when it renders outside it. */
export function CheckoutConfirmAction({ form, type, disabled, pending }: Readonly<{ form?: string; type: "submit" | "button"; disabled: boolean; pending: boolean }>) {
  const { t } = useTranslation();
  return <div className="flex flex-col gap-3">
    <Button form={form} type={type} disabled={disabled} className="h-12 w-full text-base">{pending ? t("checkoutSections.confirming") : t("checkoutSections.confirm")}</Button>
    <p className="text-center text-sm text-muted-foreground text-pretty">{t("checkoutSections.confirmNote")}</p>
  </div>;
}

export function CheckoutBuyerDetails({ buyer }: Readonly<{ buyer: PublicCheckoutResponse["buyer"] }>) {
  const { t } = useTranslation();
  return buyer && <section data-checkout-part="card" className={checkoutCard}><h2 data-checkout-part="section-title" className={sectionTitle}>{t("checkoutSections.buyerDetails")}</h2><div><p className="font-medium">{buyer.name}</p><p className="text-muted-foreground tabular-nums">{buyer.phone}</p></div></section>;
}

export function CheckoutPayment({ view, notice }: Readonly<{ view: BuyerPaymentView; notice?: ReactNode }>) {
  const { t } = useTranslation();
  return <section aria-label={t("checkoutSections.payment")} className="flex flex-col gap-4">{notice}<BuyerPaymentContent view={view} /></section>;
}
