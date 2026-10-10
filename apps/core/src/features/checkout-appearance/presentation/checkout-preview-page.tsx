import { useMemo, useState, type ChangeEvent, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { CheckoutDeliveryFields, type CheckoutDeliveryDraft } from "@core/app/components/checkout-delivery-fields";
import {
  CheckoutBuyerDetails, CheckoutOrderSummary, CheckoutPayment, CheckoutReviewFields, CheckoutShell, checkoutTotal,
} from "@core/app/components/checkout-sections";
import type { PreviewPaymentMethod } from "@core/src/features/checkout-appearance/application/checkout-appearance";
import type { PublicCheckoutAppearance } from "@core/src/features/checkout-appearance/presentation/checkout-appearance-schemas";
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
  const [deliveryDraft, setDeliveryDraft] = useState<CheckoutDeliveryDraft | null>(null);
  // Stable between renders: the delivery fields re-derive their draft from it.
  const checkout = useMemo(() => previewCheckout(companyName, state), [companyName, state]);
  const total = checkoutTotal(checkout, deliveryDraft);
  return <CheckoutShell appearance={appearance} checkout={checkout}
    banner={<p data-slot="preview-bar" className="sticky top-0 z-10 border-b bg-muted px-4 py-2 text-center text-sm font-medium text-muted-foreground">{t("checkoutPreview.bar")}</p>}>
    <CheckoutOrderSummary checkout={checkout} deliveryDraft={deliveryDraft} />
    {state === "review"
      ? <form noValidate className="flex flex-col gap-5" onSubmit={keepFromSubmitting}>
        <CheckoutReviewFields message={null} name={{ defaultValue: "Ana Pérez" }} phone={{ defaultValue: "+51987654321" }}
          delivery={<CheckoutDeliveryFields orderId={previewOrderId} checkout={checkout} options={previewDeliveryOptions} onChange={setDeliveryDraft} />}
          confirm={{ type: "button", disabled: !deliveryDraft || !total, pending: false }} />
      </form>
      : <>
        <CheckoutBuyerDetails buyer={checkout.buyer} />
        <div onChangeCapture={stopUploads} onClickCapture={stopFilePicker}>
          <CheckoutPayment view={previewPaymentView(paymentMethods ?? samplePaymentMethods)}
            notice={paymentMethods === null && <p role="note" className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">{t("checkoutPreview.sampleMethods")}</p>} />
        </div>
      </>}
  </CheckoutShell>;
}
