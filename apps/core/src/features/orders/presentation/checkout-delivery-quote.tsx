import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import type { action } from "@core/app/routes/order-detail";
import type { OrderAggregateResponse } from "@shared/contracts/orders";
import { DeliverySummary } from "@core/src/features/orders/presentation/checkout-form";
import { Input } from "@core/app/components/ui/input";
import { Button } from "@core/app/components/ui/button";
import { Field, FieldLabel, FieldError } from "@core/app/components/ui/field";

const schema = z.object({ cost: z.string().trim().regex(/^\d+(?:\.\d{1,2})?$/), charge: z.boolean() });
export function CheckoutDeliveryQuote({ delivery, currency, disabled }: { disabled: boolean; delivery: NonNullable<OrderAggregateResponse["checkoutDeliveryRequest"]>; currency: string }) {
  const { t } = useTranslation();
  const fetcher = useFetcher<typeof action>();
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { cost: "", charge: true } });
  return <section className="space-y-4 rounded-lg border bg-card p-5" aria-labelledby="quote-title"><h2 id="quote-title" className="text-lg font-semibold">{t("checkoutQuote.title")}</h2><p className="text-sm text-muted-foreground">{t("checkoutQuote.hint")}</p><DeliverySummary delivery={delivery} />
    <form noValidate onSubmit={form.handleSubmit(values => fetcher.submit({ operation: "quote-delivery", cost: values.cost, charge: values.charge ? "on" : "off" }, { method: "post" }))} className="flex max-w-form flex-col gap-4">
      <fieldset disabled={disabled || fetcher.state !== "idle"} className="flex flex-col gap-4">
      <Controller name="cost" control={form.control} render={({ field, fieldState }) => <Field><FieldLabel htmlFor="quote-cost">{t("checkoutQuote.cost")} ({currency})</FieldLabel><Input {...field} id="quote-cost" inputMode="decimal" aria-invalid={!!fieldState.error} />{fieldState.error && <FieldError>{t("checkoutQuote.invalid")}</FieldError>}</Field>} />
      <Controller name="charge" control={form.control} render={({ field }) => <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={field.value} onChange={event => field.onChange(event.target.checked)} />{t("checkoutQuote.charge")}</label>} />
      {fetcher.data && "error" in fetcher.data && fetcher.data.error && <p role="alert" className="text-sm text-destructive">{t("checkoutQuote.error")}</p>}
      <Button type="submit" disabled={disabled || fetcher.state !== "idle"}>{t(fetcher.state === "idle" ? "checkoutQuote.save" : "checkoutQuote.saving")}</Button>
      </fieldset>
    </form>
  </section>;
}
