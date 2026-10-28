import { useState } from "react";
import { data, isRouteErrorResponse, Link, useLoaderData, useLocation, useNavigate, type LoaderFunctionArgs, type MetaArgs } from "react-router";
import { catalogBrowse } from "@core/src/features/catalog/browse-composition";
import { catalogProductPathSchema } from "@core/src/features/catalog/presentation/browse-schemas";
import { optionState, selectedVariant, type VariantSelection } from "@core/src/features/catalog/presentation/variant-selection";
import { bindRequestOperation } from "@core/src/shared/infrastructure/logger";
import type { ColorSchemeHandle } from "@core/app/color-scheme";
import { storefrontContext } from "@core/app/storefront-context";
import { CatalogLoadError, CatalogMessage, CatalogProductImage, CatalogShell, catalogHeaders, headingFont, catalogMeta, formatCatalogAmount, formatCatalogPrice } from "@core/app/components/catalog-sections";
import { CatalogCartButton } from "@core/app/components/catalog-cart";
import { Button } from "@core/app/components/ui/button";
import type { CatalogProduct } from "@core/src/features/products/domain/catalog-product";
import type { PublicStoreAppearance } from "@core/src/features/store-appearance/presentation/store-appearance-schemas";
import { addToCart, maxCartLines, useCatalogCart } from "@core/app/lib/catalog-cart-storage";

export const headers = () => catalogHeaders;
/** A published store renders its fixed theme, also on «Este producto ya no está disponible»; «Catálogo no disponible» and the load error follow the system. */
export const handle = { colorScheme: (page: unknown) => (page as { storeName?: string } | undefined)?.storeName ? "fixed" : "system" } satisfies ColorSchemeHandle;
export const meta = ({ data: page }: MetaArgs<typeof loader>) =>
  catalogMeta(!page ? "Catálogo no disponible" : page.kind === "found" ? `${page.product.name} · ${page.storeName}` : page.storeName);

export async function loader({ params, context }: LoaderFunctionArgs) {
  bindRequestOperation({ operation: "get_catalog_product" });
  const storefront = context.get(storefrontContext);
  if (storefront?.kind !== "published") throw data(null, { status: 404, headers: catalogHeaders });
  const path = catalogProductPathSchema.safeParse(params);
  const look = catalogBrowse.storeAppearance(storefront.companyId);
  const result = await catalogBrowse.getProduct(path.success ? path.data.productId : null, storefront);
  if (!result.success) {
    const code = result.error.code;
    bindRequestOperation({ outcome: code === "CATALOG_UNAVAILABLE" ? "unavailable" : "technical_failure" });
    throw data(null, { status: code === "CATALOG_UNAVAILABLE" ? 404 : 503, headers: catalogHeaders });
  }
  const { kind, appearance } = await look;
  bindRequestOperation({ storeAppearance: kind, storeTheme: appearance.theme });
  // A missing product is data, not a thrown response, so the page keeps the store name, the theme and the fixed scheme.
  if (result.data.kind === "unavailable") {
    bindRequestOperation({ outcome: "unavailable" });
    return data({ ...result.data, companyId: storefront.companyId, appearance }, { status: 404, headers: catalogHeaders });
  }
  return data({ ...result.data, companyId: storefront.companyId, appearance }, { headers: catalogHeaders });
}

const priceFont = { fontFamily: "var(--store-font-body, inherit)", fontWeight: "var(--store-weight-price, 600)" };

/** Returns to the list entry when coming from it, so search, pages and scroll come back as they were. */
function BackToCatalog() {
  const location = useLocation();
  const navigate = useNavigate();
  const fromCatalog = (location.state as { fromCatalog?: boolean } | null)?.fromCatalog === true;
  return <Button asChild={!fromCatalog} variant="ghost" className="self-start" onClick={fromCatalog ? () => navigate(-1) : undefined}>
    {fromCatalog ? <span>Volver al catálogo</span> : <Link to="/">Volver al catálogo</Link>}
  </Button>;
}

export default function CatalogProductPage() {
  const page = useLoaderData<typeof loader>();
  return page.kind === "found"
    ? <FoundProduct companyId={page.companyId} storeName={page.storeName} appearance={page.appearance} product={page.product} />
    : <CatalogShell appearance={page.appearance} storeName={page.storeName}>
      <UnavailableProduct />
    </CatalogShell>;
}

