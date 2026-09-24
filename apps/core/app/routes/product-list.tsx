import { Form, isRouteErrorResponse, Link, useLoaderData, useNavigation, type LoaderFunctionArgs } from "react-router";
import { Button } from "@/components/ui/button";
import { DataTable, type TableColumn } from "@/components/ui/data-table";
import { ErrorState } from "@/components/ui/error-state";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
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

  type Item = (typeof list.items)[number];
  const columns: TableColumn<Item>[] = [
    {
      id: "name",
      header: "Nombre",
      mobile: "title",
      cell: (item) => (
        <Link to={`${base}/${item.id}`} className="font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring">
          {item.name}
        </Link>
      ),
    },
    {
      id: "sku",
      header: "SKU",
      mobile: "description",
      cell: (item) => (item.variantCount > 1 ? "Varias variantes" : item.sku ?? "Sin SKU"),
    },
    {
      id: "price",
      header: "Precio de venta",
      mobile: "value",
      align: "right",
      cell: (item) => `${item.hasDifferentPrices ? "Desde " : ""}${item.minSalePrice.amount.toFixed(2)} ${item.minSalePrice.currency}`,
    },
    {
      id: "stock",
      header: "Stock",
      mobile: "description",
      align: "right",
      cell: (item) => item.totalStock,
    },
  ];

  return <section aria-busy={navigation.state === "loading"}>
    <PageHeader>
      <PageHeader.Heading>
        <PageHeader.Title>
          Productos
          <PageHeader.Count>{list.total}</PageHeader.Count>
        </PageHeader.Title>
      </PageHeader.Heading>
      <PageHeader.Actions>
        <Button asChild><Link to={`${base}/new`}>Nuevo producto</Link></Button>
      </PageHeader.Actions>
    </PageHeader>
    <Form method="get" role="search" className="mt-6 flex flex-wrap items-end gap-3">
      <Field className="min-w-0 flex-1">
        <FieldLabel>Buscar por nombre o SKU</FieldLabel>
        <Input name="search" type="search" defaultValue={search} />
      </Field>
      <Button type="submit">Buscar</Button>
    </Form>
    <DataTable
      className="mt-6"
      columns={columns}
      caption="Productos del catálogo"
      getRowId={(item) => item.id}
      data={list.items}
      emptyMessage={search
        ? "No se encontraron productos para esta búsqueda."
        : <>Aún no hay productos en el catálogo. <Link to={`${base}/new`} className="font-medium text-primary underline underline-offset-4">Crea el primero</Link>.</>}
    />
    {pages > 1 && <nav aria-label="Páginas de productos" className="mt-6 flex flex-wrap items-center gap-2">
      {Array.from({ length: pages }, (_, index) => index + 1).map((page) => <Button key={page} asChild variant={page === list.page ? "default" : "outline"} size="sm"><Link to={pageUrl(page)} aria-label={`Página ${page}`} aria-current={page === list.page ? "page" : undefined}>{page}</Link></Button>)}
    </nav>}
  </section>;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  const invalid = isRouteErrorResponse(error) && error.status === 400;
  return (
    <ErrorState
      title={invalid ? "Búsqueda no válida" : "No se pudo cargar el catálogo"}
      description={invalid ? "Revisa los criterios e inténtalo de nuevo." : "Inténtalo de nuevo."}
      action={
        <Button asChild variant="outline">
          <a href={invalid ? "?" : ""}>{invalid ? "Volver al catálogo" : "Reintentar"}</a>
        </Button>
      }
    />
  );
}
