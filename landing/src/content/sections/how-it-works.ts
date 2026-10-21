import type { ScreenshotSlot } from "./screenshot-slot";

type Step = Readonly<{ title: string; text: string; capture: ScreenshotSlot }>;

export const howItWorksContent = {
  heading: "Cómo funciona Yoyos en 5 pasos",
  steps: [
    {
      title: "Sube tus productos",
      text: "Agrega cada producto con su foto y su precio, desde la web o la app. La foto es la que Yoyos usa para reconocer el producto. Si quieres, imprime su etiqueta QR desde la app.",
      capture: { kind: "provisional", aspectRatio: "4/3", alt: "Pantalla de Yoyos para crear un producto con foto y precio" },
    },
    {
      title: "Configura tus entregas y tus datos de pago",
      text: "Define tus zonas y precios de envío (a domicilio, por agencia Shalom u Olva o recojo en tienda) y agrega tus datos de Yape, Plin o transferencia.",
      capture: {
        kind: "provisional",
        aspectRatio: "4/3",
        alt: "Configuración de zonas de envío y datos de pago con Yape, Plin o transferencia",
      },
    },
    {
      title: "Vincula tu WhatsApp",
      text: "Abre la app de Yoyos en tu Android y escanea el QR con tu WhatsApp, desde Dispositivos vinculados, como en WhatsApp Web.",
      capture: {
        kind: "provisional",
        aspectRatio: "4/3",
        alt: "Código QR en la app de Yoyos para vincular WhatsApp desde Dispositivos vinculados",
      },
    },
    {
      title: "Recibe pedidos",
      text: "Cuando tu cliente te manda la foto del producto, Yoyos arma el pedido. Tu cliente también puede comprar desde tu catálogo, que compartes en Instagram, TikTok o WhatsApp.",
      capture: { kind: "provisional", aspectRatio: "4/3", alt: "Pedido creado a partir de la foto que envió un cliente por WhatsApp" },
    },
    {
      title: "Cobra y despacha",
      text: "Comparte el link del pedido con tu cliente: confirma sus datos, elige cómo recibirlo (a domicilio, en agencia Shalom u Olva o con recojo en tienda) y paga con Yape, Plin o transferencia subiendo su comprobante. Tú verificas el pago e imprimes el rótulo desde la app.",
      capture: {
        kind: "provisional",
        aspectRatio: "4/3",
        alt: "Link del pedido con opciones de entrega a domicilio, agencia o recojo y pago con Yape o Plin",
      },
    },
  ],
} as const satisfies Readonly<{ heading: string; steps: readonly Step[] }>;
