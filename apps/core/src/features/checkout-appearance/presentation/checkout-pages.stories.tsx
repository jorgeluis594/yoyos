import { useMemo } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import resources from "@core/app/locales";
import { CheckoutBuyerDetails, CheckoutOrderSummary, CheckoutShell } from "@core/app/components/checkout-sections";
import { checkoutThemes, type CheckoutThemeId } from "@core/src/features/checkout-appearance/domain/checkout-themes";
import { CheckoutPreviewPage } from "@core/src/features/checkout-appearance/presentation/checkout-preview-page";
import { previewCheckout, type PreviewState } from "@core/src/features/checkout-appearance/presentation/preview-fixtures";

const i18n = createInstance();
await i18n.use(initReactI18next).init({ lng: "es", resources, interpolation: { escapeValue: false } });

type PageProps = Readonly<{ theme: CheckoutThemeId; state: PreviewState | "cancelled" }>;

/** The real checkout sections of every state a buyer sees, with the preview fixtures. */
function CheckoutPage({ theme, state }: PageProps) {
  const cancelled = useMemo(() => ({ ...previewCheckout("Lima Studio", "review"), state: { kind: "cancelled" } as const }), []);
  // The payment content revalidates the loader after a report, so it needs a data router around it.
  const router = useMemo(() => {
    const appearance = { logoUrl: null, theme };
    return createMemoryRouter([{
    path: "*",
    element: <I18nextProvider i18n={i18n}><div className="-m-8">
      {state === "cancelled"
        ? <CheckoutShell appearance={appearance} checkout={cancelled} summary={<CheckoutOrderSummary checkout={cancelled} deliveryDraft={null} />}>
          <CheckoutBuyerDetails buyer={cancelled.buyer} />
        </CheckoutShell>
        : <CheckoutPreviewPage companyName="Lima Studio" appearance={appearance} state={state} paymentMethods={null} />}
    </div></I18nextProvider>,
  }]);
  }, [theme, state, cancelled]);
  return <RouterProvider router={router} />;
}

const meta = {
  title: "Checkout/Pantallas",
  component: CheckoutPage,
  parameters: { layout: "fullscreen" },
  argTypes: { theme: { table: { disable: true } } },
} satisfies Meta<typeof CheckoutPage>;
export default meta;

type Story = StoryObj<typeof meta>;
const stateName = { review: "Pendiente", payment: "Pago", cancelled: "Cancelado" } as const;

const pageStory = (theme: CheckoutThemeId, state: PageProps["state"]): Story => ({
  name: `${checkoutThemes[theme].name} · ${stateName[state]}`, args: { theme, state },
});

export const ClassicReview = pageStory("classic", "review");
export const ClassicPayment = pageStory("classic", "payment");
export const ClassicCancelled = pageStory("classic", "cancelled");
export const BoutiqueReview = pageStory("boutique", "review");
export const BoutiquePayment = pageStory("boutique", "payment");
export const BoutiqueCancelled = pageStory("boutique", "cancelled");
export const AntojoReview = pageStory("antojo", "review");
export const AntojoPayment = pageStory("antojo", "payment");
export const AntojoCancelled = pageStory("antojo", "cancelled");
export const SuaveReview = pageStory("suave", "review");
export const SuavePayment = pageStory("suave", "payment");
export const SuaveCancelled = pageStory("suave", "cancelled");
export const NocheReview = pageStory("noche", "review");
export const NochePayment = pageStory("noche", "payment");
export const NocheCancelled = pageStory("noche", "cancelled");
