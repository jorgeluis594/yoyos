import { useTranslation } from "react-i18next";
import { companyPath } from "@core/app/locale";
import { formatCurrency } from "@core/app/format-currency";
import { log } from "@core/src/shared/infrastructure/logger";
import { isRouteErrorResponse, Link, useLoaderData, useNavigation, type LoaderFunctionArgs } from "react-router";
import { Button } from "@core/app/components/ui/button";
import { DataTable, type TableColumn } from "@core/app/components/ui/data-table";
import { ErrorState } from "@core/app/components/ui/error-state";
import { FilterBar } from "@core/app/components/ui/filter-bar";
import { PageHeader } from "@core/app/components/ui/page-header";
import { privateUserContext } from "@core/app/private-user-context";
import { products } from "@core/src/features/products/composition";

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
    const result = await products.list(input);
    if (!result.success) throw new Response("Criterios de búsqueda no válidos.", { status: 400 });
    return { list: result.data, search: input.search?.trim() ?? "", base: companyPath(new URL(request.url).pathname, company.country, "/products") };
  } catch (cause) {
    if (cause instanceof Response) throw cause;
    log.error({ event: "unable_to_list_products", err: cause }, "unable_to_list_products");
    throw new Response("No se pudo cargar el catálogo.", { status: 503 });
  }
}

export default function ProductList() {
  const { t, i18n } = useTranslation();
  const { list, search, base } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const pages = Math.ceil(list.total / list.pageSize);
  const pageUrl = (page: number) => `${base}?${new URLSearchParams({ ...(search ? { search } : {}), page: String(page), ...(list.pageSize === 20 ? {} : { pageSize: String(list.pageSize) }) })}`;

  type Item = (typeof list.items)[number];
  const columns: TableColumn<Item>[] = [
    {
      id: "name",
      header: t("products.name"),
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
      cell: (item) => (item.variantCount > 1 ? t("products.multipleVariants") : item.sku ?? t("products.noSku")),
    },
    {
      id: "price",
      header: t("products.salePrice"),
      mobile: "value",
      align: "right",
      cell: (item) => `${item.hasDifferentPrices ? t("products.from") : ""}${formatCurrency(item.minSalePrice.amount, item.minSalePrice.currency, i18n.language)}`,
    },
    {
      id: "stock",
      header: t("products.stock"),
      mobile: "description",
      align: "right",
      cell: (item) => item.totalStock,
    },
  ];

  return <section aria-busy={navigation.state === "loading"}>
    <PageHeader>
      <PageHeader.Heading>
        <PageHeader.Title>
          {t("products.title")}
          <PageHeader.Count>{list.total}</PageHeader.Count>
        </PageHeader.Title>
      </PageHeader.Heading>
      <PageHeader.Actions>
        <Button asChild><Link to={`${base}/new`}>{t("products.new")}</Link></Button>
      </PageHeader.Actions>
    </PageHeader>
    <FilterBar searchName="search" searchValue={search} searchLabel={t("products.searchLabel")} submitLabel={t("products.search")} />
    <DataTable
      className="mt-6"
      columns={columns}
      caption={t("products.caption")}
      getRowId={(item) => item.id}
      data={list.items}
      emptyMessage={search
        ? t("products.emptySearch")
        : <>{t("products.empty")}<Link to={`${base}/new`} className="font-medium text-primary underline underline-offset-4">{t("products.createFirst")}</Link>.</>}
    />
    {pages > 1 && <nav aria-label={t("products.pages")} className="mt-6 flex flex-wrap items-center gap-2">
      {Array.from({ length: pages }, (_, index) => index + 1).map((page) => <Button key={page} asChild variant={page === list.page ? "default" : "outline"} size="sm"><Link to={pageUrl(page)} aria-label={t("products.page", { page })} aria-current={page === list.page ? "page" : undefined}>{page}</Link></Button>)}
    </nav>}
  </section>;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  const { t } = useTranslation();
  const invalid = isRouteErrorResponse(error) && error.status === 400;
  return (
    <ErrorState
      title={invalid ? t("products.invalidSearch") : t("products.loadError")}
      description={invalid ? t("products.invalidSearchDescription") : t("common.retry")}
      action={
        <Button asChild variant="outline">
          <a href={invalid ? "?" : ""}>{invalid ? t("products.backCatalog") : t("products.retry")}</a>
        </Button>
      }
    />
  );
}
