// @vitest-environment jsdom
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createMemoryRouter, Link, RouterProvider } from "react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import resources from "@core/app/locales";
import { draftFromProduct } from "@shared/product-variants";
import type { ProductDetailResponse } from "@shared/contracts/products";
import { err, ok } from "@shared/functional";
import { ProductForm, type ProductFormProps } from "@core/src/features/products/presentation/product-form";

type Upload = { file: File; signal: AbortSignal | undefined; resolve: (result: unknown) => void };
const uploads = vi.hoisted((): Upload[] => []);
vi.mock("@core/src/shared/images/presentation/client", () => ({
  uploadImageFile: vi.fn((file: File, options?: { signal?: AbortSignal }) => new Promise((resolve) => { uploads.push({ file, signal: options?.signal, resolve }); })),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const i18n = createInstance();
await i18n.use(initReactI18next).init({ lng: "es", resources });
const i18nPt = createInstance();
await i18nPt.use(initReactI18next).init({ lng: "pt", resources });

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const savedPhotos = (count: number) => Array.from({ length: count }, (_, index) => ({ id: id(200 + index), url: `https://img.test/${index}.png` }));
const emptyProduct: ProductDetailResponse["product"] = {
  id: id(50), name: "Polo", description: null, photos: [], currency: "PEN", qrCode: id(51), createdAt: "2026-10-26T00:00:00.000Z", updatedAt: "2026-10-26T00:00:00.000Z", structureVersion: 1,
  options: [], variants: [{ id: id(60), combination: [], sku: null, salePrice: { amount: 10, currency: "PEN" }, purchasePrice: null, qrCode: id(70), status: "active", stock: 0, hasOrders: false }],
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  uploads.length = 0;
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:preview"), revokeObjectURL: vi.fn() }));
  Element.prototype.scrollIntoView = vi.fn();
  container = document.body.appendChild(document.createElement("div")); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });

const hostProps: { set: (props: Partial<ProductFormProps>) => void } = { set: () => undefined };
function Host({ initial }: { initial: Partial<ProductFormProps> }) {
  const [props, set] = useState(initial);
  useEffect(() => { hostProps.set = set; }, []);
  return <><ProductForm currency="PEN" cancelTo="/products" pending={false} onSave={() => undefined} {...props} /><Link to="/products">Salir</Link></>;
}
const update = (props: Partial<ProductFormProps>) => act(() => hostProps.set(props));

function mount(props: Partial<ProductFormProps> = {}, language: "es" | "pt" = "es") {
  const router = createMemoryRouter([
    { path: "/products/new", element: <Host initial={props} /> },
    { path: "/products", element: <p>Lista</p> },
  ], { initialEntries: ["/products/new"] });
  act(() => root.render(<I18nextProvider i18n={language === "es" ? i18n : i18nPt}><RouterProvider router={router} /></I18nextProvider>));
  return router;
}
const file = (name: string, size = 1000) => { const result = new File(["x"], name, { type: "image/png" }); Object.defineProperty(result, "size", { value: size }); return result; };
function select(...files: File[]) {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { value: files, configurable: true });
  act(() => { input.dispatchEvent(new Event("change", { bubbles: true })); });
}
const button = (name: string | RegExp) => [...container.querySelectorAll("button")].find((candidate) => {
  const label = candidate.getAttribute("aria-label");
  return name instanceof RegExp ? name.test(candidate.textContent ?? "") || name.test(label ?? "") : candidate.textContent?.trim() === name || label === name;
}) as HTMLButtonElement | undefined;
const click = (element: Element | undefined) => { act(() => (element as HTMLElement).click()); };
const thumbs = () => [...container.querySelectorAll<HTMLElement>("[data-photo]")];
const thumbText = (index: number) => thumbs()[index]?.textContent ?? "";
const names = () => thumbs().map((thumb) => thumb.querySelector("[role='group']")?.getAttribute("aria-label"));
const live = () => container.querySelector("[data-photo-live]")?.textContent ?? "";
const field = () => container.querySelector("[data-photos-field]")?.textContent ?? "";
const answer = async (index: number, result: unknown) => { await act(async () => { uploads[index].resolve(result); }); };
const done = (index: number) => ok({ id: id(300 + index), url: `https://img.test/new-${index}.png` });
const rejected = (code: string, status?: number) => err({ code, message: code, ...(status ? { status } : {}) });
const submit = () => click(button(/^Guardar/));
const lastSaved = (onSave: ReturnType<typeof vi.fn>) => onSave.mock.calls.at(-1)![0];

test("selecting three files shows three uploading thumbnails in order with the first as primary", () => {
  mount();
  expect(field()).toContain("Hasta 8 fotos. La primera es la principal.");
  select(file("frente.jpg"), file("espalda.jpg"), file("puesto.jpg"));
  expect(names()).toEqual(["Foto 1 de 3, principal, subiendo", "Foto 2 de 3, subiendo", "Foto 3 de 3, subiendo"]);
  expect(thumbText(0)).toContain("Principal");
  expect(thumbText(1)).not.toContain("Principal");
  expect(field()).toContain("3 de 8 fotos");
  expect(field()).not.toContain("Hasta 8 fotos");
  expect(uploads.map((upload) => upload.file.name)).toEqual(["frente.jpg", "espalda.jpg"]);
});

test("a product created before the change opens with its photo as 1 de 8 fotos and Principal", () => {
  mount({ photos: savedPhotos(1) });
  expect(field()).toContain("1 de 8 fotos");
  expect(names()).toEqual(["Foto 1 de 1, principal"]);
  expect(thumbText(0)).toContain("Principal");
});

test("a file over 10 MB fails at once with the weight text and is never uploaded", () => {
  mount();
  select(file("frente.jpg"), file("grande.jpg", 12_000_000), file("puesto.jpg"));
  expect(names()[1]).toBe("Foto 2 de 3, grande.jpg, no se subió: pesa más de 10 MB");
  expect(thumbText(1)).toContain("No se subió");
  expect(thumbText(1)).toContain("grande.jpg");
  expect(thumbText(1)).toContain("Pesa más de 10 MB.");
  expect(button("Reintentar la foto 2 de 3")).toBeUndefined();
  expect(button("Quitar la foto 2 de 3")).toBeDefined();
  expect(uploads.map((upload) => upload.file.name)).toEqual(["frente.jpg", "puesto.jpg"]);
});

test("a 413 for a file under 10 MB shows the dimensions text", async () => {
  mount();
  select(file("enorme.png", 6_000_000));
  await answer(0, rejected("IMAGE_TOO_LARGE", 413));
  expect(thumbText(0)).toContain("Supera 8000 px por lado o 24 MP.");
  expect(button(/Reintentar/)).toBeUndefined();
});

test("Guardar with a failed photo shows the retry-or-remove message, focuses it, and after Quitar saves the others", async () => {
  const onSave = vi.fn();
  mount({ onSave });
  select(file("frente.jpg"), file("grande.jpg", 12_000_000), file("puesto.jpg"));
  await answer(0, done(0)); await answer(1, done(2));
  submit();
  expect(onSave).not.toHaveBeenCalled();
  expect(field()).toContain("Reintenta o quita las fotos que no se subieron.");
  expect(document.activeElement).toBe(button("Quitar la foto 2 de 3"));
  click(button("Quitar la foto 2 de 3"));
  submit();
  expect(lastSaved(onSave).photos).toEqual({ kind: "set", photoIds: [id(300), id(302)] });
});

test("a connection failure keeps the photo in its place and Reintentar uploads it in the same position", async () => {
  mount();
  select(file("a.png"), file("b.png"), file("c.png"));
  await answer(0, done(0));
  await answer(1, rejected("INTERNAL_ERROR", 500));
  expect(names()[1]).toBe("Foto 2 de 3, b.png, no se subió: no se pudo subir. Revisa la conexión");
  click(button("Reintentar la foto 2 de 3"));
  expect(names()[1]).toBe("Foto 2 de 3, subiendo");
  expect(uploads.map((upload) => upload.file.name)).toEqual(["a.png", "b.png", "c.png", "b.png"]);
  await answer(2, done(2));
  await answer(3, done(1));
  expect(names()).toEqual(["Foto 1 de 3, principal", "Foto 2 de 3", "Foto 3 de 3"]);
  expect(thumbs()[1].querySelector("img")?.getAttribute("src")).toBe("https://img.test/new-1.png");
});

test("make primary moves focus to the remove button of the moved photo and announces it", async () => {
  mount();
  select(file("a.png"), file("b.png"), file("c.png"));
  await answer(0, done(0)); await answer(1, done(1)); await answer(2, done(2));
  click(button("Hacer principal la foto 3 de 3"));
  expect(thumbText(0)).toContain("Principal");
  expect(thumbs()[0].querySelector("img")?.getAttribute("src")).toBe("https://img.test/new-2.png");
  expect(document.activeElement).toBe(button("Quitar la foto 1 de 3"));
  expect(live()).toContain("Foto 1 de 3, ahora es la principal.");
});

test("removing a saved photo marks it Se eliminará with Deshacer and moves primary", () => {
  mount({ photos: savedPhotos(3) });
  click(button("Quitar la foto 1 de 3"));
  expect(thumbText(0)).toContain("Se eliminará");
  expect(thumbText(0)).not.toContain("Principal");
  expect(thumbText(1)).toContain("Principal");
  expect(names()[0]).toBe("Foto 1 de 3, se eliminará al guardar");
  expect(document.activeElement).toBe(button("Deshacer quitar la foto 1 de 3"));
  expect(live()).toContain("Foto 1 de 3 se eliminará al guardar. La foto 2 ahora es la principal.");
  expect(field()).toContain("3 de 8 fotos · 1 se eliminará");
  expect(button("Hacer principal la foto 1 de 3")).toBeUndefined();
});

test("removing a photo added in this session shows Se quitará and announces it", async () => {
  mount();
  select(file("a.png"), file("b.png"), file("c.png"));
  await answer(0, done(0)); await answer(1, done(1)); await answer(2, done(2));
  click(button("Quitar la foto 2 de 3"));
  expect(thumbText(1)).toContain("Se quitará");
  expect(live()).toContain("Foto 2 de 3 se quitará al guardar.");
  expect(field()).toContain("3 de 8 fotos · 1 se quitará");
});

test("Deshacer returns a marked first photo to primary and keeps the other edits", () => {
  const onSave = vi.fn();
  mount({ photos: savedPhotos(3), onSave });
  const name = container.querySelector<HTMLInputElement>("#name")!;
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "Polo nuevo"); name.dispatchEvent(new Event("input", { bubbles: true })); });
  click(button("Quitar la foto 1 de 3"));
  click(button("Deshacer quitar la foto 1 de 3"));
  expect(thumbText(0)).toContain("Principal");
  expect(thumbText(0)).not.toContain("Se eliminará");
  expect(document.activeElement).toBe(button("Quitar la foto 1 de 3"));
  expect(live()).toContain("Foto 1 de 3 se conservará. Ahora es la principal.");
  expect(container.querySelector<HTMLInputElement>("#name")!.value).toBe("Polo nuevo");
  submit();
  expect(lastSaved(onSave).photos).toEqual({ kind: "untouched" });
});

