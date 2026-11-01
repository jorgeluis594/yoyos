import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { OrderReviewResponse } from "@shared/contracts/order-review";
import { ThemedText } from "@mobile/components/themed-text";
import { QuestionBox } from "@mobile/components/ui/question-box";
import { attributeText, pointDoubtText } from "@mobile/features/orders/presentation/order-review-model";
import { useTheme } from "@mobile/hooks/use-theme";

type Point = OrderReviewResponse["points"][number];

/** «Falta la variante: Polo básico ×2 — falta la talla. Pregúntale al cliente o agrégalo desde la web.» */
export function usePointText(money: (amount: number) => string) {
  const { t } = useTranslation();
  return (point: Point) => {
    const head = point.product ? t(`orderReview.points.named.${point.kind}`, { product: point.product, quantity: point.quantity }) : t(`orderReview.points.unnamed.${point.kind}`, { quantity: point.quantity });
    const missing = point.product && point.missing.length ? ` — ${t("orderReview.points.missing", { missing: point.missing.map((name) => attributeText(name, t)).join(` ${t("orderReview.points.or")} `) })}` : "";
    return { text: `${head}${missing}. ${t("orderReview.points.todo")}`, doubt: point.doubt ? pointDoubtText(point.doubt, { t, money: (amount) => money(amount) }) : null };
  };
}

/** The «Por resolver» points of an order, each with the suggested question and **Copiar pregunta**. They are informative: they never block a review. */
export function ReviewPoints({ points, money }: Readonly<{ points: readonly Point[]; money: (amount: number) => string }>) {
  const { t } = useTranslation();
  const theme = useTheme();
  const describe = usePointText(money);
  if (points.length === 0) return null;
  return <View style={styles.list}>
    <ThemedText type="subtitle" accessibilityRole="header">{t("orderReview.sectionPoints")}</ThemedText>
    {points.map((point) => {
      const { text, doubt } = describe(point);
      return <View key={`${point.pendingId}:${point.since}`} style={[styles.point, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
        <View accessible accessibilityLabel={[text, doubt].filter(Boolean).join(". ")} style={styles.text}>
          <ThemedText>{text}</ThemedText>
          {doubt ? <ThemedText type="small" style={{ color: theme.warning }}>{doubt}</ThemedText> : null}
        </View>
        <QuestionBox point={{ id: point.pendingId, text: point.question, about: point.product ?? "" }} />
      </View>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  list: { gap: 8 },
  point: { gap: 8, paddingVertical: 12, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth },
  text: { gap: 4, paddingHorizontal: 12 },
});
