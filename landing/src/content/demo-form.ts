// Stub owned by T2: it declares the option values of the form contract (landing-technical.md §8), which the
// analytics types need. T2 adds the field copy, messages and the rest of the form content here.
export const rubroOptions = [
  { value: "ropa", label: "Ropa" },
  { value: "zapatillas", label: "Zapatillas" },
  { value: "joyeria_accesorios", label: "Joyería y accesorios" },
  { value: "mascotas", label: "Mascotas" },
  { value: "cosmeticos", label: "Cosméticos" },
  { value: "otro", label: "Otro" },
] as const;

export type Rubro = (typeof rubroOptions)[number]["value"];

export const contactMethodOptions = [
  { value: "whatsapp", label: "Por WhatsApp" },
  { value: "llamada", label: "Por llamada" },
] as const;

export type ContactMethod = (typeof contactMethodOptions)[number]["value"];
