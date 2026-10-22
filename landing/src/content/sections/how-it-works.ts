import type { ScreenshotSlot } from "@landing/src/content/sections/screenshot-slot";

import paso1 from "@landing/src/assets/screenshots/paso-1-crear-producto.png";
import paso2 from "@landing/src/assets/screenshots/paso-2-envios-y-cobros.png";
import paso3 from "@landing/src/assets/screenshots/paso-3-vincular-whatsapp.png";
import paso4 from "@landing/src/assets/screenshots/paso-4-pedido-desde-foto.png";
import paso5 from "@landing/src/assets/screenshots/paso-5-checkout-cliente.png";

type Step = Readonly<{ title: string; text: string; capture: ScreenshotSlot }>;

export const howItWorksContent = {
  heading: "Cómo funciona Yoyos en 5 pasos",
  steps: [
    {
      title: "Sube tus productos",
      text: "Agrega cada producto con su foto y su precio, desde la web o la app. La foto es la que Yoyos usa para reconocer el producto. Si quieres, imprime su etiqueta QR desde la app.",
      capture: { kind: "image", image: paso1, aspectRatio: "4/3", alt: "Formulario Nuevo producto en Yoyos con nombre, descripción, SKU, precio de venta, foto y stock inicial" },
    },
    {
      title: "Configura tus entregas y tus datos de pago",
      text: "Define tus zonas y precios de envío (a domicilio, por agencia Shalom u Olva o recojo en tienda) y agrega tus datos de Yape, Plin o transferencia.",
      capture: { kind: "image", image: paso2, aspectRatio: "4/3", alt: "Configuración de entregas con recojo en tienda, entrega a domicilio y envío a agencia, y medios de cobro con Yape y su código QR" },
    },
    {
      title: "Vincula tu WhatsApp",
      text: "Abre la app de Yoyos en tu Android y escanea el QR con tu WhatsApp, desde Dispositivos vinculados, como en WhatsApp Web.",
      capture: { kind: "image", image: paso3, aspectRatio: "4/3", alt: "Pantalla de WhatsApp en la app de Yoyos con el código QR para escanear desde Dispositivos vinculados" },
    },
    {
      title: "Recibe pedidos",
      text: "Cuando tu cliente te manda la foto del producto, Yoyos arma el pedido. Tu cliente también puede comprar desde tu catálogo, que compartes en Instagram, TikTok o WhatsApp.",
      capture: { kind: "image", image: paso4, aspectRatio: "4/3", alt: "Mensaje de WhatsApp con la foto de unas zapatillas y el pedido #1004 que Yoyos creó, con su total y el botón Registrar pago" },
    },
    {
      title: "Cobra y despacha",
      text: "Comparte el link del pedido con tu cliente: confirma sus datos, elige cómo recibirlo (a domicilio, en agencia Shalom u Olva o con recojo en tienda) y paga con Yape, Plin o transferencia subiendo su comprobante. Tú verificas el pago e imprimes el rótulo desde la app.",
      capture: { kind: "image", image: paso5, aspectRatio: "4/3", alt: "Link del pedido para el cliente con sus datos, la forma de entrega, el pago con Yape y el comprobante por adjuntar" },
    },
  ],
} as const satisfies Readonly<{ heading: string; steps: readonly Step[] }>;
