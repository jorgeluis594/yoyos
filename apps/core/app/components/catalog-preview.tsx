import { useTranslation } from "react-i18next";
import { CatalogCartButtonFace } from "@core/app/components/catalog-cart";
import { CatalogGrid, CatalogProductCard, CatalogSearchField, CatalogShell, ProductGridSkeleton } from "@core/app/components/catalog-sections";
import type { StorePreviewMessage } from "@core/app/components/store-preview/store-preview-schemas";
import { sampleCatalogCards } from "@core/src/features/store-appearance/presentation/preview-fixtures";
import { previewCardCount } from "@core/src/features/catalog/application/preview-catalog-cards";
import type { PublicStoreAppearance } from "@core/src/features/store-appearance/presentation/store-appearance-schemas";

export type CatalogPreviewProps = Readonly<{
  appearance: PublicStoreAppearance;
  storeName: string;
  catalog: StorePreviewMessage["catalog"];
}>;

/**
 * A short version of the buyer catalog built with its own components: header, search, up to three cards and the cart button.
 * It is inert and hidden from screen readers, because the editor announces the label of the view.
 */
export function CatalogPreview({ appearance, storeName, catalog }: CatalogPreviewProps) {
  const { t } = useTranslation();
  const cards = catalog.kind === "products" ? catalog.cards : catalog.kind === "samples" ? sampleCatalogCards : null;
  // The cart button stands for one unit of the first card that can be added, as the real button does with one line in the cart.
  const units = cards?.some((card) => !card.soldOut) ? 1 : 0;
  return <div aria-hidden="true" inert data-slot="catalog-preview">
    <CatalogShell appearance={appearance} storeName={storeName} linkHome={false} cart={<CatalogCartButtonFace units={units} tabIndex={-1} />}>
      <div><CatalogSearchField value="" readOnly tabIndex={-1} /></div>
      {cards
        ? <CatalogGrid>{cards.map((card) => <li key={card.id}><CatalogProductCard item={card} /></li>)}</CatalogGrid>
        : <>
          <ProductGridSkeleton count={previewCardCount} />
          <p className="text-center text-sm text-muted-foreground">{t("storePreview.loading")}</p>
        </>}
    </CatalogShell>
  </div>;
}
