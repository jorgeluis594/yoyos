import { useMemo } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import resources from "@core/app/locales";
import { CheckoutDeliveryFields } from "@core/app/components/checkout-delivery-fields";
import { CheckoutBuyerDetails, CheckoutOrderSummary, CheckoutShell, checkoutCard } from "@core/app/components/checkout-sections";
import type { PeruAreaSelection } from "@shared/peru-geography";
import { storeThemes, type StoreThemeId } from "@shared/store-themes";
import { CheckoutPreviewPage } from "@core/src/features/store-appearance/presentation/checkout-preview-page";
import { previewCheckout, previewOrderId, type PreviewState } from "@core/src/features/store-appearance/presentation/preview-fixtures";

const i18n = createInstance();
await i18n.use(initReactI18next).init({ lng: "es", resources, interpolation: { escapeValue: false } });

type PageProps = Readonly<{ theme: StoreThemeId; state: PreviewState | "cancelled" | "delivery"; logoUrl?: string | null }>;

/** An 8:1 wordmark, the longest logo shape the header must keep readable. */
const longLogo = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="160"><rect width="1280" height="160" fill="#1F5A8C"/><text x="640" y="112" font-family="Arial" font-size="104" font-weight="700" fill="#fff" text-anchor="middle">LIMA STUDIO</text></svg>')}`;

/** Home and agency delivery offered, so the district, recipient and agency fields show (the rates need the server). */
const deliveryOptions = { home: { offered: true as const, places: { departmentCodes: ["15"], provinceCodes: [], districtCodes: [] } as unknown as PeruAreaSelection }, agency: { offered: false as const }, store: { enabled: false as const, pickupPoint: null } };

/** The real checkout sections of every state a buyer sees, with the preview fixtures. */
function CheckoutPage({ theme, state, logoUrl = null }: PageProps) {
  const pending = useMemo(() => previewCheckout("Lima Studio", "review"), []);
  const cancelled = useMemo(() => ({ ...previewCheckout("Lima Studio", "review"), state: { kind: "cancelled" } as const }), []);
  // The payment content revalidates the loader after a report, so it needs a data router around it.
  const router = useMemo(() => {
    const appearance = { logoUrl, theme };
    return createMemoryRouter([{
    path: "*",
    element: <I18nextProvider i18n={i18n}><div className="-m-8">
      {state === "delivery"
        ? <CheckoutShell appearance={appearance} checkout={pending} summary={<CheckoutOrderSummary checkout={pending} deliveryDraft={null} />}>
          <div data-store-part="card" className={checkoutCard}><CheckoutDeliveryFields orderId={previewOrderId} checkout={pending} options={deliveryOptions} recipient={{ name: "Ana Pérez", phone: "+51987654321" }} onChange={() => undefined} /></div>
        </CheckoutShell>
        : state === "cancelled"
        ? <CheckoutShell appearance={appearance} checkout={cancelled} summary={<CheckoutOrderSummary checkout={cancelled} deliveryDraft={null} />}>
          <CheckoutBuyerDetails buyer={cancelled.buyer} delivery={cancelled.delivery} />
        </CheckoutShell>
        : <CheckoutPreviewPage companyName="Lima Studio" appearance={appearance} state={state} paymentMethods={null} />}
    </div></I18nextProvider>,
  }]);
  }, [theme, state, logoUrl, pending, cancelled]);
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
const stateName = { review: "Pendiente", payment: "Pago", cancelled: "Cancelado", delivery: "Entrega" } as const;

const pageStory = (theme: StoreThemeId, state: PageProps["state"]): Story => ({
  name: `${storeThemes[theme].name} · ${stateName[state]}`, args: { theme, state },
});

export const ClassicReview = pageStory("classic", "review");
export const ClassicPayment = pageStory("classic", "payment");
export const ClassicCancelled = pageStory("classic", "cancelled");
export const ClassicDelivery = pageStory("classic", "delivery");
export const BoutiqueReview = pageStory("boutique", "review");
export const BoutiquePayment = pageStory("boutique", "payment");
export const BoutiqueCancelled = pageStory("boutique", "cancelled");
export const BoutiqueDelivery = pageStory("boutique", "delivery");
export const AntojoReview = pageStory("antojo", "review");
export const AntojoPayment = pageStory("antojo", "payment");
export const AntojoCancelled = pageStory("antojo", "cancelled");
export const AntojoDelivery = pageStory("antojo", "delivery");
export const SuaveReview = pageStory("suave", "review");
export const SuavePayment = pageStory("suave", "payment");
export const SuaveCancelled = pageStory("suave", "cancelled");
export const SuaveDelivery = pageStory("suave", "delivery");
export const NocheReview = pageStory("noche", "review");
export const NochePayment = pageStory("noche", "payment");
export const NocheCancelled = pageStory("noche", "cancelled");
export const NocheDelivery = pageStory("noche", "delivery");

const longLogoStory = (theme: StoreThemeId): Story => ({
  name: `${storeThemes[theme].name} · Logo largo`, args: { theme, state: "review", logoUrl: longLogo },
});

export const ClassicLongLogo = longLogoStory("classic");
export const BoutiqueLongLogo = longLogoStory("boutique");
export const AntojoLongLogo = longLogoStory("antojo");
export const SuaveLongLogo = longLogoStory("suave");
export const NocheLongLogo = longLogoStory("noche");
