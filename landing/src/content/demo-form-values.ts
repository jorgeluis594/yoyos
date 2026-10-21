// Values of the form contract (landing-technical.md §8), apart from their labels so that the client script can
// validate them without bundling any copy.
export const rubroValues = ["ropa", "zapatillas", "joyeria_accesorios", "mascotas", "cosmeticos", "otro"] as const;
export type Rubro = (typeof rubroValues)[number];

export const contactMethodValues = ["whatsapp", "llamada"] as const;
export type ContactMethod = (typeof contactMethodValues)[number];
