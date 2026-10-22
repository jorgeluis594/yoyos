import { CatalogPublicationCard } from "@mobile/features/catalog/presentation/catalog-publication-card";
import { StoreAppearanceScreen } from "@mobile/features/store-appearance/presentation/store-appearance-screen";

export default function StoreAppearanceRoute() {
  return <StoreAppearanceScreen publication={<CatalogPublicationCard />} />;
}
