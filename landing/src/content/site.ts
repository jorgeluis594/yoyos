import type { PageSeo } from "@landing/src/lib/seo";

export const brandName = "Yoyos";
export const skipLinkLabel = "Ir al contenido";

export const navLinks = [
  { label: "Cómo funciona", anchor: "como-funciona" },
  { label: "Funciones", anchor: "funciones" },
  { label: "Envíos y pagos", anchor: "integraciones" },
  { label: "Precio", anchor: "precio" },
  { label: "Preguntas", anchor: "preguntas" },
] as const;

export const privacyContent = { title: "Política de privacidad" } as const;

export const ctaLabels = {
  whatsapp: "Escríbenos por WhatsApp",
  call: "Llámanos",
  demo: "Agenda una demo",
  login: "Ingresar",
} as const;

export const headerContent = {
  logoAlt: "Yoyos",
  menu: { label: "Menú", open: "Abrir menú", close: "Cerrar menú" },
  callAriaLabel: (phoneDisplay: string) => `Llamar a Yoyos al ${phoneDisplay}`,
} as const;

export const footerContent = {
  logoAlt: "Yoyos",
  tagline: "Sistema de pedidos por WhatsApp para emprendedores que venden por redes en Perú.",
  product: {
    title: "Producto",
    links: [
      { label: "Cómo funciona", anchor: "como-funciona" },
      { label: "Funciones", anchor: "funciones" },
      { label: "Precio", anchor: "precio" },
      { label: "Preguntas", anchor: "preguntas" },
    ],
  },
  contact: {
    title: "Contacto",
    whatsapp: (phoneDisplay: string) => `WhatsApp: ${phoneDisplay}`,
    call: (phoneDisplay: string) => `Llámanos: ${phoneDisplay}`,
    email: (email: string) => `Correo: ${email}`,
  },
  socialLabels: { tiktok: "TikTok", instagram: "Instagram" },
  legal: { privacy: "Política de privacidad" },
  copyright: "© 2026 Yoyos. Hecho en Perú.",
  trademarks: "WhatsApp, Shalom, Olva, Yape y Plin son marcas de sus respectivos dueños.",
} as const;

const ogImage = {
  path: "/og/yoyos-1200x630.png",
  alt: "Foto de un producto enviada por WhatsApp y convertida en pedido en Yoyos",
  width: 1200,
  height: 630,
} as const;

const homeTitle = "Sistema de pedidos por WhatsApp para emprendedores | Yoyos";
const homeDescription =
  "Tus clientes te mandan la foto por WhatsApp y Yoyos arma el pedido. Cobra con Yape o Plin y envía por Shalom u Olva. S/ 50 al mes + IGV, sin comisión.";
const privacyTitle = "Política de privacidad | Yoyos";
const privacyDescription =
  "Cómo Yoyos trata los datos que nos dejas en el formulario de demo: para qué los usamos, cuánto tiempo los guardamos y cómo ejercer tus derechos.";
const notFoundTitle = "Esta página no existe | Yoyos";
const notFoundDescription = "Puede que el link esté mal escrito o que la página se haya movido.";

export const pageSeo = {
  home: {
    path: "/",
    title: homeTitle,
    description: homeDescription,
    socialTitle: homeTitle,
    twitterTitle: "Sistema de pedidos por WhatsApp | Yoyos",
    twitterDescription:
      "Fotos de WhatsApp convertidas en pedidos, cobro con Yape o Plin y envíos Shalom u Olva. S/ 50 al mes + IGV.",
    image: ogImage,
    indexable: true,
  },
  privacy: {
    path: "/privacidad",
    title: privacyTitle,
    description: privacyDescription,
    socialTitle: privacyTitle,
    twitterTitle: privacyTitle,
    twitterDescription: privacyDescription,
    image: ogImage,
    indexable: true,
  },
  notFound: {
    path: "/404",
    title: notFoundTitle,
    description: notFoundDescription,
    socialTitle: notFoundTitle,
    twitterTitle: notFoundTitle,
    twitterDescription: notFoundDescription,
    image: ogImage,
    indexable: false,
  },
} as const satisfies Record<string, PageSeo>;
