import type { ImageMetadata } from "astro";

export type PartnerLogo = Readonly<{ name: "Shalom" | "Olva" | "Yape" | "Plin"; alt: string } & (
  | { kind: "provisional" }
  | { kind: "image"; svg: ImageMetadata }
)>;

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
  logosLabel: "Agencias y medios de pago",
  note: "WhatsApp, Shalom, Olva, Yape y Plin son marcas de sus respectivos dueños. Yoyos no está afiliado a ellas.",
} as const;

/** The official SVGs are not in the repository yet: each logo renders as a provisional badge until they are supplied. */
export const partnerLogos: readonly PartnerLogo[] = [
  { name: "Shalom", alt: "Logo de Shalom", kind: "provisional" },
  { name: "Olva", alt: "Logo de Olva", kind: "provisional" },
  { name: "Yape", alt: "Logo de Yape", kind: "provisional" },
  { name: "Plin", alt: "Logo de Plin", kind: "provisional" },
];
