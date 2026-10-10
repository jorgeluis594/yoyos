import { Stack } from 'expo-router';

/** Tabs hold the primary destinations; product create and edit open above them, full screen. */
export default function RootStack() {
  return <Stack screenOptions={{ headerShown: false }}>
    <Stack.Screen name="(tabs)" />
    <Stack.Screen name="products/new" />
    <Stack.Screen name="products/[productId]" />
  </Stack>;
}
