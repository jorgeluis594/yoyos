import { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { ThemedText } from "@mobile/components/themed-text";
import { Button } from "@mobile/components/ui/button";
import { useTheme } from "@mobile/hooks/use-theme";
import { useNotices } from "@mobile/features/notifications/composition";
import type { CatalogSearchReadinessState } from "@shared/contracts/catalog-search-readiness";

type Hint = Exclude<CatalogSearchReadinessState, "ready">;

const hintTexts = { no_active_products: "catalogHintNoProducts", all_products_hidden: "catalogHintAllHidden", no_searchable_photos: "catalogHintNoSearchablePhotos" } as const;

/**
 * Tells the seller why photos and texts of customers send no notice: the catalog has no active
 * products, all of them are hidden, or none visible has a photo Yoyos can search with yet. Loaded every time the screen is focused.
 */
export function CatalogReadinessHint() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const notices = useNotices();
  const [hint, setHint] = useState<Hint | null>(null);
  const load = notices?.loadCatalogReadiness;

  useFocusEffect(useCallback(() => {
    if (!load) return;
    let active = true;
    void load().then((result) => {
      if (active) setHint(result.success && result.data !== "ready" ? result.data : null);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [load]));

  if (hint === null) return null;
  return (
    <View style={[styles.hint, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText type="small">{t(hintTexts[hint])}</ThemedText>
      <Button variant="secondary" onPress={() => router.push("/products")}>{t("catalogHintGoToProducts")}</Button>
    </View>
  );
}

const styles = StyleSheet.create({ hint: { padding: 12, borderRadius: 8, gap: 12 } });
