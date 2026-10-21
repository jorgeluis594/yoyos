import type { ContactMethod, Rubro } from "@landing/src/content/demo-form-values";

export type { ContactMethod, Rubro };

// Labelled options of the demo form contract (landing-technical.md §8), plus the literal form copy. The values
// live in demo-form-values.ts.
export const rubroOptions = [
  { value: "ropa", label: "Ropa" },
  { value: "zapatillas", label: "Zapatillas" },
  { value: "joyeria_accesorios", label: "Joyería y accesorios" },
  { value: "mascotas", label: "Mascotas" },
  { value: "cosmeticos", label: "Cosméticos" },
  { value: "otro", label: "Otro" },
] as const satisfies readonly Readonly<{ value: Rubro; label: string }>[];

export const contactMethodOptions = [
  { value: "whatsapp", label: "Por WhatsApp" },
  { value: "llamada", label: "Por llamada" },
] as const satisfies readonly Readonly<{ value: ContactMethod; label: string }>[];

/** Version of the consent text the form sends; it changes when the privacy text changes. */
export const consentTextVersion = "privacidad-v1-2026-10";

export const demoFormContent = {
  title: "Agenda una demo",
  intro: "Déjanos tus datos y te contactamos para mostrarte Yoyos.",
  fields: {
    nombre: { label: "Tu nombre", placeholder: "Ej.: Rosa Quispe", error: "Escribe tu nombre.", pattern: ".*\\S.*" },
    telefono: {
      label: "Tu WhatsApp o celular",
      prefix: "+51",
      placeholder: "9XX XXX XXX",
      error: "Escribe un celular de 9 dígitos que empiece con 9.",
      pattern: "9[0-9]{2} ?[0-9]{3} ?[0-9]{3}",
    },
    rubro: { label: "¿Qué vendes?", placeholder: "Elige una opción", error: "Elige qué vendes." },
    contacto_preferido: { label: "¿Cómo prefieres que te contactemos?", error: "Elige cómo te contactamos." },
    consentimiento: {
      error: "Para enviar tus datos necesitamos que aceptes la Política de privacidad.",
      beforeLink: "He leído la ",
      link: "Política de privacidad",
      afterLink:
        " y autorizo a Yoyos a usar mis datos (nombre, celular, rubro y forma de contacto) para contactarme por WhatsApp o llamada sobre la demo y la oferta comercial de Yoyos.",
    },
  },
  submit: { label: "Agendar mi demo", sending: "Enviando…" },
  privacyNote: {
    beforeContact: "Tus datos se guardan en nuestro sistema de gestión de clientes y solo los usamos para contactarte sobre Yoyos. Puedes pedir que los corrijamos o borremos, o dejar de recibir contacto, escribiéndonos por WhatsApp",
    email: (email: string) => ` o a ${email}`,
    beforeLink: ". Más detalles en nuestra ",
    link: "Política de privacidad",
    end: ".",
  },
  success: {
    start: (via: string) => `¡Listo! Te contactaremos pronto por ${via}. Si prefieres no esperar, `,
    whatsappLink: "escríbenos por WhatsApp",
    end: ".",
    via: { whatsapp: "WhatsApp", llamada: "llamada" },
  },
  error: {
    start: "No pudimos enviar tus datos. Inténtalo de nuevo o ",
    whatsappLink: "escríbenos por WhatsApp",
    end: ".",
  },
} as const;
