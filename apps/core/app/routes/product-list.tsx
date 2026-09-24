import { Form, isRouteErrorResponse, Link, useLoaderData, useNavigation, type LoaderFunctionArgs } from "react-router";
import { Button } from "@/components/ui/button";
import { privateUserContext } from "@/private-user-context";
import { products } from "@core/src/features/products/composition";
import type { CompanyId } from "@core/src/features/products/domain/product";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const company = context.get(privateUserContext).company;
  const query = new URL(request.url).searchParams;
  const numberParam = (key: string) => { const value = query.get(key); return value && /^[1-9]\d*$/.test(value) ? Number(value) : NaN; };
  const input = {
    ...(query.has("search") ? { search: query.get("search")! } : {}),
    ...(query.has("page") ? { page: numberParam("page") } : {}),
    ...(query.has("pageSize") ? { pageSize: numberParam("pageSize") } : {}),
  };
  try {
    const result = await products.list(company.id as CompanyId, input);
    if (!result.success) throw new Response("Criterios de búsqueda no válidos.", { status: 400 });
    return { list: result.data, search: input.search?.trim() ?? "", base: `/es-${company.country}/products` };
  } catch (cause) {
    if (cause instanceof Response) throw cause;
    console.error("Unable to list products", cause);
    throw new Response("No se pudo cargar el catálogo.", { status: 503 });
  }
}

export default function ProductList() {
  const { list, search, base } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const pages = Math.ceil(list.total / list.pageSize);
  const pageUrl = (page: number) => `${base}?${new URLSearchParams({ ...(search ? { search } : {}), page: String(page), ...(list.pageSize === 20 ? {} : { pageSize: String(list.pageSize) }) })}`;

  return <section aria-busy={navigation.state === "loading"}>
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="text-2xl font-semibold tracking-tight">Productos</h1><p className="mt-2 text-sm text-muted-foreground">{list.total} productos</p></div>
      <Button asChild><Link to={`${base}/new`}>Nuevo producto</Link></Button>
    </div>
    <Form method="get" role="search" className="mt-6 flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1"><label htmlFor="product-search" className="mb-1.5 block text-sm font-medium">Buscar por nombre o SKU</label>
        <input id="product-search" name="search" type="search" defaultValue={search} className="min-h-control w-full rounded-md border border-input bg-background px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring" /></div>
      <Button type="submit">Buscar</Button>
    </Form>
    {list.items.length ? <div className="mt-6 overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[38rem] text-left text-sm">
        <thead className="bg-muted text-muted-foreground"><tr><th scope="col" className="p-3">Nombre</th><th scope="col" className="p-3">SKU</th><th scope="col" className="p-3">Precio de venta</th><th scope="col" className="p-3">Stock</th></tr></thead>
        <tbody>{list.items.map((item) => <tr key={item.id} className="border-t border-border">
          <th scope="row" className="p-3 font-medium"><Link to={`${base}/${item.id}`} className="text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring">{item.name}</Link></th>
          <td className="p-3">{item.variantCount > 1 ? "Varias variantes" : item.sku ?? "Sin SKU"}</td>
          <td className="p-3">{item.hasDifferentPrices ? "Desde " : ""}{item.minSalePrice.amount.toFixed(2)} {item.minSalePrice.currency}</td>
          <td className="p-3">{item.totalStock}</td>
        </tr>)}</tbody>
      </table>
    </div> : <p className="mt-8 rounded-md border border-border p-6 text-sm text-muted-foreground">{search ? "No se encontraron productos para esta búsqueda." : "Aún no hay productos en el catálogo."}</p>}
    {pages > 1 && <nav aria-label="Páginas de productos" className="mt-6 flex flex-wrap items-center gap-2">
      {Array.from({ length: pages }, (_, index) => index + 1).map((page) => <Button key={page} asChild variant={page === list.page ? "default" : "outline"} size="sm"><Link to={pageUrl(page)} aria-label={`Página ${page}`} aria-current={page === list.page ? "page" : undefined}>{page}</Link></Button>)}
    </nav>}
  </section>;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  const invalid = isRouteErrorResponse(error) && error.status === 400;
  return <section role="alert"><h1 className="text-2xl font-semibold">{invalid ? "Búsqueda no válida" : "No se pudo cargar el catálogo"}</h1>
    <p className="mt-2 text-muted-foreground">{invalid ? "Revisa los criterios e inténtalo de nuevo." : "Inténtalo de nuevo."}</p>
    <Button asChild variant="outline" className="mt-5"><a href={invalid ? "?" : ""}>{invalid ? "Volver al catálogo" : "Reintentar"}</a></Button>
  </section>;
}
