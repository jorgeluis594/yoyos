import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { Link } from "react-router";
import { StoreBrandHeader } from "@core/src/features/store-appearance/presentation/store-brand-header";
import { StoreTheme } from "@core/src/features/store-appearance/presentation/store-theme";
import type { PublicStoreAppearance } from "@core/src/features/store-appearance/presentation/store-appearance-schemas";
import type { CatalogCard, CatalogProduct } from "@core/src/features/products/domain/catalog-product";
import { formatCurrency } from "@core/app/format-currency";
import { Button } from "@core/app/components/ui/button";
import { Input } from "@core/app/components/ui/input";
import { Skeleton } from "@core/app/components/ui/skeleton";
import { cn } from "@core/app/lib/utils";
import type { Money } from "@shared/money";

export const catalogPage = "mx-auto w-full max-w-5xl px-4 sm:px-8";
export const catalogHeaders = { "Referrer-Policy": "no-referrer" };
export const catalogMeta = (title: string) => [{ title }, { name: "robots", content: "noindex, nofollow" }];

export const formatCatalogAmount = (money: Money) => formatCurrency(money.amount, money.currency, "es");
export const formatCatalogPrice = ({ kind, amount }: CatalogProduct["price"]) =>
  kind === "from" ? `Desde ${formatCatalogAmount(amount)}` : formatCatalogAmount(amount);

/** The store's theme paints every buyer page of the catalog, with the same scope and fixed color scheme as the checkout. `cart` is the mount point for the cart button. */
export function CatalogShell({ appearance, storeName, cart, children }: Readonly<{
  appearance: PublicStoreAppearance; storeName: string; cart?: ReactNode; children: ReactNode;
}>) {
  return <StoreTheme appearance={appearance}>
    <div className="min-h-screen bg-background text-foreground">
      <header data-store-part="header" className="border-b bg-card"><div className={`${catalogPage} flex min-h-16 items-center justify-between gap-3 py-3`}>
        <StoreBrandHeader companyName={storeName} logoUrl={appearance.logoUrl} />{cart}
      </div></header>
      <main className={`${catalogPage} flex flex-col gap-4 py-6 pb-24`}>{children}</main>
    </div>
  </StoreTheme>;
}

/** The search field of the catalog; the editor preview passes `readOnly` to draw it inert. */
export function CatalogSearchField(props: Omit<ComponentProps<typeof Input>, "type" | "placeholder" | "aria-label" | "autoComplete">) {
  return <Input data-store-part="catalog-search" type="search" maxLength={80} placeholder="Buscar productos" aria-label="Buscar productos" autoComplete="off" {...props} />;
}

/** The product grid, with the columns and gaps the catalog uses. */
export function CatalogGrid({ children, ...props }: ComponentProps<"ul">) {
  return <ul className="grid grid-cols-2 gap-x-3 gap-y-5 lg:grid-cols-4 lg:gap-x-5" {...props}>{children}</ul>;
}

/** Empty cards in the grid's shape, while products load. */
export function ProductGridSkeleton({ count = 8 }: Readonly<{ count?: number }>) {
  return <CatalogGrid aria-busy="true" aria-label="Cargando productos">
    {Array.from({ length: count }, (_, index) => <li key={index} data-slot="card-placeholder" className="flex flex-col gap-2">
      <Skeleton className="aspect-square w-full" /><Skeleton className="h-4 w-3/4" /><Skeleton className="h-4 w-1/3" />
    </li>)}
  </CatalogGrid>;
}

/** A card of the grid: the square photo, the name and the price. Without `to` it is inert, for the editor preview. */
export function CatalogProductCard({ item, to }: Readonly<{ item: Omit<CatalogCard, "id">; to?: string }>) {
  const className = "group flex flex-col gap-2 rounded-[var(--radius-card)] outline-offset-4";
  const content = <>
    <div className="relative">
      <CatalogProductImage name={item.name} url={item.imageUrl} part="catalog-card-photo" />
      {item.soldOut && <span data-store-part="catalog-sold-out" className="absolute top-2 left-2 rounded-full bg-background/90 px-2 py-0.5 text-xs font-medium">Agotado</span>}
    </div>
    <span data-store-part="product-name" className="line-clamp-2 text-sm group-hover:underline">{item.name}</span>
    <span data-store-part="price" className="font-semibold">{formatCatalogPrice(item.price)}</span>
  </>;
  return to
    ? <Link data-store-part="catalog-card" to={to} state={{ fromCatalog: true }} className={className}>{content}</Link>
    : <div data-store-part="catalog-card" className={className}>{content}</div>;
}

/** Without photo, or when it fails to load, a neutral block with the initial; never a broken image. */
export function CatalogProductImage({ name, url, part, className }: Readonly<{ name: string; url: string | null; part: "catalog-card-photo" | "catalog-product-photo"; className?: string }>) {
  const [failed, setFailed] = useState(false);
  const image = useRef<HTMLImageElement>(null);
  // The image can fail before React attaches `onError` during hydration.
  useEffect(() => {
    if (image.current?.complete && image.current.naturalWidth === 0) setFailed(true);
  }, []);
  const frame = cn("aspect-square w-full overflow-hidden rounded-[var(--radius-card)] bg-muted", className);
  if (!url || failed) return <div data-store-part={part} className={cn(frame, "flex items-center justify-center text-4xl font-semibold text-muted-foreground")} aria-hidden="true">
    {name.trim().charAt(0).toUpperCase()}
  </div>;
  return <div data-store-part={part} className={frame}><img ref={image} src={url} alt="" loading="lazy" className="size-full object-cover" onError={() => setFailed(true)} /></div>;
}

export function CatalogMessage({ title, children }: Readonly<{ title: string; children?: ReactNode }>) {
  return <main className="mx-auto flex max-w-lg flex-col items-start gap-4 p-6"><h1 className="text-2xl font-semibold">{title}</h1>{children}</main>;
}

export function CatalogLoadError() {
  return <CatalogMessage title="No pudimos cargar el catálogo. Revisa tu conexión">
    {/* A full reload retries even when the failure happened during a client navigation. */}
    <Button asChild><a href="">Reintentar</a></Button>
  </CatalogMessage>;
}
