import type { ImageMetadata } from "astro";

export type Testimonial = Readonly<{
  quote: string;
  name: string;
  business: string;
  category: string;
  city: string;
  photo: ImageMetadata;
}>;

export const testimonialsContent = {
  heading: "Vendedores de TikTok LIVE que ya ordenan sus pedidos con Yoyos",
} as const;

/** Empty until real testimonials with the seller's permission exist; the section renders nothing while it is. */
export const testimonials: readonly Testimonial[] = [];
