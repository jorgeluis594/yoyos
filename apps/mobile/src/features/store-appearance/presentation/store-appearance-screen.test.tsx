import { AccessibilityInfo, Alert, Platform, Text } from "react-native";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { err, ok } from "@shared/functional";
import { storeAppearance } from "@mobile/features/store-appearance/composition";
import { StoreAppearanceScreen } from "@mobile/features/store-appearance/presentation/store-appearance-screen";
import { catalogSettings } from "@mobile/features/catalog/composition";
import { CatalogPublicationCard } from "@mobile/features/catalog/presentation/catalog-publication-card";
import i18n from "@mobile/i18n";

const mockUsePreventRemove = jest.fn();
const mockShowConfirmation = jest.fn();
const mockDispatch = jest.fn();
jest.mock("expo-router", () => ({ useNavigation: () => ({ dispatch: mockDispatch }) }));
jest.mock("expo-router/react-navigation", () => ({ usePreventRemove: (...args: unknown[]) => mockUsePreventRemove(...args) }));
jest.mock("@mobile/components/ui/show-confirmation", () => ({ showConfirmation: (...args: unknown[]) => mockShowConfirmation(...args) }));
jest.mock("@mobile/shared/infrastructure/jpeg-fitting", () => ({ fitJpeg: jest.fn() }));
jest.mock("react-native-safe-area-context", () => ({ SafeAreaView: jest.requireActual("react-native").View }));
jest.mock("@mobile/features/store-appearance/composition", () => ({
  storeAppearance: { loadStoreAppearance: jest.fn(), saveStoreAppearance: jest.fn(), uploadStoreLogo: jest.fn(), pickLogo: jest.fn() },
}));
jest.mock("@mobile/features/catalog/composition", () => ({ catalogSettings: { get: jest.fn(), setPublished: jest.fn() } }));
const getPublication = jest.mocked(catalogSettings.get);
const setPublished = jest.mocked(catalogSettings.setPublished);
const load = jest.mocked(storeAppearance.loadStoreAppearance);
const saveAppearance = jest.mocked(storeAppearance.saveStoreAppearance);
const uploadLogo = jest.mocked(storeAppearance.uploadStoreLogo);
const pickLogo = jest.mocked(storeAppearance.pickLogo);
const logoId = "00000000-0000-4000-8000-000000000001";
const newLogoId = "00000000-0000-4000-8000-000000000002";
const asset = { uri: "file:///logo.png", width: 800, height: 400, mimeType: "image/png", fileName: "logo.png", fileSize: 1000, source: "library" } as const;
const readable = (theme: "classic" | "suave" | "noche", logo: { id: string; url: string | null } | null = null) => ({ kind: "readable" as const, appearance: { theme, logo } });
const publication = <Text>Tarjeta de publicación</Text>;

beforeEach(() => {
  getPublication.mockReset(); setPublished.mockReset();
  load.mockReset(); saveAppearance.mockReset(); uploadLogo.mockReset(); pickLogo.mockReset();
  mockUsePreventRemove.mockReset(); mockShowConfirmation.mockReset(); mockDispatch.mockReset();
});
afterEach(async () => { await i18n.changeLanguage("es"); });

async function open(state: Awaited<ReturnType<typeof load>>) {
  load.mockResolvedValue(state);
  const screen = render(<StoreAppearanceScreen publication={publication} />);
  await screen.findByText("Tema", {}, { timeout: 5000 });
  return screen;
}
const choose = (screen: ReturnType<typeof render>, name: string) => fireEvent.press(screen.getByRole("radio", { name: new RegExp(`^${name}\\.`) }));
/** Picks from the gallery through the source alert. */
async function pickFromGallery(screen: ReturnType<typeof render>, label: string) {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  fireEvent.press(screen.getByText(label));
  const gallery = alert.mock.calls[0][2]?.find(button => button.text === "Elegir de galería");
  alert.mockRestore();
  await act(async () => gallery?.onPress?.());
}

test("shows the save bar with Cambios sin guardar after choosing a theme and hides it after saving", async () => {
  const screen = await open(ok(readable("classic")));
  expect(screen.queryByText("Cambios sin guardar")).toBeNull();
  expect(screen.queryByText("Guardar cambios")).toBeNull();
  saveAppearance.mockResolvedValue(ok(readable("suave")));
  choose(screen, "Suave");
  expect(screen.getByText("Cambios sin guardar")).toBeTruthy();
  expect(mockUsePreventRemove).toHaveBeenLastCalledWith(true, expect.any(Function));
  fireEvent.press(screen.getByText("Guardar cambios"));
  await screen.findByText("Apariencia actualizada");
  expect(screen.queryByText("Cambios sin guardar")).toBeNull();
  expect(screen.queryByText("Guardar cambios")).toBeNull();
  expect(screen.queryByText("Descartar")).toBeNull();
  expect(mockUsePreventRemove).toHaveBeenLastCalledWith(false, expect.any(Function));
});

