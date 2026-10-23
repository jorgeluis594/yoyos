import { createContext } from "react-router";
import type { Storefront } from "@core/src/features/catalog/application/resolve-storefront";

/** `error` when the lookup failed on `/carrito`, which answers JSON instead of rendering a page. */
export type StorefrontState = Storefront | Readonly<{ kind: "error" }>;

/** The store the request's brand host resolved to; null on the app host. */
export const storefrontContext = createContext<StorefrontState | null>(null);
