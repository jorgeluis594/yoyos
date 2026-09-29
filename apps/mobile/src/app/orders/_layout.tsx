import { Stack } from "expo-router";
import { OrderResultProvider } from "@mobile/features/orders/presentation/order-result";

export default function OrdersStack() {
  return <OrderResultProvider><Stack screenOptions={{ headerShown: false }} /></OrderResultProvider>;
}