test("uses the saved appearance from the PUT response without reading again and announces Apariencia actualizada", async () => {
  const screen = await open(ok(readable("classic", { id: logoId, url: "https://img.test/a.png" })));
  saveAppearance.mockResolvedValue(ok(readable("suave", { id: logoId, url: "https://img.test/a.png" })));
  choose(screen, "Suave");
  fireEvent.press(screen.getByText("Guardar cambios"));
  const notice = await screen.findByText("Apariencia actualizada");
  expect(notice.props.accessibilityLiveRegion).toBe("polite");
  expect(saveAppearance).toHaveBeenCalledWith({ theme: "suave", logoImageId: logoId });
  expect(load).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("radio", { name: /^Suave\./ }).props.accessibilityState).toMatchObject({ checked: true });
  // Changing something else clears the notice.
  choose(screen, "Noche");
  expect(screen.queryByText("Apariencia actualizada")).toBeNull();
});

test("keeps the draft and offers Reintentar in the bar when the save fails", async () => {
  const screen = await open(ok(readable("classic")));
  saveAppearance.mockResolvedValueOnce(err({ code: "NETWORK_ERROR", message: "offline" })).mockResolvedValueOnce(ok(readable("noche")));
  choose(screen, "Noche");
  fireEvent.press(screen.getByText("Guardar cambios"));
  await screen.findByText("No pudimos guardar la apariencia. Conservamos tu borrador.");
  expect(screen.getByText("Cambios sin guardar")).toBeTruthy();
  expect(screen.getByRole("radio", { name: /^Noche\./ }).props.accessibilityState).toMatchObject({ checked: true });
  fireEvent.press(screen.getByText("Reintentar"));
  await screen.findByText("Apariencia actualizada");
  expect(saveAppearance).toHaveBeenNthCalledWith(2, { theme: "noche", logoImageId: null });
});

test("says which part to fix when the server rejects the theme or the logo", async () => {
  const screen = await open(ok(readable("classic")));
  saveAppearance.mockResolvedValueOnce(err({ code: "INVALID_IMAGE", message: "bad" })).mockResolvedValueOnce(err({ code: "INVALID_STORE_APPEARANCE", message: "bad" }));
  choose(screen, "Noche");
  fireEvent.press(screen.getByText("Guardar cambios"));
  await screen.findByText("No pudimos usar ese logo. Súbelo de nuevo.");
  expect(screen.queryByText("Reintentar")).toBeNull();
  fireEvent.press(screen.getByText("Guardar cambios"));
  await screen.findByText("Revisa el tema e inténtalo de nuevo.");
});

test("asks before leaving the settings stack with unsaved changes and not when switching tabs", async () => {
  const screen = await open(ok(readable("classic")));
  choose(screen, "Noche");
  const [prevent, onPrevent] = mockUsePreventRemove.mock.calls.at(-1) ?? [];
  expect(prevent).toBe(true);
  const action = { type: "GO_BACK" };
  onPrevent({ data: { action } });
  expect(mockShowConfirmation).toHaveBeenCalledWith(expect.objectContaining({ title: "Tienes cambios sin guardar", confirmLabel: "Descartar y salir", cancelLabel: "Seguir editando" }));
  mockShowConfirmation.mock.calls[0][0].onConfirm();
  expect(mockDispatch).toHaveBeenCalledWith(action);
  // Switching tabs keeps the screen mounted: nothing asks, and the draft stays.
  expect(screen.getByRole("radio", { name: /^Noche\./ }).props.accessibilityState).toMatchObject({ checked: true });
});

