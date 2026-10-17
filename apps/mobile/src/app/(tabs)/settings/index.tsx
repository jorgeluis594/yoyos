import { useRouter } from "expo-router";
import { ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { ThemedText } from "@mobile/components/themed-text";
import { ThemedView } from "@mobile/components/themed-view";
import { ListRow } from "@mobile/components/ui/list-row";

export default function SettingsIndex() {
  const { t } = useTranslation();
  const router = useRouter();
  return <ThemedView style={styles.page}><SafeAreaView style={styles.page} edges={["top", "left", "right"]}>
    <ScrollView contentContainerStyle={styles.content}>
      <ThemedText type="title" accessibilityRole="header" style={styles.title}>{t("deliverySettingsNav")}</ThemedText>
      <ListRow title={t("deliverySettingsTitle")} onPress={() => router.push("/settings/delivery")} />
      <ListRow title={t("catalogSettingsTitle")} description={t("catalogPublish")} onPress={() => router.push("/settings/catalog")} />
    </ScrollView>
  </SafeAreaView></ThemedView>;
}

const styles = StyleSheet.create({ page: { flex: 1 }, content: { paddingVertical: 16, width: "100%", maxWidth: 640, alignSelf: "center" }, title: { paddingHorizontal: 16, paddingBottom: 8 } });