function UnavailableProduct() {
  return <section className="flex flex-col items-start gap-4 py-6">
    <h1 className="text-2xl font-semibold" style={headingFont}>Este producto ya no está disponible</h1>
    <Button asChild><Link to="/">Volver al catálogo</Link></Button>
  </section>;
}

function FoundProduct({ companyId, storeName, appearance, product }: Readonly<{ companyId: string; storeName: string; appearance: PublicStoreAppearance; product: CatalogProduct }>) {
  const [cart, updateCart] = useCatalogCart(companyId);
  // `id` changes on every add so the status region gets new content and screen readers repeat an identical message.
  const [notice, setNotice] = useState({ text: "", id: 0 });
  const notify = (text: string) => setNotice((current) => ({ text, id: current.id + 1 }));
  const [selection, setSelection] = useState<VariantSelection>({});
  const [quantity, setQuantity] = useState(1);
  const variant = selectedVariant(product, selection);
  const max = variant?.maxQuantity ?? 0;
  const shown = Math.max(1, Math.min(quantity, max));
  const add = () => {
    if (!variant) return;
    const result = addToCart(cart, { variantId: variant.id, productId: product.id, quantity: shown, price: variant.price,
      productName: product.name, attributes: { ...variant.attributes }, imageUrl: product.photoUrls[0] ?? null }, variant.maxQuantity);
    if (result.kind === "line_limit") { notify(`Tu carrito ya tiene ${maxCartLines} productos distintos`); return; }
    if (result.kind === "at_limit") { notify("Ya tienes el máximo disponible en tu carrito"); return; }
    updateCart(result.cart);
    setQuantity(1);
    notify(result.clamped ? "Agregado al carrito. Ya tienes el máximo disponible" : "Agregado al carrito");
  };

  return <CatalogShell appearance={appearance} storeName={storeName} cart={<CatalogCartButton companyId={companyId} />}>
    <BackToCatalog />
    <article className="grid gap-6 md:grid-cols-2 md:gap-10">
      <CatalogProductImage name={product.name} url={product.photoUrls[0] ?? null} part="catalog-product-photo" />
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold text-balance" style={headingFont}>{product.name}</h1>
          <p className="text-xl font-semibold" style={priceFont}>{variant ? formatCatalogAmount(variant.price) : formatCatalogPrice(product.price)}</p>
          {product.soldOut && <p className="text-sm font-medium text-muted-foreground">Agotado</p>}
        </div>
        {product.variants.length > 1 && product.attributes.map(({ name, values }) => <fieldset key={name} className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">{name}{selection[name] ? `: ${selection[name]}` : ""}</legend>
          <div className="flex flex-wrap gap-2">
            {values.map((value) => {
              const state = optionState(product, selection, name, value);
              return <Button key={value} type="button" variant={selection[name] === value ? "default" : "outline"} aria-pressed={selection[name] === value}
                disabled={state !== "available"} onClick={() => { setSelection({ ...selection, [name]: value }); notify(""); }}>
                {value}{state === "sold_out" && " · Agotado"}
              </Button>;
            })}
          </div>
        </fieldset>)}
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium" id="quantity-label">Cantidad</span>
          <div data-store-part="catalog-quantity" className="flex items-center rounded-[var(--radius-control)] border" role="group" aria-labelledby="quantity-label">
            <Button type="button" variant="ghost" size="icon" aria-label="Quitar uno" disabled={shown <= 1} onClick={() => setQuantity(shown - 1)}>−</Button>
            <output className="w-8 text-center tabular-nums" aria-live="polite">{shown}</output>
            <Button type="button" variant="ghost" size="icon" aria-label="Agregar uno" disabled={shown >= max} onClick={() => setQuantity(shown + 1)}>+</Button>
          </div>
        </div>
        <Button type="button" size="lg" className="h-11" disabled={!variant || max === 0} onClick={add}>Agregar al carrito</Button>
        <p role="status" data-store-part="catalog-notice" className="text-sm font-medium has-[span:empty]:hidden"><span key={notice.id}>{notice.text}</span></p>
        {product.description && <p className="whitespace-pre-line text-muted-foreground">{product.description}</p>}
      </div>
    </article>
  </CatalogShell>;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  if (isRouteErrorResponse(error) && error.status === 404) return <CatalogMessage title="Catálogo no disponible" />;
  return <CatalogLoadError />;
}
