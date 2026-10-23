import { useLocalSearchParams } from "expo-router";
import { CatalogPublicationCard } from "@mobile/features/catalog/presentation/catalog-publication-card";
import { StoreAppearanceScreen } from "@mobile/features/store-appearance/presentation/store-appearance-screen";

export default function StoreAppearanceRoute() {
  const { focus } = useLocalSearchParams<{ focus?: string }>();
  return <StoreAppearanceScreen focus={focus} publication={CatalogPublicationCard} />;
}