test("starts on Clásico without logo with the notice and only Guardar cambios for an unknown stored theme", async () => {
  const screen = await open(ok({ kind: "unknown_theme" }));
  expect(screen.getByText(/No pudimos usar tu apariencia guardada/)).toBeTruthy();
  expect(screen.getByRole("radio", { name: /^Clásico\./ }).props.accessibilityState).toMatchObject({ checked: true });
  expect(screen.getByText("Sin logo")).toBeTruthy();
  expect(screen.getByText("Guardar cambios").props).toBeTruthy();
  expect(screen.queryByText("Cambios sin guardar")).toBeNull();
  expect(screen.queryByText("Descartar")).toBeNull();
  expect(mockUsePreventRemove).toHaveBeenLastCalledWith(false, expect.any(Function));

  // After a change the usual draft applies; Descartar returns to Clásico and the notice stays.
  choose(screen, "Suave");
  expect(screen.getByText("Cambios sin guardar")).toBeTruthy();
  fireEvent.press(screen.getByText("Descartar"));
  expect(screen.getByRole("radio", { name: /^Clásico\./ }).props.accessibilityState).toMatchObject({ checked: true });
  expect(screen.getByText(/No pudimos usar tu apariencia guardada/)).toBeTruthy();
  expect(screen.queryByText("Descartar")).toBeNull();

  saveAppearance.mockResolvedValue(ok(readable("classic")));
  fireEvent.press(screen.getByText("Guardar cambios"));
  await screen.findByText("Apariencia actualizada");
  expect(saveAppearance).toHaveBeenCalledWith({ theme: "classic", logoImageId: null });
  expect(screen.queryByText(/No pudimos usar tu apariencia guardada/)).toBeNull();
  expect(screen.queryByText("Guardar cambios")).toBeNull();
});

test("keeps an unresolved stored logo id when saving only a theme change", async () => {
  const screen = await open(ok(readable("classic", { id: logoId, url: null })));
  expect(screen.getByText("Sin logo")).toBeTruthy();
  expect(screen.getByText("Subir logo")).toBeTruthy();
  expect(screen.queryByText("Quitar logo")).toBeNull();
  saveAppearance.mockResolvedValue(ok(readable("noche", { id: logoId, url: null })));
  choose(screen, "Noche");
  fireEvent.press(screen.getByText("Guardar cambios"));
  await screen.findByText("Apariencia actualizada");
  expect(saveAppearance).toHaveBeenCalledWith({ theme: "noche", logoImageId: logoId });
});

test("Quitar logo removes the logo from the draft and the save sends no logo id", async () => {
  const screen = await open(ok(readable("classic", { id: logoId, url: "https://img.test/a.png" })));
  expect(screen.getByLabelText("Logo de tu tienda")).toBeTruthy();
  fireEvent.press(screen.getByText("Quitar logo"));
  expect(screen.getByText("Sin logo")).toBeTruthy();
  expect(screen.getByText("Cambios sin guardar")).toBeTruthy();
  saveAppearance.mockResolvedValue(ok(readable("classic")));
  fireEvent.press(screen.getByText("Guardar cambios"));
  await screen.findByText("Apariencia actualizada");
  expect(saveAppearance).toHaveBeenCalledWith({ theme: "classic", logoImageId: null });
});

