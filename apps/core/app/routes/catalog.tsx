import { useEffect, useState } from "react";
import { data, isRouteErrorResponse, Link, useLoaderData, useLocation, useNavigation, useParams, useSubmit, type LoaderFunctionArgs, type MetaArgs } from "react-router";
import { catalogBrowse } from "@core/src/features/catalog/browse-composition";
import { catalogPathSchema, parseCatalogQuery } from "@core/src/features/catalog/presentation/browse-schemas";
import { bindRequestOperation } from "@core/src/shared/infrastructure/logger";
import type { ColorSchemeHandle } from "@core/app/color-scheme";
import { CatalogLoadError, CatalogMessage, CatalogProductCard, CatalogShell, catalogHeaders, catalogMeta } from "@core/app/components/catalog-sections";
import { CatalogCartButton } from "@core/app/components/catalog-cart";
import { Button } from "@core/app/components/ui/button";
import { Input } from "@core/app/components/ui/input";
import { Skeleton } from "@core/app/components/ui/skeleton";

const unavailableTitle = "Catálogo no disponible";
export const headers = () => catalogHeaders;
/** A published store renders its fixed theme; «Catálogo no disponible» and the load error (the loader threw) follow the buyer's system preference. */
export const handle = { colorScheme: (page: unknown) => (page as { storeName?: string } | undefined)?.storeName ? "fixed" : "system" } satisfies ColorSchemeHandle;
export const meta = ({ data: page }: MetaArgs<typeof loader>) => catalogMeta(page?.storeName ?? unavailableTitle);

export async function loader({ params, request }: LoaderFunctionArgs) {
  bindRequestOperation({ operation: "browse_catalog" });
  const path = catalogPathSchema.safeParse(params);
  if (!path.success) throw data(null, { status: 404, headers: catalogHeaders });
  const query = parseCatalogQuery(new URL(request.url).searchParams);
  // Appearance never fails and is only returned on success, so it can load alongside the products.
  const look = catalogBrowse.storeAppearance(path.data.companyId);
  const result = await catalogBrowse.browse({ search: query.search, pages: query.pages }, path.data);
  if (!result.success) {
    const missing = result.error.code === "CATALOG_UNAVAILABLE";
    bindRequestOperation({ outcome: missing ? "unavailable" : "technical_failure" });
    throw data(null, { status: missing ? 404 : 503, headers: catalogHeaders });
  }
  const { kind, appearance } = await look;
  bindRequestOperation({ storeAppearance: kind, storeTheme: appearance.theme });
  return data({ ...result.data, appearance, q: query.q, pages: query.pages }, { headers: catalogHeaders });
}

const searchTerm = (value: string) => (value.trim().length >= 2 ? value.trim() : "");

export default function Catalog() {
  const { storeName, appearance, items, hasMore, q, pages } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const location = useLocation();
  const submit = useSubmit();
  const { companyId = "" } = useParams();
  const [text, setText] = useState(q);
  const active = searchTerm(q);
  useEffect(() => {
    const term = searchTerm(text);
    if (term === active) return;
    const timer = setTimeout(() => submit(term ? { q: term } : {}, { method: "get", replace: true, preventScrollReset: true }), 300);
    return () => clearTimeout(timer);
  }, [text, active, submit]);
  const pending = navigation.state === "loading" && navigation.location.pathname === location.pathname ? navigation.location : null;
  const searching = pending !== null && (new URLSearchParams(pending.search).get("q") ?? "") !== active;
  const more = new URLSearchParams({ ...(active ? { q: active } : {}), page: String(pages + 1) });

  return <CatalogShell appearance={appearance} storeName={storeName} cart={<CatalogCartButton companyId={companyId} />}>
    <form role="search" onSubmit={(event) => event.preventDefault()}>
      <Input data-store-part="catalog-search" type="search" name="q" value={text} maxLength={80} onChange={(event) => setText(event.target.value)}
        placeholder="Buscar productos" aria-label="Buscar productos" autoComplete="off" />
    </form>
    {searching ? <ProductGridSkeleton /> : items.length ? <>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-5 lg:grid-cols-4 lg:gap-x-5">
        {items.map((item) => <li key={item.id}><CatalogProductCard item={item} to={`productos/${item.id}`} /></li>)}
      </ul>
      {hasMore && <Button data-store-part="catalog-more" asChild={!pending} variant="outline" className="self-center" disabled={pending !== null}>
        {pending ? <span>Cargando…</span> : <Link to={`?${more}`} replace preventScrollReset>Ver más</Link>}
      </Button>}
    </> : active ? <div data-store-part="catalog-empty" className="flex flex-col items-center gap-3 py-12 text-center">
      <p>{`No encontramos productos con "${active}"`}</p>
      <Button variant="outline" onClick={() => setText("")}>Borrar búsqueda</Button>
    </div> : <p data-store-part="catalog-empty" className="py-12 text-center text-muted-foreground">Esta tienda todavía no tiene productos publicados</p>}
  </CatalogShell>;
}

function ProductGridSkeleton() {
  return <ul className="grid grid-cols-2 gap-x-3 gap-y-5 lg:grid-cols-4 lg:gap-x-5" aria-busy="true" aria-label="Cargando productos">
    {Array.from({ length: 8 }, (_, index) => <li key={index} className="flex flex-col gap-2">
      <Skeleton className="aspect-square w-full" /><Skeleton className="h-4 w-3/4" /><Skeleton className="h-4 w-1/3" />
    </li>)}
  </ul>;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  if (isRouteErrorResponse(error) && error.status === 404) return <CatalogMessage title={unavailableTitle} />;
  return <CatalogLoadError />;
}