test("marking one of 8 saved photos does not bring back Agregar fotos until the save", () => {
  mount({ photos: savedPhotos(8) });
  expect(button("Agregar fotos")).toBeUndefined();
  expect(field()).toContain("Llegaste al máximo de 8 fotos.");
  click(button("Quitar la foto 8 de 8"));
  expect(button("Agregar fotos")).toBeUndefined();
  expect(field()).toContain("Llegaste al máximo de 8 fotos. Guarda los cambios para liberar lugar.");
});

test("selecting four files with two free places adds two and shows the notice before any upload ends", () => {
  mount({ photos: savedPhotos(6) });
  select(file("a.png"), file("b.png"), file("c.png"), file("d.png"));
  expect(thumbs()).toHaveLength(8);
  expect(field()).toContain("Elegiste 4 fotos y quedan 2 lugares. Se agregan las 2 primeras.");
  expect(field()).toContain("8 de 8 fotos");
  expect(button("Agregar fotos")).toBeUndefined();
  expect(uploads.map((upload) => upload.file.name)).toEqual(["a.png", "b.png"]);
});

test("with seven photos and three selected the notice uses the singular", () => {
  mount({ photos: savedPhotos(7) });
  select(file("a.png"), file("b.png"), file("c.png"));
  expect(field()).toContain("Elegiste 3 fotos y queda 1 lugar. Se agrega la primera.");
});

