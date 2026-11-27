import type { ImageMetadata } from "astro";
import olva from "@landing/src/assets/logos/olva.svg";
import plin from "@landing/src/assets/logos/plin.png";
import shalom from "@landing/src/assets/logos/shalom.png";
import yape from "@landing/src/assets/logos/yape.svg";

/** Rendered height of a partner logo, a design-token step: `control` is `sizing.controlDesktopMinHeight`, `compact` is `spacing.6`. */
export type PartnerLogoHeight = "control" | "compact";

export type PartnerLogo = Readonly<{
  name: "Shalom" | "Olva" | "Yape" | "Plin";
  alt: string;
  image: ImageMetadata;
  height: PartnerLogoHeight;
}>;

export const integrationsContent = {
  note: "WhatsApp, Shalom, Olva, Yape y Plin son marcas de sus respectivos dueños. Yoyos no está afiliado a ellas.",
} as const;

/** Official logos, authorized by the founder; they never change color or shape. Heights balance their optical weight: the wide Olva and Shalom wordmarks are shorter, the Shalom wordmark matches it, the tiles use the control height. */
export const partnerLogos: readonly PartnerLogo[] = [
  { name: "Shalom", alt: "Logo de Shalom", image: shalom, height: "compact" },
  { name: "Olva", alt: "Logo de Olva", image: olva, height: "compact" },
  { name: "Yape", alt: "Logo de Yape", image: yape, height: "control" },
  { name: "Plin", alt: "Logo de Plin", image: plin, height: "control" },
];
