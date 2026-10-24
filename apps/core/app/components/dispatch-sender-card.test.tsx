import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import resources from "@core/app/locales";
import { DispatchSenderCard, draftOf, sameDraft } from "@core/app/components/dispatch-sender-card";

const i18n = createInstance();
await i18n.use(initReactI18next).init({ lng: "es", resources });
const render = (element: React.ReactElement) => renderToStaticMarkup(<I18nextProvider i18n={i18n}>{element}</I18nextProvider>);
const empty = { configured: { name: null, phone: null }, effective: { name: "Mi Negocio", phone: null } };
const configured = { configured: { name: "Fantastidog", phone: "977 000 111" }, effective: { name: "Fantastidog", phone: "977 000 111" } };

test("the card is the sender anchor, explains the fallback and shows the company name as placeholder", () => {
  const html = render(<DispatchSenderCard sender={empty} companyName="Mi Negocio" />);
  expect(html).toContain('id="sender"');
  expect(html).toContain("Remitente");
  expect(html).toContain("Aparece en tus rótulos de despacho. Si lo dejas vacío, usamos el nombre de tu negocio.");
  expect(html).toContain('placeholder="Mi Negocio"');
  expect(html).toContain('maxLength="120"');
  expect(html).toContain('maxLength="30"');
  expect(html).not.toContain("Guardando");
});

test("the card shows the configured values for editing", () => {
  const html = render(<DispatchSenderCard sender={configured} companyName="Mi Negocio" />);
  expect(html).toContain('value="Fantastidog"');
  expect(html).toContain('value="977 000 111"');
  expect(draftOf(configured)).toEqual({ name: "Fantastidog", phone: "977 000 111" });
});

test("a draft only counts as changed when its trimmed text differs", () => {
  expect(sameDraft({ name: " a ", phone: "" }, { name: "a", phone: " " })).toBe(true);
  expect(sameDraft({ name: "a", phone: "" }, { name: "a", phone: "1" })).toBe(false);
});
