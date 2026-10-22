import { catalogPreviewCardsSchema, type CatalogPreviewCards } from "@core/app/components/store-preview/store-preview-schemas";

const samples: CatalogPreviewCards = { kind: "samples" };
/** The private-access middleware completes the locale of this path, as it does for the preview page. */
export const catalogCardsPath = "/settings/store-appearance/catalog-cards";

/** A plain fetch, never a router fetcher: it is not revalidated after saves, and its failures never reach the editor's error boundary. Any failure is «show samples». */
export async function fetchCatalogPreviewCards(signal: AbortSignal): Promise<CatalogPreviewCards> {
  try {
    const response = await fetch(catalogCardsPath, { signal, headers: { Accept: "application/json" }, credentials: "same-origin" });
    if (!response.ok) return samples;
    const parsed = catalogPreviewCardsSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : samples;
  } catch {
    return samples;
  }
}