test("filling the last place replaces Agregar fotos with the limit text and moves focus to it", () => {
  mount({ photos: savedPhotos(7) });
  select(file("a.png"));
  expect(button("Agregar fotos")).toBeUndefined();
  const limit = container.querySelector("[data-photos-limit]")!;
  expect(limit.textContent).toBe("Llegaste al máximo de 8 fotos.");
  expect(document.activeElement).toBe(limit);
  expect(live()).toContain("Llegaste al máximo de 8 fotos.");
});

test("while an upload runs, Agregar fotos stays available and Guardar explains and sends nothing", () => {
  const onSave = vi.fn();
  mount({ onSave });
  select(file("a.png"));
  expect(button("Agregar fotos")).toBeDefined();
  expect(button(/^Guardar/)!.disabled).toBe(false);
  submit();
  expect(onSave).not.toHaveBeenCalled();
  expect(field()).toContain("Espera a que terminen de subir las fotos.");
  expect(document.activeElement).toBe(button("Cancelar la subida de la foto 1 de 1"));
});

test("primary stays on an uploading first photo and passes to the next after Quitar on its failure", async () => {
  mount();
  select(file("a.png"), file("b.png"));
  await answer(1, done(1));
  expect(thumbText(0)).toContain("Principal");
  expect(thumbText(1)).not.toContain("Principal");
  expect(button("Hacer principal la foto 2 de 2")).toBeDefined();
  await answer(0, rejected("INTERNAL_ERROR", 500));
  expect(thumbText(0)).toContain("Principal");
  click(button("Quitar la foto 1 de 2"));
  expect(names()).toEqual(["Foto 1 de 1, principal"]);
  expect(live()).toContain("Foto quitada. Queda 1 foto.");
});

