import { getImage } from "astro:assets";
import type { PreloadImage } from "@landing/src/lib/seo";
import { heroImage } from "@landing/src/content/sections/hero-image";
import type { ScreenshotSlot } from "./screenshot-slot";

export const heroContent = {
  eyebrow: "Hecho para vendedores de TikTok LIVE en Perú",
  heading: "Sistema de pedidos por WhatsApp para vendedores de TikTok LIVE",
  lead: "Automatizamos las ventas por redes sociales: tus clientes te escriben por WhatsApp como siempre y, cuando te mandan la foto del producto, Yoyos arma el pedido para que dejes de copiar pedidos a mano. Tú vendes, nosotros operamos.",
  callLink: "¿Prefieres hablar? Llámanos",
  microcopy: "Disponible para Android. iPhone próximamente. S/ 50 al mes + IGV, sin comisión por venta.",
} as const;

/**
 * Responsive candidates of the hero LCP image; the preload below and the rendered <Picture> share them.
 * `sizes` mirrors the hero layout: the front capture is about 464px wide from the desktop breakpoint and fills
 * the capped media card (hero.astro) below it. `preloadWidth` is the candidate used as the preload `href`.
 */
export const heroImageSizing = {
  widths: [320, 480, 640, 880],
  sizes: "(min-width: 64em) 464px, min(100vw - 7rem, 20rem)",
  preloadWidth: 480,
} as const;

/** Preload of the hero LCP image: AVIF only, so browsers without AVIF skip it, with `href` taken from `imagesrcset`. */
export async function buildHeroPreload(slot: ScreenshotSlot): Promise<PreloadImage | undefined> {
  if (slot.kind !== "image") return undefined;
  const { widths, sizes, preloadWidth } = heroImageSizing;
  const avif = await getImage({ src: slot.image, format: "avif", widths: [...widths], sizes });
  const candidates = avif.srcSet.attribute.split(",").map((candidate) => candidate.trim().split(" "));
  const fallback = candidates.find(([, descriptor]) => descriptor === `${preloadWidth}w`);
  if (!fallback?.[0]) throw new Error(`Hero preload: no ${preloadWidth}w candidate in the AVIF srcset`);
  return { href: fallback[0], type: "image/avif", imagesrcset: avif.srcSet.attribute, imagesizes: sizes };
}

/** Consumed by index.astro; undefined while the slot is provisional. */
export const heroPreload: PreloadImage | undefined = await buildHeroPreload(heroImage);

export { heroImage };
