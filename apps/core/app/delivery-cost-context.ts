import { createContext, RouterContextProvider } from "react-router";
import type { ResolveDeliveryDependencies } from "@core/src/features/orders/application/resolve-delivery-selection";

export const deliveryCostContext = createContext<ResolveDeliveryDependencies["resolveCost"] | null>(null);

export function createDeliveryRequestContext(resolveCost?: ResolveDeliveryDependencies["resolveCost"]) {
  const context = new RouterContextProvider();
  if (resolveCost) context.set(deliveryCostContext, resolveCost);
  return context;
}