test("an upload without answer for two minutes becomes a retryable failure", async () => {
  vi.useFakeTimers();
  mount();
  select(file("a.png"));
  await act(async () => { vi.advanceTimersByTime(119_000); });
  expect(thumbText(0)).toContain("Subiendo…");
  await act(async () => { vi.advanceTimersByTime(1_500); });
  expect(thumbText(0)).toContain("No se pudo subir. Revisa la conexión.");
  expect(uploads[0].signal?.aborted).toBe(true);
  expect(button("Reintentar la foto 1 de 1")).toBeDefined();
});

test("cancel upload removes the thumbnail, ignores the late answer, and Guardar saves the other photos", async () => {
  const onSave = vi.fn();
  mount({ onSave });
  select(file("a.png"), file("b.png"));
  click(button("Cancelar la subida de la foto 1 de 2"));
  expect(uploads[0].signal?.aborted).toBe(true);
  expect(names()).toEqual(["Foto 1 de 1, principal, subiendo"]);
  expect(document.activeElement).toBe(button("Cancelar la subida de la foto 1 de 1"));
  await answer(0, done(0));
  expect(names()).toEqual(["Foto 1 de 1, principal, subiendo"]);
  await answer(1, done(1));
  submit();
  expect(lastSaved(onSave).photos).toEqual({ kind: "set", photoIds: [id(301)] });
});

test("leaving with an upload in progress asks ¿Descartar cambios?", () => {
  mount();
  select(file("a.png"));
  click(container.querySelector("a")!);
  expect(document.body.textContent).toContain("¿Descartar cambios?");
});

test("leaving with only a failed photo asks ¿Descartar cambios?", async () => {
  mount();
  select(file("a.png"));
  await answer(0, rejected("INVALID_IMAGE", 422));
  click(container.querySelector("a")!);
  expect(document.body.textContent).toContain("¿Descartar cambios?");
});

test("Cancelar after adding a photo asks to discard and Descartar leaves the saved product unchanged", async () => {
  const router = mount({ photos: savedPhotos(1) });
  select(file("a.png"));
  await answer(0, done(0));
  click([...container.querySelectorAll("a")].find((link) => link.textContent === "Cancelar"));
  expect(document.body.textContent).toContain("¿Descartar cambios?");
  click([...document.querySelectorAll("button")].find((candidate) => candidate.textContent === "Descartar"));
  expect(router.state.location.pathname).toBe("/products");
});

