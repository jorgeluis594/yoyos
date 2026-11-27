import type { ImageMetadata } from "astro";
import antojo from "@landing/src/assets/catalog/phones/antojo.png";
import boutique from "@landing/src/assets/catalog/phones/boutique.png";
import clasico from "@landing/src/assets/catalog/phones/clasico.png";
import noche from "@landing/src/assets/catalog/phones/noche.png";
import suave from "@landing/src/assets/catalog/phones/suave.png";

/** One store theme of the public catalog, shown as a generated phone plate: the founder's target look for that theme. */
export type CatalogTheme = Readonly<{ name: string; image: ImageMetadata; alt: string }>;

const alt = (theme: string) => `Catálogo de la tienda demo Zapatillas Lima Store en el estilo ${theme}, con buscador y cuatro productos`;

export const catalogContent = {
  heading: { lead: "Tu catálogo, con el", marked: "estilo de tu marca" },
  lead: "Un link con tus productos, buscador y carrito. Elige uno de cinco estilos y ponle tu logo.",
  checkout: ["Tu cliente compra sin crear cuenta", "Ve el envío según su distrito", "Paga con Yape, Plin o transferencia"],
  themesLabel: "Los cinco estilos del catálogo",
  themes: [
    { name: "Clásico", image: clasico, alt: alt("Clásico") },
    { name: "Boutique", image: boutique, alt: alt("Boutique") },
    { name: "Antojo", image: antojo, alt: alt("Antojo") },
    { name: "Suave", image: suave, alt: alt("Suave") },
    { name: "Noche", image: noche, alt: alt("Noche") },
  ],
} as const satisfies Readonly<Record<string, unknown> & { themes: readonly CatalogTheme[] }>;
