import type { PreloadImage } from "@landing/src/lib/seo";

// Stub created by T0: T1 owns this file and adds the rest of the hero copy.
export const heroContent = {
  heading: "Sistema de pedidos por WhatsApp para vendedores de TikTok LIVE",
} as const;

/**
 * Preload of the hero LCP image, consumed by index.astro. T1 builds it with `getImage()` when the hero slot
 * becomes a real image; it stays undefined while the slot is provisional.
 */
export const heroPreload: PreloadImage | undefined = undefined;
