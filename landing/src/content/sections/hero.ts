import { getImage } from "astro:assets";
import type { PreloadImage } from "@landing/src/lib/seo";
import type { ScreenshotSlot } from "./screenshot-slot";

export const heroContent = {
  eyebrow: "Hecho para vendedores de TikTok LIVE en Perú",
  heading: "Sistema de pedidos por WhatsApp para vendedores de TikTok LIVE",
  lead: "Automatizamos las ventas por redes sociales: tus clientes te escriben por WhatsApp como siempre y, cuando te mandan la foto del producto, Yoyos arma el pedido para que dejes de copiar pedidos a mano. Tú vendes, nosotros operamos.",
  callLink: "¿Prefieres hablar? Llámanos",
  microcopy: "Disponible para Android. iPhone próximamente. S/ 50 al mes + IGV, sin comisión por venta.",
} as const;

/** Switch `kind` to "image" with the real mockup (src/assets/screenshots/) when Marketing supplies it. */
export const heroImage = {
  kind: "provisional",
  alt: "Chat de WhatsApp en el que un cliente envía la foto de unas zapatillas y Yoyos la convierte en un pedido con su total",
  aspectRatio: "4/5",
} as ScreenshotSlot;

/** Responsive candidates of the hero LCP image; the preload below and the rendered <Picture> share them. */
export const heroImageSizing = { widths: [360, 540, 720], sizes: "(min-width: 64em) 540px, 100vw" } as const;

/** Preload of the hero LCP image, consumed by index.astro; undefined while the slot is provisional. */
export const heroPreload: PreloadImage | undefined =
  heroImage.kind === "image"
    ? await getImage({ src: heroImage.image, format: "avif", widths: [...heroImageSizing.widths], sizes: heroImageSizing.sizes }).then((avif) => ({
        href: avif.src,
        type: "image/avif",
        imagesrcset: avif.srcSet.attribute,
        imagesizes: heroImageSizing.sizes,
      }))
    : undefined;
