import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import type { OrderResponse } from "@shared/contracts/orders";
import { orders } from "@mobile/features/orders/composition";
import { ThemedText } from "@mobile/components/themed-text";
import { ThemedView } from "@mobile/components/themed-view";
import { Button } from "@mobile/components/ui/button";
import { Input } from "@mobile/components/ui/input";
import { ListRow } from "@mobile/components/ui/list-row";
import { ScreenState } from "@mobile/components/ui/screen-state";
import { useAccess } from "@mobile/features/users/presentation/access-provider";
import { useOrderResult } from "@mobile/features/orders/presentation/order-result";
import { OrderDayField } from "@mobile/features/orders/presentation/order-day-field";
import { useTheme } from "@mobile/hooks/use-theme";
import type { OrderListCriteria } from "@mobile/features/orders/application/order-operations";

type Summary = Pick<OrderResponse, "id" | "customer" | "completedAt" | "currency" | "total">;
const money = (amount: number, currency: string) => new Intl.NumberFormat("es-PE", { style: "currency", currency }).format(amount);
const limaDate = (value: string) => new Intl.DateTimeFormat("es-PE", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Lima" }).format(new Date(value));

export default function OrderHistoryScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { state } = useAccess();
  const { show } = useOrderResult();
  const [criteria, setCriteria] = useState<OrderListCriteria>({ page: 1, customer: { kind: "all" } });
  const [fromDay, setFromDay] = useState("");
  const [throughDay, setThroughDay] = useState("");
  const [customerKind, setCustomerKind] = useState<"all" | "general_public" | "contact">("all");
  const [contactSearch, setContactSearch] = useState("");
  const [contactId, setContactId] = useState("");
  const [contacts, setContacts] = useState<{ id: string; name: string | null; phone: string }[]>([]);
  const [items, setItems] = useState<Summary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pendingState, setPendingState] = useState<"none" | "pending" | "error">("none");
  const [verifyMessage, setVerifyMessage] = useState("");
  const [verifying, setVerifying] = useState(false);
  const activeRequest = useRef(0);
  const companyId = state.status === "ready" ? state.company.id : "";

  const reload = useCallback(async (company: string, filters: OrderListCriteria) => {
    const request = ++activeRequest.current;
    setLoading(true);
    const [list, pending] = await Promise.all([orders.loadOrders(filters), orders.readPendingOrderConfirmation(company)]);
    if (request !== activeRequest.current) return;
    if (list.success) { setItems(list.data.items); setTotal(list.data.total); setError(""); }
    else setError(list.error.code === "INVALID_INPUT" ? "Revisa las fechas y el cliente del filtro." : "No se pudieron cargar las ventas.");
    setPendingState(!pending.success ? "error" : pending.data ? "pending" : "none");
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => {
    if (companyId) void reload(companyId, criteria);
    return () => { activeRequest.current += 1; };
  }, [companyId, criteria, reload]));

  useEffect(() => {
    if (!companyId || customerKind !== "contact") return;
    let active = true;
    const timer = setTimeout(() => {
      void orders.searchOrderContacts(contactSearch.trim()).then((result) => {
        if (active) setContacts(result.success ? result.data : []);
      });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [companyId, customerKind, contactSearch]);

  if (state.status !== "ready") return null;

  const apply = () => {
    if (customerKind === "contact" && !contactId) { setError("Elige un contacto para filtrar."); return; }
    setCriteria({ page: 1, customer: customerKind === "contact" ? { kind: "contact", contactId } : { kind: customerKind },
      ...(fromDay ? { fromDay } : {}), ...(throughDay ? { throughDay } : {}) });
  };
  const verify = async () => {
    if (verifying) return;
    setVerifying(true);
    const result = await orders.resolvePendingOrderConfirmation(companyId);
    setVerifying(false);
    if (!result.success) { setVerifyMessage("No se pudo verificar la venta. Inténtalo otra vez."); return; }
    if (!result.data) { setPendingState("none"); setVerifyMessage(""); return; }
    if (result.data.kind === "uncertain") { setVerifyMessage("La venta aún no aparece. Verifica otra vez antes de reconstruirla."); return; }
    show({ id: result.data.order.id, shownTotal: result.data.shownTotal });
    router.push(`/orders/${result.data.order.id}`);
  };

  const header = <View style={styles.header}>
    <View style={styles.heading}><ThemedText type="title" accessibilityRole="header">Ventas</ThemedText><ThemedText themeColor="textSecondary">{state.company.name}</ThemedText></View>
    {pendingState !== "none" ? <View style={[styles.notice, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText type="smallBold">{pendingState === "error" ? "No se pudo leer la venta pendiente" : "Hay una venta por verificar"}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{pendingState === "error" ? "Reintenta antes de iniciar otra venta." : "Comprueba el resultado antes de registrar otra venta."}</ThemedText>
      <Button variant="secondary" loading={verifying} onPress={() => pendingState === "error" ? void reload(companyId, criteria) : void verify()}>{pendingState === "error" ? "Reintentar" : "Verificar venta"}</Button>
      {verifyMessage ? <ThemedText type="small" accessibilityRole="alert">{verifyMessage}</ThemedText> : null}
    </View> : null}
    <Button onPress={() => router.push("/orders/new")}>Nueva venta</Button>
    <View style={styles.filters}>
      <ThemedText type="subtitle" accessibilityRole="header">Filtrar ventas</ThemedText>
      <View style={styles.row}>
        <Button variant={customerKind === "all" ? "default" : "secondary"} onPress={() => { setCustomerKind("all"); setContactId(""); }}>Todos</Button>
        <Button variant={customerKind === "general_public" ? "default" : "secondary"} onPress={() => { setCustomerKind("general_public"); setContactId(""); }}>Público general</Button>
        <Button variant={customerKind === "contact" ? "default" : "secondary"} onPress={() => setCustomerKind("contact")}>Contacto</Button>
      </View>
      {customerKind === "contact" ? <View style={styles.field}>
        <Input value={contactSearch} onChangeText={(value) => { setContactSearch(value); setContactId(""); }} accessibilityLabel="Buscar contacto" placeholder="Nombre o teléfono" />
        {contactId ? <ThemedText type="small">Contacto seleccionado</ThemedText> : contacts.map((contact) =>
          <ListRow key={contact.id} title={contact.name ?? contact.phone} description={contact.name ? contact.phone : undefined}
            onPress={() => { setContactId(contact.id); setContactSearch(contact.name ?? contact.phone); }} />)}
      </View> : null}
      <View style={styles.row}>
        <View style={styles.date}><OrderDayField label="Desde" value={fromDay} onChange={setFromDay} /></View>
        <View style={styles.date}><OrderDayField label="Hasta" value={throughDay} onChange={setThroughDay} /></View>
      </View>
      <Button variant="secondary" onPress={apply}>Aplicar filtros</Button>
    </View>
    {!loading && !error && items.length ? <ThemedText type="small" themeColor="textSecondary">{total} {total === 1 ? "venta" : "ventas"}</ThemedText> : null}
  </View>;

  return <ThemedView style={styles.page}><SafeAreaView style={styles.page} edges={["top", "left", "right"]}>
    {loading ? <ScrollView contentContainerStyle={styles.content}>{header}<ScreenState status="loading" title="Cargando ventas" /></ScrollView>
      : error ? <ScrollView contentContainerStyle={styles.content}>{header}<ScreenState status="error" title="No se pudieron cargar las ventas" description={error} onRetry={() => void reload(companyId, criteria)} /></ScrollView>
      : <FlatList data={items} keyExtractor={(item) => item.id} contentContainerStyle={styles.content}
          ListHeaderComponent={header}
          ListEmptyComponent={<ScreenState status={criteria.page === 1 && criteria.customer.kind === "all" && !criteria.fromDay && !criteria.throughDay ? "empty" : "no-results"}
            title={criteria.page === 1 && criteria.customer.kind === "all" && !criteria.fromDay && !criteria.throughDay ? "Aún no hay ventas" : "Sin resultados"}
            description="Prueba otros filtros o registra una venta nueva." />}
          renderItem={({ item }) => <ListRow title={item.customer.kind === "contact" ? item.customer.name ?? item.customer.phone : "Público general"}
            description={limaDate(item.completedAt)} trailing={<ThemedText type="smallBold">{money(item.total, item.currency)}</ThemedText>}
            onPress={() => router.push(`/orders/${item.id}`)} />}
          ListFooterComponent={items.length ? <View style={styles.row}>
            {criteria.page > 1 ? <Button variant="secondary" onPress={() => setCriteria({ ...criteria, page: criteria.page - 1 })}>Anterior</Button> : null}
            {criteria.page * 20 < total ? <Button variant="secondary" onPress={() => setCriteria({ ...criteria, page: criteria.page + 1 })}>Siguiente</Button> : null}
          </View> : null} />}
  </SafeAreaView></ThemedView>;
}

const styles = StyleSheet.create({
  page: { flex: 1 }, content: { gap: 12, padding: 16, paddingBottom: 32, width: "100%", maxWidth: 640, alignSelf: "center" },
  header: { gap: 16 }, heading: { gap: 4, paddingTop: 8 }, filters: { gap: 12 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  field: { gap: 8 }, date: { flex: 1, minWidth: 130, gap: 4 }, notice: { gap: 8, padding: 16, borderRadius: 8 },
});