test("disables Guardar cambios while the logo uploads and keeps the theme list usable", async () => {
  const screen = await open(ok(readable("classic")));
  choose(screen, "Noche");
  pickLogo.mockResolvedValue(ok(asset));
  let finish: (value: Awaited<ReturnType<typeof uploadLogo>>) => void = () => undefined;
  uploadLogo.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  await pickFromGallery(screen, "Subir logo");
  expect(screen.getByText("Subiendo logo…")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Guardar cambios" }).props.accessibilityState).toMatchObject({ disabled: true });
  expect(screen.getByRole("button", { name: "Descartar" }).props.accessibilityState).toMatchObject({ disabled: true });
  choose(screen, "Suave");
  choose(screen, "Noche");
  expect(screen.getByRole("radio", { name: /^Noche\./ }).props.accessibilityState).toMatchObject({ checked: true });
  await act(async () => finish(ok({ id: newLogoId, url: "https://img.test/new.png" })));
  expect(screen.getByRole("button", { name: "Guardar cambios" }).props.accessibilityState).toMatchObject({ disabled: false });
  expect(screen.getByLabelText("Logo de tu tienda")).toBeTruthy();
  expect(screen.getByText("Cambiar")).toBeTruthy();
  saveAppearance.mockResolvedValue(ok(readable("noche", { id: newLogoId, url: "https://img.test/new.png" })));
  fireEvent.press(screen.getByText("Guardar cambios"));
  await screen.findByText("Apariencia actualizada");
  expect(saveAppearance).toHaveBeenCalledWith({ theme: "noche", logoImageId: newLogoId });
});

test("while saving, Guardando… disables the bar buttons, the logo actions and the theme list but not the publication", async () => {
  const screen = await open(ok(readable("classic", { id: logoId, url: "https://img.test/a.png" })));
  let finish: (value: Awaited<ReturnType<typeof saveAppearance>>) => void = () => undefined;
  saveAppearance.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  choose(screen, "Noche");
  fireEvent.press(screen.getByText("Guardar cambios"));
  const disabled = (name: string) => screen.getByRole("button", { name }).props.accessibilityState.disabled;
  expect(screen.getByRole("button", { name: "Guardando…" }).props.accessibilityState.disabled).toBe(true);
  expect(disabled("Descartar")).toBe(true);
  expect(disabled("Cambiar")).toBe(true);
  expect(disabled("Quitar logo")).toBe(true);
  expect(screen.getByRole("radio", { name: /^Suave\./ }).props.accessibilityState.disabled).toBe(true);
  expect(screen.getByText("Tarjeta de publicación")).toBeTruthy();
  await act(async () => finish(ok(readable("noche", { id: logoId, url: "https://img.test/a.png" }))));
  await screen.findByText("Apariencia actualizada");
});

test("a failed HEIC or camera conversion shows No pudimos subir el logo with Reintentar and keeps the theme", async () => {
  const screen = await open(ok(readable("classic")));
  choose(screen, "Noche");
  pickLogo.mockResolvedValue(ok({ ...asset, source: "camera" }));
  uploadLogo.mockResolvedValueOnce(err({ code: "UPLOAD_FAILED", message: "boom" })).mockResolvedValueOnce(ok({ id: newLogoId, url: "https://img.test/new.png" }));
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  fireEvent.press(screen.getByText("Subir logo"));
  const camera = alert.mock.calls[0][2]?.find(button => button.text === "Tomar foto");
  alert.mockRestore();
  await act(async () => camera?.onPress?.());
  await screen.findByText("No pudimos subir el logo. Inténtalo de nuevo.");
  expect(screen.getByRole("radio", { name: /^Noche\./ }).props.accessibilityState).toMatchObject({ checked: true });
  await act(async () => fireEvent.press(screen.getByText("Reintentar")));
  expect(uploadLogo).toHaveBeenCalledTimes(2);
  expect(uploadLogo).toHaveBeenLastCalledWith({ ...asset, source: "camera" });
  await waitFor(() => expect(screen.queryByText("No pudimos subir el logo. Inténtalo de nuevo.")).toBeNull());
});

test("shows the rejection text of a logo without Reintentar", async () => {
  const screen = await open(ok(readable("classic")));
  pickLogo.mockResolvedValue(ok(asset));
  for (const [code, text] of [["UNSUPPORTED_FORMAT", "Usa una imagen PNG, JPG o WEBP."], ["FILE_TOO_HEAVY", "El logo debe pesar hasta 10 MB."],
    ["DIMENSIONS_TOO_LARGE", "El logo es demasiado grande. Usa una imagen de hasta 8000 px por lado."]] as const) {
    uploadLogo.mockResolvedValueOnce(err({ code, message: code }));
    await pickFromGallery(screen, "Subir logo");
    expect(screen.getByText(text)).toBeTruthy();
    expect(screen.queryByText("Reintentar")).toBeNull();
  }
});

test("shows the appearance load error and keeps the publication card working", async () => {
  load.mockResolvedValueOnce(err({ code: "NETWORK_ERROR", message: "offline" })).mockResolvedValueOnce(ok(readable("classic")));
  const screen = render(<StoreAppearanceScreen publication={publication} />);
  await screen.findByText("No se pudo cargar la apariencia", {}, { timeout: 5000 });
  expect(screen.getByText("Tarjeta de publicación")).toBeTruthy();
  expect(screen.queryByText("Guardar cambios")).toBeNull();
  expect(screen.queryByText("Logo")).toBeNull();
  fireEvent.press(screen.getByText("Reintentar"));
  await screen.findByText("Logo");
  expect(screen.getByText("Tarjeta de publicación")).toBeTruthy();
});

test("announces the logo as Logo de tu tienda and shows the logo hint", async () => {
  const screen = await open(ok(readable("classic", { id: logoId, url: "https://img.test/a.png" })));
  expect(screen.getByLabelText("Logo de tu tienda")).toBeTruthy();
  expect(screen.getByText("PNG, JPG o WEBP hasta 10 MB, o una foto de tu galería o cámara. Tus clientes verán este logo en tu catálogo y en tu checkout.")).toBeTruthy();
});

test("announces the theme list as Temas de la tienda with each theme's selected state", async () => {
  const screen = await open(ok(readable("suave")));
  expect(screen.getByLabelText("Temas de la tienda").props.accessibilityRole).toBe("radiogroup");
  const radios = screen.getAllByRole("radio");
  expect(radios.map(radio => radio.props.accessibilityLabel.split(".")[0])).toEqual(["Clásico", "Boutique", "Antojo", "Suave", "Noche"]);
  expect(radios.map(radio => radio.props.accessibilityState.checked)).toEqual([false, false, false, true, false]);
  expect(radios[0].props.accessibilityLabel).toBe("Clásico. Blanco y negro, sobrio. El tema por defecto.");
});

test("shows every new text in Portuguese", async () => {
  await i18n.changeLanguage("pt-BR");
  const screen = await open(ok({ kind: "unknown_theme" }));
  expect(screen.getByText("Aparência da loja")).toBeTruthy();
  expect(screen.getByLabelText("Temas da loja").props.accessibilityRole).toBe("radiogroup");
  expect(screen.getByText("Salvar alterações")).toBeTruthy();
  expect(screen.getByText("Sem logo")).toBeTruthy();
  expect(screen.getByText(/Não foi possível usar sua aparência salva/)).toBeTruthy();
});

test("does not announce Subiendo logo… or lock saving while the picker is open or cancelled", async () => {
  const screen = await open(ok(readable("classic")));
  choose(screen, "Noche");
  let finish: (value: Awaited<ReturnType<typeof pickLogo>>) => void = () => undefined;
  pickLogo.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  fireEvent.press(screen.getByText("Subir logo"));
  const gallery = alert.mock.calls[0][2]?.find(button => button.text === "Elegir de galería");
  alert.mockRestore();
  await act(async () => { gallery?.onPress?.(); });
  expect(screen.queryByText("Subiendo logo…")).toBeNull();
  expect(screen.getByRole("button", { name: "Guardar cambios" }).props.accessibilityState).toMatchObject({ disabled: false });
  await act(async () => finish(ok(null)));
  expect(uploadLogo).not.toHaveBeenCalled();
});

test("a conversion that throws ends in No pudimos subir el logo with Reintentar and unlocks saving", async () => {
  // The real operations run on top of fakes for the device pieces, so the failure travels the whole path.
  const { createStoreAppearanceOperations } = jest.requireActual("@mobile/features/store-appearance/application/store-appearance");
  const { createLogoFiles } = jest.requireActual("@mobile/features/store-appearance/infrastructure/logo-upload");
  const fitJpeg = jest.requireMock("@mobile/shared/infrastructure/jpeg-fitting").fitJpeg as jest.Mock;
  fitJpeg.mockRejectedValue(new Error("manipulator failed"));
  const files = createLogoFiles(jest.fn());
  const operations = createStoreAppearanceOperations({ api: { get: jest.fn(), save: jest.fn() }, logo: files });
  uploadLogo.mockImplementation(operations.uploadStoreLogo);
  const screen = await open(ok(readable("classic")));
  choose(screen, "Noche");
  pickLogo.mockResolvedValue(ok({ ...asset, mimeType: "image/heic", fileName: "IMG.HEIC" }));
  await pickFromGallery(screen, "Subir logo");
  await screen.findByText("No pudimos subir el logo. Inténtalo de nuevo.");
  expect(screen.queryByText("Subiendo logo…")).toBeNull();
  expect(screen.getByText("Reintentar")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Guardar cambios" }).props.accessibilityState).toMatchObject({ disabled: false });
  expect(screen.getByRole("button", { name: "Subir logo" }).props.accessibilityState).toMatchObject({ disabled: false });
});

test("shows the publication load error inside its card and keeps logo and theme working", async () => {
  const url = "https://yoyos.test/catalogo/00000000-0000-4000-8000-000000000001";
  getPublication.mockResolvedValueOnce(err({ code: "NETWORK_ERROR", message: "offline" })).mockResolvedValueOnce(ok({ published: true, url }));
  load.mockResolvedValue(ok(readable("classic")));
  saveAppearance.mockResolvedValue(ok(readable("noche")));
  const screen = render(<StoreAppearanceScreen publication={<CatalogPublicationCard />} />);
  await screen.findByText("No pudimos cargar la configuración del catálogo", {}, { timeout: 5000 });
  // Logo and Tema load, change and save while the publication read has failed.
  await screen.findByText("Logo");
  choose(screen, "Noche");
  fireEvent.press(screen.getByText("Guardar cambios"));
  await screen.findByText("Apariencia actualizada");
  expect(saveAppearance).toHaveBeenCalledWith({ theme: "noche", logoImageId: null });
  expect(screen.getByText("No pudimos cargar la configuración del catálogo")).toBeTruthy();
  fireEvent.press(screen.getByText("Reintentar"));
  expect((await screen.findByLabelText("Publicar catálogo")).props.value).toBe(true);
});

describe("iOS VoiceOver announcements", () => {
  const originalOS = Platform.OS;
  afterEach(() => { Platform.OS = originalOS; });

  test("announces Apariencia actualizada and the save error on iOS", async () => {
    Platform.OS = "ios";
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => undefined);
    announce.mockClear();
    const screen = await open(ok(readable("classic")));
    expect(announce).not.toHaveBeenCalled();
    saveAppearance.mockResolvedValueOnce(err({ code: "NETWORK_ERROR", message: "offline" })).mockResolvedValueOnce(ok(readable("noche")));
    choose(screen, "Noche");
    fireEvent.press(screen.getByText("Guardar cambios"));
    await screen.findByText("No pudimos guardar la apariencia. Conservamos tu borrador.");
    expect(announce).toHaveBeenLastCalledWith("No pudimos guardar la apariencia. Conservamos tu borrador.");
    fireEvent.press(screen.getByText("Reintentar"));
    await screen.findByText("Apariencia actualizada");
    expect(announce).toHaveBeenLastCalledWith("Apariencia actualizada");
    expect(announce).toHaveBeenCalledTimes(2);
    announce.mockRestore();
  });

  test("does not announce by hand on Android, where the live region speaks", async () => {
    Platform.OS = "android";
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => undefined);
    announce.mockClear();
    const screen = await open(ok(readable("classic")));
    saveAppearance.mockResolvedValue(ok(readable("noche")));
    choose(screen, "Noche");
    fireEvent.press(screen.getByText("Guardar cambios"));
    await screen.findByText("Apariencia actualizada");
    expect(announce).not.toHaveBeenCalled();
    announce.mockRestore();
  });
});

