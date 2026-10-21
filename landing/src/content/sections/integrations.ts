import type { ImageMetadata } from "astro";
import olva from "@landing/src/assets/logos/olva.svg";
import plin from "@landing/src/assets/logos/plin.png";
import shalom from "@landing/src/assets/logos/shalom.png";
import yape from "@landing/src/assets/logos/yape.svg";

export type PartnerLogo = Readonly<{ name: "Shalom" | "Olva" | "Yape" | "Plin"; alt: string; image: ImageMetadata }>;

export const integrationsContent = {
  heading: "Envíos por agencias Shalom y Olva, cobros con Yape y Plin",
  lead: "Funciona con lo que ya usas.",
  items: [
    {
      icon: "chat",
      title: "WhatsApp.",
      text: "Vinculas tu WhatsApp desde la app, como en WhatsApp Web. Tus clientes te siguen escribiendo como siempre.",
    },
    {
      icon: "shipping",
      title: "Shalom y Olva.",
      text: "Configura envíos a agencias Shalom y Olva. Tu cliente elige la sede de destino y tú imprimes el rótulo. La guía la sigues sacando en la agencia.",
    },
    {
      icon: "pickup",
      title: "Recojo en tienda.",
      text: "Si tu cliente prefiere recoger, también puede elegirlo.",
    },
    {
      icon: "payments",
      title: "Yape, Plin y transferencia.",
      text: "Muestra tus datos de cobro y recibe el comprobante en cada pedido.",
    },
  ],
  note: "WhatsApp, Shalom, Olva, Yape y Plin son marcas de sus respectivos dueños. Yoyos no está afiliado a ellas.",
} as const;

/** Official logos, authorized by the founder; they never change color or shape. */
export const partnerLogos: readonly PartnerLogo[] = [
  { name: "Shalom", alt: "Logo de Shalom", image: shalom },
  { name: "Olva", alt: "Logo de Olva", image: olva },
  { name: "Yape", alt: "Logo de Yape", image: yape },
  { name: "Plin", alt: "Logo de Plin", image: plin },
];
