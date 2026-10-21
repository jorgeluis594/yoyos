import { useEffect, useRef, useState, type CSSProperties } from "react";

type ProductThumbnailProps = Readonly<{ name: string; url: string | null }>;

/** Size and shape come from the active theme; the fallbacks are a neutral square block. */
const frame: CSSProperties = {
  width: "var(--checkout-thumb-width, 3.5rem)",
  aspectRatio: "var(--checkout-thumb-ratio, 1 / 1)",
  borderRadius: "var(--checkout-thumb-radius, 0.375rem)",
  border: "var(--checkout-thumb-border, none)",
  filter: "var(--checkout-thumb-filter, none)",
  backgroundColor: "var(--thumbnail-surface, var(--muted))",
};

/** The product's photo, or its initial when it has none or the photo fails to load; never a broken image. */
export function ProductThumbnail({ name, url }: ProductThumbnailProps) {
  // A new photo gets a new attempt: the failure belongs to one URL.
  return <Thumbnail key={url ?? ""} name={name} url={url} />;
}

function Thumbnail({ name, url }: ProductThumbnailProps) {
  const [failed, setFailed] = useState(false);
  const image = useRef<HTMLImageElement>(null);
  // The image can fail before React attaches `onError` during hydration.
  useEffect(() => {
    if (image.current?.complete && image.current.naturalWidth === 0) setFailed(true);
  }, []);
  const showPhoto = url !== null && !failed;
  return <div data-slot="product-thumbnail" style={frame} className="grid shrink-0 place-items-center overflow-hidden">
    {showPhoto
      ? <img ref={image} src={url} alt="" loading="lazy" className="size-full object-cover" onError={() => setFailed(true)} />
      : <span aria-hidden="true" className="font-semibold text-muted-foreground" style={{ fontSize: "calc(var(--checkout-thumb-width, 3.5rem) * 0.4)" }}>{name.trim().charAt(0).toUpperCase()}</span>}
  </div>;
}
