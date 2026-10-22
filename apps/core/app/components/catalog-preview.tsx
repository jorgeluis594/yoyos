import { CatalogCartButtonFace } from "@core/app/components/catalog-cart";
import { CatalogProductCard, CatalogShell } from "@core/app/components/catalog-sections";
import type { StorePreviewMessage } from "@core/app/components/store-preview/store-preview-schemas";
import { Input } from "@core/app/components/ui/input";
import { Skeleton } from "@core/app/components/ui/skeleton";
import { sampleCatalogCards } from "@core/src/features/store-appearance/presentation/preview-fixtures";
import { previewCardCount } from "@core/src/features/catalog/application/preview-catalog-cards";
import type { PublicStoreAppearance } from "@core/src/features/store-appearance/presentation/store-appearance-schemas";

export type CatalogPreviewProps = Readonly<{
  appearance: PublicStoreAppearance;
  storeName: string;
  catalog: StorePreviewMessage["catalog"];
}>;

const grid = "grid grid-cols-2 gap-x-3 gap-y-5 lg:grid-cols-4 lg:gap-x-5";

/**
 * A short version of the buyer catalog built with its own components: header, search, up to three cards and the cart button.
 * It is inert and hidden from screen readers, because the editor announces the label of the view.
 */
export function CatalogPreview({ appearance, storeName, catalog }: CatalogPreviewProps) {
  const cards = catalog.kind === "products" ? catalog.cards : catalog.kind === "samples" ? sampleCatalogCards : null;
  // The cart button stands for one unit of the first card that can be added, as the real button does with one line in the cart.
  const units = cards?.some((card) => !card.soldOut) ? 1 : 0;
  return <div aria-hidden="true" inert data-slot="catalog-preview">
    <CatalogShell appearance={appearance} storeName={storeName} cart={<CatalogCartButtonFace units={units} tabIndex={-1} />}>
      <div role="presentation">
        <Input data-store-part="catalog-search" type="search" readOnly tabIndex={-1} placeholder="Buscar productos" autoComplete="off" />
      </div>
      {cards
        ? <ul className={grid}>{cards.map((card) => <li key={card.id}><CatalogProductCard item={card} /></li>)}</ul>
        : <>
          <ul className={grid} aria-busy="true">
            {Array.from({ length: previewCardCount }, (_, index) => <li key={index} data-slot="card-placeholder" className="flex flex-col gap-2">
              <Skeleton className="aspect-square w-full" /><Skeleton className="h-4 w-3/4" /><Skeleton className="h-4 w-1/3" />
            </li>)}
          </ul>
          <p className="text-center text-sm text-muted-foreground">Cargando productos</p>
        </>}
    </CatalogShell>
  </div>;
}
