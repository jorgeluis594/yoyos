import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { expect, test } from "vitest";
import { companyLocale, isLocale, languageFromPath, localePrefix } from "@core/app/locale";
import { LocalizationContext, translate, useLocalization } from "@core/app/localization";
import { AuthForm } from "@core/app/components/auth-form";
import { ProductForm } from "@core/src/features/products/presentation/product-form";
import { createErrors } from "@core/src/features/products/presentation/messages";

function Links() {
  const { href, dateLocale } = useLocalization();
  return <a href={href("/login")}>{dateLocale}</a>;
}

test("accepts only Spanish and Portuguese routes for supported company countries", () => {
  for (const locale of ["es-PE", "es-BR", "pt-BR", "pt-PE"]) expect(isLocale(locale)).toBe(true);
  for (const locale of ["en-PE", "pt", "pt-PT", "pt-br", "es-PE/extra", ""]) expect(isLocale(locale)).toBe(false);
  expect(companyLocale("/pt-BR/products/new", "PE")).toBe("pt-PE");
  expect(companyLocale("/products/new", "BR")).toBe("es-BR");
  expect(languageFromPath("/pt-BR/orders")).toBe("pt");
  expect(localePrefix("/login")).toBe("");
});

test("renders translated auth and product labels with localized links on the server", () => {
  const html = renderToStaticMarkup(<MemoryRouter><LocalizationContext value="/pt-BR/register">
    <AuthForm mode="register" /><ProductForm currency="BRL" cancelTo="/pt-BR/products" errors={{ sku: "Este SKU ya está en uso." }} pending={false} onSave={() => {}} /><Links />
  </LocalizationContext></MemoryRouter>);
  for (const text of ["Criar conta", "Nome", "Senha", "Dados do produto", "Preço de venda (BRL)", "Salvar produto", "Este SKU já está em uso.", 'href="/pt-BR/login"', "pt-BR"]) expect(html).toContain(text);
  expect(html).not.toContain("Correo electrónico");
});

test("keeps Spanish as the default and interpolates data without translating it", () => {
  expect(translate("es", "Agregar {0}", ["Camisa"])).toBe("Agregar Camisa");
  expect(translate("pt", "Agregar {0}", ["Camisa {1}"])).toBe("Adicionar Camisa {1}");
  const html = renderToStaticMarkup(<MemoryRouter><AuthForm mode="login" /><Links /></MemoryRouter>);
  expect(html).toContain("Iniciar sesión");
  expect(html).toContain('href="/login"');
});

test("localizes validation parameters before rendering the error", () => {
  expect(createErrors({ code: "VALIDATION_ERROR", message: "Invalid", issues: [{ scope: "product", field: "name", reason: "TOO_LONG", maxLength: 200, message: "Invalid" }] }, "pt")).toEqual({ name: "O nome deve ter no máximo 200 caracteres." });
});
