import { useCallback, useRef, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { subtract } from "@shared/money";
import type { OrderResponse } from "@shared/contracts/orders";
import { orders } from "@mobile/features/orders/composition";
import { ThemedText } from "@mobile/components/themed-text";
import { ThemedView } from "@mobile/components/themed-view";
import { Button } from "@mobile/components/ui/button";
import { ScreenState } from "@mobile/components/ui/screen-state";
import { useAccess } from "@mobile/features/users/presentation/access-provider";
import { useOrderResult } from "@mobile/features/orders/presentation/order-result";
import { useTheme } from "@mobile/hooks/use-theme";

const money = (amount: number, currency: string) => new Intl.NumberFormat("es-PE", { style: "currency", currency }).format(amount);
const date = (value: string) => new Intl.DateTimeFormat("es-PE", { dateStyle: "long", timeStyle: "short", timeZone: "America/Lima" }).format(new Date(value));

export default function OrderDetailScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state } = useAccess();
  const { notice, clear } = useOrderResult();
  const [order, setOrder] = useState<OrderResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const loaded = useRef(false);
  const companyId = state.status === "ready" ? state.company.id : "";
  const reload = useCallback(async () => {
    setLoading(true);
    const result = await orders.loadOrder(id);
    if (result.success) { setOrder(result.data); setError(""); loaded.current = true; }
    else setError(result.error.code === "ORDER_NOT_FOUND" ? "Esta venta no existe o no está disponible para tu empresa." : "No se pudo cargar la venta.");
    setLoading(false);
  }, [id]);
  useFocusEffect(useCallback(() => {
    if (companyId) void reload();
    return () => {
      if (notice?.id === id && loaded.current) { void orders.clearPendingOrderConfirmation(companyId ?? "", id); clear(); }
    };
  }, [companyId, id, notice, clear, reload]));

  if (state.status !== "ready") return null;
  if (loading) return <ScreenState status="loading" title="Cargando venta" />;
  if (!order) return <ScreenState status="error" title="No se pudo abrir la venta" description={error} onRetry={() => void reload()} />;

  const original = notice?.id === order.id ? notice.shownTotal : null;
  const difference = original?.currency === order.currency
    ? subtract(original)({ amount: order.total, currency: order.currency }) : null;
  const changed = original && (original.currency !== order.currency || original.amount !== order.total);
  return <ThemedView style={styles.page}><SafeAreaView style={styles.page} edges={["top", "left", "right"]}>
    <ScrollView contentContainerStyle={styles.content}>
      <Button variant="ghost" onPress={() => router.back()}>Volver a ventas</Button>
      <View style={styles.heading}><ThemedText type="title" accessibilityRole="header">Venta completada</ThemedText>
        <ThemedText themeColor="textSecondary">{date(order.completedAt)}</ThemedText></View>
      <View style={[styles.summary, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="small" themeColor="textSecondary">Total registrado</ThemedText>
        <ThemedText type="title">{money(order.total, order.currency)}</ThemedText>
        <ThemedText type="small">Cobrado por billetera digital · Entregado</ThemedText>
      </View>
      {changed && original ? <View style={[styles.notice, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="subtitle" accessibilityRole="header">Revisa el importe cobrado</ThemedText>
        <ThemedText>Mostrado al confirmar: {money(original.amount, original.currency)}</ThemedText>
        <ThemedText>Total registrado: {money(order.total, order.currency)}</ThemedText>
        {difference?.success ? <ThemedText>Diferencia: {money(difference.data.amount, order.currency)}</ThemedText> : null}
        <ThemedText type="small">Ajusta el cobro fuera de la app.</ThemedText>
      </View> : null}
      <View style={styles.section}><ThemedText type="subtitle" accessibilityRole="header">Cliente</ThemedText>
        <ThemedText>{order.customer.kind === "contact" ? order.customer.name ?? order.customer.phone : "Público general"}</ThemedText>
        {order.customer.kind === "contact" && order.customer.name ? <ThemedText themeColor="textSecondary">{order.customer.phone}</ThemedText> : null}
      </View>
      <View style={styles.section}><ThemedText type="subtitle" accessibilityRole="header">Artículos</ThemedText>
        {order.items.map((item) => <View key={item.id} style={styles.item}>
          <ThemedText type="smallBold">{item.productName}</ThemedText>
          {Object.entries(item.variantAttributes).length ? <ThemedText type="small" themeColor="textSecondary">{Object.entries(item.variantAttributes).map(([key, value]) => `${key}: ${value}`).join(" · ")}</ThemedText> : null}
          {item.sku ? <ThemedText type="small" themeColor="textSecondary">SKU {item.sku}</ThemedText> : null}
          <ThemedText>{item.quantity} × {money(item.unitPrice, order.currency)} = {money(item.subtotal, order.currency)}</ThemedText>
        </View>)}
      </View>
    </ScrollView>
  </SafeAreaView></ThemedView>;
}

const styles = StyleSheet.create({ page: { flex: 1 }, content: { gap: 24, padding: 16, paddingBottom: 32, maxWidth: 640, width: "100%", alignSelf: "center" },
  heading: { gap: 4 }, summary: { gap: 8, padding: 16 }, notice: { gap: 8, padding: 16 }, section: { gap: 12 }, item: { gap: 4, paddingVertical: 12 } });