test("a save that only changes the price omits photoIds", () => {
  const onSave = vi.fn();
  mount({ photos: savedPhotos(2), onSave, draft: draftFromProduct(emptyProduct) });
  const price = container.querySelector<HTMLInputElement>("#salePrice")!;
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(price, "12"); price.dispatchEvent(new Event("input", { bubbles: true })); });
  click(button("Hacer principal la foto 2 de 2"));
  click(button("Hacer principal la foto 2 de 2"));
  submit();
  expect(lastSaved(onSave).photos).toEqual({ kind: "untouched" });
});

const photoIssue = (index: number, reason: string) => ({ errors: {}, issues: [{ scope: "photo" as const, field: "photoIds", reason, message: "No pudimos usar esta foto. Quítala o súbela de nuevo.", index }] });

test("a save rejected with PHOTO_NOT_FOUND or DUPLICATE_PHOTO at index 1 marks the second sent photo", () => {
  mount({ photos: savedPhotos(3) });
  update({ photos: savedPhotos(3), feedback: photoIssue(1, "PHOTO_NOT_FOUND") });
  expect(thumbText(1)).toContain("No pudimos usar esta foto. Quítala o súbela de nuevo.");
  expect(thumbText(0)).not.toContain("No pudimos usar");
  expect(document.activeElement).toBe(thumbs()[1].querySelector("button"));
  click(button("Quitar la foto 2 de 3"));
  expect(thumbText(1)).not.toContain("No pudimos usar");
});

test("a save rejected with TOO_MANY_PHOTOS shows the field message with the form intact", () => {
  mount({ photos: savedPhotos(2), feedback: { errors: { photos: "Un producto puede tener hasta 8 fotos. Quita alguna y guarda de nuevo." }, issues: [] } });
  expect(field()).toContain("Un producto puede tener hasta 8 fotos. Quita alguna y guarda de nuevo.");
  expect(thumbs()).toHaveLength(2);
});

test("with the keyboard only, make primary, remove and save leave A, B, D, E and no action needs hover", async () => {
  const onSave = vi.fn();
  mount({ photos: savedPhotos(5), onSave });
  const [a, b, c, d, e] = savedPhotos(5).map((photo) => photo.id);
  const focus = (target: HTMLElement | undefined) => act(() => target!.focus());
  focus(button("Hacer principal la foto 3 de 5"));
  click(document.activeElement!);
  expect(document.activeElement).toBe(button("Quitar la foto 1 de 5"));
  expect(live()).toContain("Foto 1 de 5, ahora es la principal.");
  click(document.activeElement!);
  expect(document.activeElement).toBe(button("Deshacer quitar la foto 1 de 5"));
  expect(live()).toContain("Foto 1 de 5 se eliminará al guardar. La foto 2 ahora es la principal.");
  expect(thumbText(1)).toContain("Principal");
  expect(container.querySelector("[data-photo] [class*='group-hover']")).toBeNull();
  expect(button("Hacer principal la foto 2 de 5")).toBeUndefined();
  // C was moved first and removed, so the remaining order is A, B, D, E.
  submit();
  expect(lastSaved(onSave).photos).toEqual({ kind: "set", photoIds: [a, b, d, e] });
  expect(c).toBeDefined();
});

test("shows the Portuguese texts and singular counts", () => {
  mount({ photos: savedPhotos(1) }, "pt");
  expect(field()).toContain("Fotos");
  expect(field()).toContain("1 de 8 fotos");
  expect(button("Adicionar fotos")).toBeDefined();
  expect(thumbText(0)).toContain("Principal");
  click(button("Remover a foto 1 de 1"));
  expect(thumbText(0)).toContain("Será excluída");
  expect(field()).toContain("1 de 8 fotos · 1 será excluída");
  expect(live()).toContain("Foto 1 de 1 será excluída ao salvar.");
  select(file("a.png"));
  expect(names()[1]).toBe("Foto 2 de 2, principal, enviando");
});
