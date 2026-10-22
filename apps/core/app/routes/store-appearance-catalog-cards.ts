import type { LoaderFunctionArgs } from "react-router";
import { privateUserContext } from "@core/app/private-user-context";
import { bindRequestOperation } from "@core/src/shared/infrastructure/logger";
import { catalogBrowse } from "@core/src/features/catalog/browse-composition";
import { parseCompanyId } from "@core/src/features/store-appearance/domain/store-appearance";
import type { CatalogPreviewCards } from "@core/app/components/store-preview/store-preview-schemas";

export { middleware } from "@core/app/private-access";
const noStore = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
export const headers = () => noStore;

/** The seller's first catalog cards for the editor preview. The publication is not checked: a hidden catalog is previewed too. */
export async function loader({ context }: LoaderFunctionArgs) {
  bindRequestOperation({ operation: "get_catalog_preview_cards" });
  const { company } = context.get(privateUserContext);
  const companyId = parseCompanyId(company.id);
  const cards = companyId.success ? await catalogBrowse.previewCards({ companyId: companyId.data }) : companyId;
  if (!cards.success) {
    bindRequestOperation({ outcome: "technical_failure" });
    throw new Response("Preview unavailable", { status: 503, headers: noStore });
  }
  bindRequestOperation({ outcome: "loaded" });
  // An empty list means «show samples».
  const [first, ...rest] = cards.data;
  const body: CatalogPreviewCards = first ? { kind: "products", cards: [first, ...rest].map((card) => ({ ...card, id: String(card.id) })) } : { kind: "samples" };
  return Response.json(body, { headers: noStore });
}