describe("the seller can still hide the catalog while the appearance cannot be used", () => {
  const url = "https://yoyos.test/catalogo/00000000-0000-4000-8000-000000000001";
  async function hideFromCard(screen: ReturnType<typeof render>) {
    setPublished.mockResolvedValue(ok({ published: false, url }));
    fireEvent(await screen.findByLabelText("Publicar catálogo", {}, { timeout: 5000 }), "valueChange", false);
    expect(mockShowConfirmation).toHaveBeenCalledWith(expect.objectContaining({ title: "¿Ocultar tu catálogo?", confirmLabel: "Ocultar catálogo" }));
    await act(async () => mockShowConfirmation.mock.calls[0][0].onConfirm());
    await screen.findByText("Catálogo oculto");
    expect(setPublished).toHaveBeenCalledWith(false);
  }

  test("after the appearance read fails, the card hides the catalog and no appearance control is shown", async () => {
    getPublication.mockResolvedValue(ok({ published: true, url }));
    load.mockResolvedValue(err({ code: "NETWORK_ERROR", message: "offline" }));
    const screen = render(<StoreAppearanceScreen publication={<CatalogPublicationCard />} />);
    await screen.findByText("No se pudo cargar la apariencia", {}, { timeout: 5000 });
    await hideFromCard(screen);
    expect(screen.queryByText("Guardar cambios")).toBeNull();
    expect(screen.queryByText("Logo")).toBeNull();
    expect(saveAppearance).not.toHaveBeenCalled();
  });

  test("with an unknown stored theme, the card hides the catalog without touching the appearance", async () => {
    getPublication.mockResolvedValue(ok({ published: true, url }));
    load.mockResolvedValue(ok({ kind: "unknown_theme" }));
    const screen = render(<StoreAppearanceScreen publication={<CatalogPublicationCard />} />);
    await screen.findByText(/No pudimos usar tu apariencia guardada/, {}, { timeout: 5000 });
    await hideFromCard(screen);
    expect(saveAppearance).not.toHaveBeenCalled();
    expect(screen.queryByText("Cambios sin guardar")).toBeNull();
    expect(screen.getByText(/No pudimos usar tu apariencia guardada/)).toBeTruthy();
  });
});
