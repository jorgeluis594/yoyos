import { localizedPath } from "@core/app/locale";
import { catalogPreviewCardsSchema, type CatalogPreviewCards } from "@core/app/components/store-preview/store-preview-schemas";

const samples: CatalogPreviewCards = { kind: "samples" };
/** Without a locale prefix the private-access middleware redirects to the company's one, so the fetch keeps the editor's own prefix. */
export const catalogCardsPath = "/settings/store-appearance/catalog-cards";

/** A plain fetch, never a router fetcher: it is not revalidated after saves, and its failures never reach the editor's error boundary. Any failure is «show samples». */
export async function fetchCatalogPreviewCards(signal: AbortSignal): Promise<CatalogPreviewCards> {
  try {
    const response = await fetch(localizedPath(window.location.pathname, catalogCardsPath), { signal, headers: { Accept: "application/json" }, credentials: "same-origin" });
    if (!response.ok) return samples;
    const parsed = catalogPreviewCardsSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : samples;
  } catch {
    return samples;
  }
}
