import { Stack } from "expo-router";
import { ProductEditorProvider } from "@/features/products/presentation/product-editor-state";

/** Create and edit share one editor draft, so the product screen and the screens above it see the same changes. */
export default function ProductEditorStack() {
  return <ProductEditorProvider><Stack screenOptions={{ headerShown: false }} /></ProductEditorProvider>;
}
