import { useEffect, useState } from "react";
import { useLoaderData, type LoaderFunctionArgs } from "react-router";
import { bindRequestOperation } from "@core/src/shared/infrastructure/logger";
import { privateUserContext } from "@core/app/private-user-context";
import { checkoutAppearance, parseCompanyId } from "@core/src/features/checkout-appearance";
import type { CheckoutPreviewMessage } from "@core/src/features/checkout-appearance/presentation/checkout-appearance-schemas";
import { CheckoutPreviewPage } from "@core/src/features/checkout-appearance/presentation/checkout-preview-page";
import { announcePreviewReady, listenForPreviewUpdates } from "@core/src/features/checkout-appearance/presentation/preview-protocol";

export { middleware } from "@core/app/private-access";
export const headers = () => ({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
export const meta = () => [{ title: "Vista previa del checkout" }, { name: "robots", content: "noindex, nofollow" }];

export async function loader({ context }: LoaderFunctionArgs) {
  bindRequestOperation({ operation: "get_checkout_preview" });
  const { company } = context.get(privateUserContext);
  const companyId = parseCompanyId(company.id);
  const preview = companyId.success ? await checkoutAppearance.getPreview(companyId.data) : companyId;
  if (!preview.success) {
    bindRequestOperation({ outcome: "technical_failure" });
    throw new Response("Preview unavailable", { status: 503, headers: headers() });
  }
  bindRequestOperation({ outcome: "rendered" });
  const { companyName, appearance, logoUrl, paymentSettings } = preview.data;
  return { companyName, paymentSettings, appearance: { logoUrl, brandColor: appearance.brandColor, background: appearance.background } };
}

export default function CheckoutAppearancePreview() {
  const { companyName, appearance, paymentSettings } = useLoaderData<typeof loader>();
  const [draft, setDraft] = useState<CheckoutPreviewMessage | null>(null);

  useEffect(() => {
    const stop = listenForPreviewUpdates(window, setDraft);
    // Tests and the editor can rely on this: from here on, updates are applied.
    document.documentElement.dataset.checkoutPreview = "ready";
    announcePreviewReady(window);
    return () => { stop(); delete document.documentElement.dataset.checkoutPreview; };
  }, []);
  // Only the page's own `.dark` class changes: the seller's saved theme preference is never written.
  useEffect(() => {
    if (draft) document.documentElement.classList.toggle("dark", draft.mode === "dark");
  }, [draft]);

  return <CheckoutPreviewPage companyName={companyName} appearance={draft?.appearance ?? appearance}
    state={draft?.state ?? "review"} paymentMethods={paymentSettings} />;
}
