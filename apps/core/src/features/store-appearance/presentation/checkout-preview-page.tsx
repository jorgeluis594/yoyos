import { useMemo, useState, type ChangeEvent, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { CheckoutDeliveryFields, type CheckoutDeliveryDraft } from "@core/app/components/checkout-delivery-fields";
import {
  CheckoutBuyerDetails, CheckoutConfirmAction, CheckoutOrderSummary, CheckoutPayment, CheckoutReviewFields, CheckoutShell, checkoutTotal,
} from "@core/app/components/checkout-sections";
import type { PreviewPaymentMethod } from "@core/src/features/store-appearance/application/store-appearance";
import type { PublicStoreAppearance } from "@core/src/features/store-appearance/presentation/store-appearance-schemas";
import {
  previewCheckout, previewDeliveryOptions, previewOrderId, previewPaymentView, samplePaymentMethods, type PreviewState,
} from "@core/src/features/store-appearance/presentation/preview-fixtures";

type CheckoutPreviewPageProps = Readonly<{
  companyName: string;
  appearance: PublicStoreAppearance;
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
    summary={<CheckoutOrderSummary checkout={checkout} deliveryDraft={deliveryDraft}
      action={state === "review" && <CheckoutConfirmAction type="button" disabled={!deliveryDraft || !total} pending={false} />} />}>
    {state === "review"
      ? <form noValidate className="flex flex-col gap-4" onSubmit={keepFromSubmitting}>
        <CheckoutReviewFields message={null} name={{ defaultValue: "Ana Pérez" }} phone={{ defaultValue: "+51987654321" }}
          delivery={<CheckoutDeliveryFields orderId={previewOrderId} checkout={checkout} options={previewDeliveryOptions} recipient={{ name: "Ana Pérez", phone: "+51987654321" }} onChange={setDeliveryDraft} />} />
      </form>
      : <>
        <CheckoutBuyerDetails buyer={checkout.buyer} />
        <div onChangeCapture={stopUploads} onClickCapture={stopFilePicker}>
          <CheckoutPayment view={previewPaymentView(paymentMethods ?? samplePaymentMethods)}
            notice={paymentMethods === null && <p role="note" className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">{t("storePreview.sampleMethods")}</p>} />
        </div>
      </>}
  </CheckoutShell>;
}
