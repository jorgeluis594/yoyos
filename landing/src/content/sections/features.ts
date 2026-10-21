import type { ScreenshotSlot } from "@landing/src/content/sections/screenshot-slot";

/** The content gives no alt for the feature captures, so they are decorative: the card title and text carry the meaning. */
const decorativeCapture: ScreenshotSlot = { kind: "provisional", aspectRatio: "16/10", alt: "" };

export const featuresContent = {
  heading: "Todo para vender por WhatsApp, Instagram y TikTok LIVE",
  cards: [
    {
      title: "Pedidos desde las fotos de WhatsApp.",
      text: "Cuando tu cliente te manda la foto del producto, Yoyos arma el pedido en ese chat.",
    },
    {
      title: "Búsqueda de productos por imagen o QR.",
      text: "¿Te mandaron una captura del live? Yoyos encuentra el producto en tu catálogo por su etiqueta QR o por la imagen.",
    },
    {
      title: "Catálogo para compartir.",
      text: "Un link con tus productos, buscador y carrito, listo para tu bio de Instagram o TikTok y tus estados de WhatsApp.",
    },
    {
      title: "Checkout con zonas y distritos.",
      text: "Defines tus zonas y precios de envío por departamento, provincia o distrito, y tu cliente ve el costo según dónde vive.",
    },
    {
      title: "Cobros con Yape, Plin o transferencia.",
      text: "Tu cliente ve tus datos de pago, sube su comprobante y tú lo verificas.",
    },
    {
      title: "Rótulos para tus envíos.",
      text: "Imprime los rótulos de tus envíos en lote desde la app. La guía la sigues sacando en la agencia.",
    },
  ].map((card) => ({ ...card, capture: decorativeCapture })),
} as const;
