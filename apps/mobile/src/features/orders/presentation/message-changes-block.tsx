import { StyleSheet, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { useTranslation } from "react-i18next";
import type { OrderReviewResponse } from "@shared/contracts/order-review";
import { ThemedText } from "@mobile/components/themed-text";
import { Button } from "@mobile/components/ui/button";
import { messageRowSummary, rowTimeLabel, undoRefusalText } from "@mobile/features/orders/presentation/order-review-model";
import { useTheme } from "@mobile/hooks/use-theme";

type Row = OrderReviewResponse["messageRows"][number];

type Props = Readonly<{
  rows: readonly Row[];
  moreRows: number;
  locale: string;
  /** Why **Deshacer** is disabled right now (unsaved edits), or null. */
  disabledReason: string | null;
  busy: boolean;
  onUndo: (row: Row) => void;
  onMore: () => void;
  loadingMore: boolean;
}>;

/** «Cambios por mensajes»: one row per message that changed the order, newest first, with **Deshacer** or the reason it is not offered. */
export function MessageChangesBlock({ rows, moreRows, locale, disabledReason, busy, onUndo, onMore, loadingMore }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  if (rows.length === 0) return null;
  const now = new Date();
  return <View style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
    <ThemedText type="subtitle" accessibilityRole="header">{t("orderReview.changes")}</ThemedText>
    {rows.map((row, index) => {
      const time = rowTimeLabel(row.at, now, locale);
      const summary = messageRowSummary(row.changes, t);
      return <View key={row.messageId} style={[styles.row, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.border }]}>
        <ThemedText>{`${time} · ${summary}`}</ThemedText>
        {row.undo.kind === "available" ? <Button variant="secondary" disabled={busy || disabledReason !== null}
          accessibilityLabel={t("orderReview.undoOf", { time, summary })} accessibilityHint={disabledReason ?? undefined} onPress={() => onUndo(row)}>{t("orderReview.undo")}</Button> : null}
        {row.undo.kind === "refused" ? <ThemedText type="small" themeColor="textSecondary">{undoRefusalText(row.undo.reason, row.changes, t)}</ThemedText> : null}
        {row.undo.kind === "undone" ? <View style={styles.undone}>
          <SymbolView name={{ ios: "arrow.uturn.backward", android: "undo" }} size={16} tintColor={theme.textSecondary} />
          <ThemedText type="small" themeColor="textSecondary">{t("orderReview.undone")}</ThemedText>
        </View> : null}
      </View>;
    })}
    {moreRows > 0 ? <Button variant="ghost" loading={loadingMore} onPress={onMore}>{t("orderReview.more")}</Button> : null}
  </View>;
}

const styles = StyleSheet.create({
  card: { gap: 8, padding: 16, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth },
  row: { gap: 8, paddingVertical: 10 },
  undone: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44 },
});
