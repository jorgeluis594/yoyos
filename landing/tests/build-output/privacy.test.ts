import { describe, expect, test } from "vitest";
import { readPage } from "./html";
import { phoneDisplay, whatsappNumber, type VariantName } from "./variants";

const sectionTitles = [
  "1. ¿Quién es responsable de tus datos?",
  "2. ¿Qué datos recogemos?",
  "3. ¿Para qué usamos tus datos?",
  "4. ¿Con qué base usamos tus datos?",
  "5. ¿Cuánto tiempo guardamos tus datos?",
  "6. ¿Quién más trata tus datos? (encargados y transferencias)",
  "7. Tus derechos (ARCO y otros)",
  "8. Banco de datos",
  "9. Seguridad",
  "10. Cookies y analítica",
  "11. Cambios a esta política",
  "12. Contacto",
];

const placeholders = [
  "[FECHA DE PUBLICACIÓN]",
  "[RAZÓN SOCIAL]",
  "[RUC]",
  "[DOMICILIO]",
  "[UBICACIÓN DEL SERVIDOR DEL CRM]",
  "[PROVEEDOR DE ALOJAMIENTO DE LA WEB]",
  "[PAÍSES DE LOS SERVIDORES]",
  "«[NOMBRE DEL BANCO DE DATOS]»",
  "[CÓDIGO DE INSCRIPCIÓN]",
];

const email = "hola@example.test";
const minimalPhone = `+${whatsappNumber}`;
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

function readPolicy(variant: VariantName) {
  const page = readPage(variant, "privacidad.html");
  const article = page.querySelector("article");
  const sections = (article?.innerHTML ?? "")
    .split("<h2")
    .slice(1)
    .map((html) => normalize(html.replace(/<[^>]+>/g, " ")));
  return { page, article, text: normalize(article?.text ?? ""), sections };
}

const minimal = readPolicy("minimal");
const full = readPolicy("full");

describe("privacy policy", () => {
  test("/privacidad renders the policy with the configured phone display and the email placeholder", () => {
    expect(full.page.querySelectorAll("h1").map((h1) => normalize(h1.text))).toEqual(["Política de privacidad"]);
    expect(full.page.querySelectorAll("article h2").map((h2) => normalize(h2.text))).toEqual(sectionTitles);
    const tables = full.page.querySelectorAll("article table");
    expect(tables.map((table) => table.querySelectorAll("thead th").map((th) => normalize(th.text)))).toEqual([
      ["Proveedor", "Para qué", "Dónde"],
      ["Derecho", "Plazo"],
    ]);
    expect(tables.map((table) => table.querySelectorAll("tbody tr").length)).toEqual([3, 3]);

    for (const number of [1, 4, 7, 12]) {
      expect(full.sections[number - 1]).toContain(email);
      expect(full.sections[number - 1]).not.toContain("[CORREO]");
      expect(minimal.sections[number - 1]).toContain("[CORREO]");
    }
    for (const number of [1, 7, 12]) {
      expect(full.sections[number - 1]).toContain(phoneDisplay);
      expect(minimal.sections[number - 1]).toContain(minimalPhone);
    }
    expect(full.page.querySelector(`article a[href="mailto:${email}"]`)).not.toBeNull();
    expect(minimal.page.querySelector('article a[href^="mailto:"]')).toBeNull();
  });

  test("/privacidad keeps the spaces around inline elements of the approved text", () => {
    for (const { text } of [minimal, full]) {
      expect(text).toContain("presentar un reclamo ante la Autoridad Nacional de Protección de Datos Personales (ANPD)");
      expect(text).toContain("Correo para temas de privacidad: ");
    }
  });

  test("/privacidad keeps every bracketed placeholder of the approved text visible", () => {
    for (const { text } of [minimal, full]) {
      for (const placeholder of placeholders) expect(text).toContain(placeholder);
    }
  });
});
