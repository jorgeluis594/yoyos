import { getImage } from "astro:assets";
import type { ImageMetadata } from "astro";
import type { PreloadImage } from "@landing/src/lib/seo";

export const heroContent = {
  heading: { lead: "Del chat al paquete,", marked: "sin copiar a mano." },
  lead: [
    { text: "Para vendedores de " },
    { text: "TikTok LIVE", strong: true },
    { text: ": tu cliente te envía la foto por " },
    { text: "WhatsApp", strong: true },
    { text: " y " },
    { text: "Yoyos", strong: true },
    { text: " arma el pedido, con la entrega y el pago en un link." },
  ],
  steps: ["Foto por WhatsApp", "Yoyos arma el pedido", "Link de entrega y pago"],
  price: { amount: "S/ 50", period: "al mes + IGV" },
  commission: "Sin comisión por venta.",
  callLink: "¿Prefieres hablar? Llámanos",
  stamp: "Pedido listo",
  phoneAlt: "Chat de WhatsApp donde un cliente envía la foto de una zapatilla negra y pregunta: «Hola, ¿tienen esta en talla 42?»",
  boxAlt: "La zapatilla ya empacada en su caja, con el rótulo de Yoyos del pedido #1001: Zapatilla Negra Clásica, talla 42, S/ 179.00",
} as const satisfies Readonly<Record<string, unknown> & { lead: readonly Readonly<{ text: string; strong?: boolean }>[] }>;

/** Responsive candidates of the hero LCP image (the packed box); the preload and the rendered <Picture> share them. */
export const heroImageSizing = {
  widths: [360, 560, 820, 1100],
  sizes: "(min-width: 64em) 30vw, 62vw",
  preloadWidth: 560,
} as const;

/** Preload of the hero LCP image: AVIF only, so browsers without AVIF skip it, with `href` taken from `imagesrcset`. */
export async function buildHeroPreload(image: ImageMetadata): Promise<PreloadImage> {
  const { widths, sizes, preloadWidth } = heroImageSizing;
  const avif = await getImage({ src: image, format: "avif", widths: [...widths], sizes });
  const candidates = avif.srcSet.attribute.split(",").map((candidate) => candidate.trim().split(" "));
  const fallback = candidates.find(([, descriptor]) => descriptor === `${preloadWidth}w`);
  if (!fallback?.[0]) throw new Error(`Hero preload: no ${preloadWidth}w candidate in the AVIF srcset`);
  return { href: fallback[0], type: "image/avif", imagesrcset: avif.srcSet.attribute, imagesizes: sizes };
}
