import { createContext, RouterContextProvider } from "react-router";
import type { ResolveDeliveryDependencies } from "@core/src/features/orders/application/resolve-delivery-selection";

export const deliveryCostContext = createContext<ResolveDeliveryDependencies["resolveShippingCost"] | null>(null);

export function createDeliveryRequestContext(resolveShippingCost?: ResolveDeliveryDependencies["resolveShippingCost"]) {
  const context = new RouterContextProvider();
  if (resolveShippingCost) context.set(deliveryCostContext, resolveShippingCost);
  return context;
}
