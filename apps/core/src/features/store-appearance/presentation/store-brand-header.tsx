import { Link } from "react-router";
import { useEffect, useRef, useState, type CSSProperties } from "react";

/** With `to` the logo and the name are one link to that path; without it they are plain, as in the editor preview. */
type StoreBrandHeaderProps = Readonly<{ companyName: string; logoUrl: string | null; to?: string }>;

/** The plate is always white; a theme sets its size and shape through variables, and the fallbacks are the default Yoyos look. */
const plate: CSSProperties = {
  height: "var(--store-logo-height, 2.5rem)",
  maxWidth: "var(--store-logo-max-width, 10rem)",
  borderRadius: "var(--store-logo-radius, var(--radius-sm))",
  border: "var(--store-logo-border, 1px solid var(--border))",
  boxShadow: "var(--store-logo-shadow, none)",
  padding: "var(--store-logo-padding, 0.25rem 0.5rem)",
};

/** The store name takes the theme's heading font and weight; without a theme it keeps today's semibold. */
const storeName: CSSProperties = {
  fontFamily: "var(--store-font-heading, inherit)",
  fontWeight: "var(--store-weight-heading, 600)",
};

function BrandLogo({ url }: Readonly<{ url: string }>) {
  const [failed, setFailed] = useState(false);
  const image = useRef<HTMLImageElement>(null);
  // The image can fail before React attaches `onError` during hydration.
  useEffect(() => {
    if (image.current?.complete && image.current.naturalWidth === 0) setFailed(true);
  }, []);
  if (failed) return null;
  return <span data-slot="brand-logo" style={plate} className="flex shrink-0 items-center bg-white">
    <img ref={image} src={url} alt="" className="max-h-full max-w-full object-contain" onError={() => setFailed(true)} />
  </span>;
}

/** The element that holds the logo and the name is the one the theme lays out (`header-brand`), so a theme's logo direction reaches them with or without a link. */
export function StoreBrandHeader({ companyName, logoUrl, to }: StoreBrandHeaderProps) {
  const content = <>
    {logoUrl && <BrandLogo key={logoUrl} url={logoUrl} />}
    <p style={storeName} className="min-w-0 break-words">{companyName}</p>
  </>;
  const className = "flex min-w-0 items-center gap-3";
  return to
    ? <Link data-store-part="header-brand" data-slot="brand-link" to={to} className={className}>{content}</Link>
    : <div data-store-part="header-brand" className={className}>{content}</div>;
}
