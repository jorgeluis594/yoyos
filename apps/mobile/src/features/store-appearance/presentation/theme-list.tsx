import { useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { useTranslation } from "react-i18next";
import { storeThemeIds, storeThemes, type StoreThemeId } from "@shared/store-themes";
import { ThemedText } from "@mobile/components/themed-text";
import { useTheme } from "@mobile/hooks/use-theme";
import { themeSample, type ThemeSample } from "@mobile/features/store-appearance/domain/theme-sample";

const descriptionKey = { classic: "appearanceThemeClassic", boutique: "appearanceThemeBoutique", antojo: "appearanceThemeAntojo", suave: "appearanceThemeSuave", noche: "appearanceThemeNoche" } as const;

/** A static sample with the theme's colors, rounding, button and thumbnail shape; the system font, since the app bundles no theme fonts. */
function Sample({ sample }: Readonly<{ sample: ThemeSample }>) {
  return <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.sample, { backgroundColor: sample.background }]}>
    {sample.gradient ? <View style={StyleSheet.absoluteFill}>{sample.gradient.map((color, index) => <View key={index} style={[styles.band, { backgroundColor: color }]} />)}</View> : null}
    <View style={[styles.card, { backgroundColor: sample.card, borderColor: sample.border, borderWidth: sample.borderWidth, borderRadius: Math.min(sample.cardRadius, 14) }]}>
      <View style={{ width: 24, aspectRatio: sample.thumbnailAspect, borderRadius: Math.min(sample.thumbnailRadius, 12), backgroundColor: sample.thumbnail }} />
      <View style={{ width: 28, height: 10, borderRadius: sample.buttonRadius, backgroundColor: sample.primary }} />
    </View>
  </View>;
}

export function ThemeList({ value, disabled, onChange }: Readonly<{ value: StoreThemeId; disabled: boolean; onChange: (theme: StoreThemeId) => void }>) {
  const { t } = useTranslation();
  const theme = useTheme();
  const samples = useMemo(() => Object.fromEntries(storeThemeIds.map(id => [id, themeSample(storeThemes[id])])), []);
  return <View style={[styles.section, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
    <ThemedText type="subtitle" accessibilityRole="header">{t("appearanceThemeTitle")}</ThemedText>
    <View accessibilityRole="radiogroup" accessibilityLabel={t("appearanceThemeOptions")} style={styles.list}>
      {storeThemeIds.map(id => {
        const selected = id === value;
        const sample = samples[id];
        const description = t(descriptionKey[id]);
        return <Pressable key={id} accessibilityRole="radio" accessibilityLabel={`${storeThemes[id].name}. ${description}`} accessibilityState={{ checked: selected, disabled }}
          disabled={disabled} onPress={() => onChange(id)} style={[styles.option, { borderColor: selected ? theme.primary : theme.border, opacity: disabled ? 0.5 : 1 }]}>
          {sample?.success ? <Sample sample={sample.data} /> : null}
          <View style={styles.copy}><ThemedText type="smallBold">{storeThemes[id].name}</ThemedText><ThemedText type="small" themeColor="textSecondary">{description}</ThemedText></View>
          {selected ? <SymbolView name={{ ios: "checkmark", android: "check" }} size={20} tintColor={theme.primary} /> : null}
        </Pressable>;
      })}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 12, padding: 16, borderWidth: 1, borderRadius: 8 }, list: { gap: 8 },
  option: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: 12, padding: 8, borderWidth: 1, borderRadius: 8 }, copy: { flex: 1, gap: 2 },
  sample: { width: 72, height: 56, borderRadius: 6, overflow: "hidden", alignItems: "center", justifyContent: "center" }, band: { flex: 1 },
  card: { flexDirection: "row", alignItems: "center", gap: 6, padding: 6 },
});
