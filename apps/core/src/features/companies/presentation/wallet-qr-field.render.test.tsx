import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import i18n from "i18next";
import { expect, test } from "vitest";
import { WalletQrField, type WalletQrState } from "@core/src/features/companies/presentation/wallet-qr-field";
import resources from "@core/app/locales";

const html = async (state: WalletQrState, url = "https://images.test/qr.png") => {
  const instance = i18n.createInstance();
  await instance.init({ lng: "es", resources });
  return renderToStaticMarkup(<I18nextProvider i18n={instance}><WalletQrField state={state} url={url} onFile={() => {}} onRetry={() => {}} onRemove={() => {}} /></I18nextProvider>);
};

test("renders every field state with its text", async () => {
  expect(await html({ status: "empty" }, "")).toContain("Subir QR");
  expect(await html({ status: "checking", imageId: "a" })).toContain("Revisando QR…");
  expect(await html({ status: "valid", imageId: "a", origin: "chosen", fileName: "plin.jpg", size: 2500 })).toContain("plin.jpg · 3 KB");
  expect(await html({ status: "not_a_qr", imageId: "a" })).toContain("Esta imagen no es un código QR.");
  expect(await html({ status: "check_unavailable", imageId: "a" })).toContain("No pudimos revisar el QR. Inténtalo de nuevo.");
  expect(await html({ status: "unchecked", imageId: "a" })).toContain("hasta que la guardes con un QR válido.");
  expect(await html({ status: "unchecked", imageId: null }, "")).toContain("hasta que subas un QR válido.");
});

test("marks the empty qr field as invalid and keeps the help text visible", async () => {
  const empty = await html({ status: "empty" }, "");
  expect(empty).toContain('aria-invalid="true"');
  expect(empty).toContain("Obligatorio. Sube la captura del QR");
  expect(await html({ status: "valid", imageId: "a", origin: "saved" })).not.toContain('aria-invalid="true"');
  expect(await html({ status: "valid", imageId: "a", origin: "saved" })).toContain("Obligatorio. Sube la captura del QR");
});

test("shows the compact field row with a red box and the file name in the not-a-qr state", async () => {
  const markup = await html({ status: "not_a_qr", imageId: "a", fileName: "foto.jpg", size: 84_000 });
  expect(markup).toContain("foto.jpg · 84 KB");
  expect(markup).toMatch(/data-testid="wallet-qr-box"[^>]*aria-invalid="true"[^>]*class="[^"]*border-destructive/);
  expect(markup).not.toContain("max-h-48");
});
