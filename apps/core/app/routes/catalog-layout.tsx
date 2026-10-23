import { Outlet, redirect, type MiddlewareFunction } from "react-router";
import { documentPath } from "@core/app/middleware/storefront";
import { storefrontContext } from "@core/app/storefront-context";

/** The storefront paths belong to brand hosts: the app host keeps its `/` redirect to the localized home and answers 404 elsewhere. */
export const middleware: MiddlewareFunction<Response>[] = [async ({ request, context }, next) => {
  if (context.get(storefrontContext) !== null) return next();
  const url = new URL(request.url);
  if (documentPath(url.pathname) === "/") throw redirect(`/es-PE/${url.search}`, 308);
  throw new Response(null, { status: 404 });
}];

export default function CatalogLayout() {
  return <Outlet />;
}
