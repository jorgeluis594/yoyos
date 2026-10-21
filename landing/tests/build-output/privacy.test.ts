import { describe, expect, test } from "vitest";
import { readPage } from "./html";
import { phoneDisplay } from "./variants";

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
  "[NOMBRE DEL BANCO DE DATOS]",
  "[CÓDIGO DE INSCRIPCIÓN]",
];

const email = "hola@example.test";
const text = (node: { text: string } | null | undefined) => (node?.text ?? "").replace(/\s+/g, " ").trim();

function section(variant: "minimal" | "full", number: number): string {
  const policy = readPage(variant, "privacidad.html").querySelector("article");
  const headings = policy?.querySelectorAll("h2") ?? [];
  const start = headings[number - 1];
  const next = headings[number];
  const html = policy?.innerHTML ?? "";
  const from = html.indexOf(start?.outerHTML ?? "");
  const to = next ? html.indexOf(next.outerHTML) : html.length;
  return html.slice(from, to).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

describe("privacy policy", () => {
  test("/privacidad renders the policy with the configured phone display and the email placeholder", () => {
    const page = readPage("full", "privacidad.html");
    expect(page.querySelectorAll("h1").map(text)).toEqual(["Política de privacidad"]);
    expect(page.querySelectorAll("article h2").map(text)).toEqual(sectionTitles);
    const tables = page.querySelectorAll("article table");
    expect(tables.map((table) => table.querySelectorAll("thead th").map(text))).toEqual([
      ["Proveedor", "Para qué", "Dónde"],
      ["Derecho", "Plazo"],
    ]);
    expect(tables.map((table) => table.querySelectorAll("tbody tr").length)).toEqual([3, 3]);

    for (const number of [1, 7, 12]) {
      expect(section("full", number)).toContain(phoneDisplay);
      expect(section("full", number)).toContain(email);
      expect(section("full", number)).not.toContain("[CORREO]");
      expect(section("minimal", number)).toContain("[CORREO]");
      expect(section("minimal", number)).toContain("+51912345678");
    }
    expect(section("minimal", 4)).toContain("[CORREO]");
    expect(section("full", 4)).toContain(email);
    expect(readPage("full", "privacidad.html").querySelector(`a[href="mailto:${email}"]`)).not.toBeNull();
  });

  test("/privacidad keeps every bracketed placeholder of the approved text visible", () => {
    for (const variant of ["minimal", "full"] as const) {
      const body = text(readPage(variant, "privacidad.html").querySelector("article"));
      for (const placeholder of placeholders) expect(body).toContain(placeholder);
      expect(body).toContain("«[NOMBRE DEL BANCO DE DATOS]»");
    }
  });
});
