import { useEffect, useState } from "react";
import type { ColorSchemeHandle } from "@core/app/color-scheme";
import { useLoaderData, type LoaderFunctionArgs } from "react-router";
import { bindRequestOperation } from "@core/src/shared/infrastructure/logger";
import { privateUserContext } from "@core/app/private-user-context";
import { storeAppearance } from "@core/src/features/store-appearance/composition";
import { parseCompanyId } from "@core/src/features/store-appearance/domain/store-appearance";
import type { StorePreviewMessage } from "@core/src/features/store-appearance/presentation/store-appearance-schemas";
import { CheckoutPreviewPage } from "@core/src/features/store-appearance/presentation/checkout-preview-page";
import { announcePreviewReady, listenForPreviewUpdates } from "@core/src/features/store-appearance/presentation/preview-protocol";

export { middleware } from "@core/app/private-access";
export const headers = () => ({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
export const handle = { colorScheme: () => "fixed" } satisfies ColorSchemeHandle;
export const meta = () => [{ title: "Vista previa del checkout" }, { name: "robots", content: "noindex, nofollow" }];

export async function loader({ context }: LoaderFunctionArgs) {
  bindRequestOperation({ operation: "get_store_preview" });
  const { company } = context.get(privateUserContext);
  const companyId = parseCompanyId(company.id);
  const preview = companyId.success ? await storeAppearance.getPreview(companyId.data) : companyId;
  if (!preview.success) {
    bindRequestOperation({ outcome: "technical_failure" });
    throw new Response("Preview unavailable", { status: 503, headers: headers() });
  }
  bindRequestOperation({ outcome: "rendered" });
  const { companyName, appearance, logoUrl, paymentSettings } = preview.data;
  return { companyName, paymentSettings, appearance: { logoUrl, theme: appearance.theme } };
}

export default function StoreAppearancePreview() {
  const { companyName, appearance, paymentSettings } = useLoaderData<typeof loader>();
  const [draft, setDraft] = useState<StorePreviewMessage | null>(null);

  useEffect(() => {
    const stop = listenForPreviewUpdates(window, setDraft);
    // Tests and the editor can rely on this: from here on, updates are applied.
    document.documentElement.dataset.storePreview = "ready";
    announcePreviewReady(window);
    return () => { stop(); delete document.documentElement.dataset.storePreview; };
  }, []);

  return <CheckoutPreviewPage companyName={companyName} appearance={draft?.appearance ?? appearance}
    state={draft?.state ?? "review"} paymentMethods={paymentSettings} />;
}
