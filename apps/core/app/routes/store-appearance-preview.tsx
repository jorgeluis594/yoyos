import { useEffect, useState } from "react";
import type { ColorSchemeHandle } from "@core/app/color-scheme";
import { useLoaderData, type LoaderFunctionArgs } from "react-router";
import { bindRequestOperation } from "@core/src/shared/infrastructure/logger";
import { privateUserContext } from "@core/app/private-user-context";
import { storeAppearance } from "@core/src/features/store-appearance/composition";
import { parseCompanyId } from "@core/src/features/store-appearance/domain/store-appearance";
import { CatalogPreview } from "@core/app/components/catalog-preview";
import type { StorePreviewMessage } from "@core/app/components/store-preview/store-preview-schemas";
import { CheckoutPreviewPage } from "@core/src/features/store-appearance/presentation/checkout-preview-page";
import { announcePreviewReady, listenForPreviewUpdates } from "@core/app/components/store-preview/preview-protocol";

export { middleware } from "@core/app/private-access";
export const headers = () => ({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
export const handle = { colorScheme: () => "fixed" } satisfies ColorSchemeHandle;
export const meta = () => [{ title: "Vista previa de la tienda" }, { name: "robots", content: "noindex, nofollow" }];

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
  return preview.data;
}

export default function StoreAppearancePreview() {
  const { companyName, paymentMethods } = useLoaderData<typeof loader>();
  const [draft, setDraft] = useState<StorePreviewMessage | null>(null);

  useEffect(() => {
    const stop = listenForPreviewUpdates(window, setDraft);
    // Tests and the editor can rely on this: from here on, updates are applied.
    document.documentElement.dataset.storePreview = "ready";
    announcePreviewReady(window);
    return () => { stop(); delete document.documentElement.dataset.storePreview; };
  }, []);

  // The frame paints only the draft the editor sends, so the page stays blank until the first message.
  if (!draft) return null;
  if (draft.surface === "catalog") return <CatalogPreview appearance={draft.appearance} storeName={companyName} catalog={draft.catalog} />;
  return <CheckoutPreviewPage companyName={companyName} appearance={draft.appearance} state={draft.state} paymentMethods={paymentMethods} />;
}
