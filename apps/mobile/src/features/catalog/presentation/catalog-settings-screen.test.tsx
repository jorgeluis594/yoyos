import { Alert, Linking, Share } from "react-native";
import { act, fireEvent, render } from "@testing-library/react-native";
import { err, ok } from "@shared/functional";
import { catalogSettings } from "@mobile/features/catalog/composition";
import CatalogSettingsScreen from "@mobile/features/catalog/presentation/catalog-settings-screen";
import "@mobile/i18n";

jest.mock("@mobile/features/catalog/composition", () => ({ catalogSettings: { get: jest.fn(), setPublished: jest.fn() } }));
jest.mock("react-native-safe-area-context", () => ({ SafeAreaView: jest.requireActual("react-native").View }));
const get = jest.mocked(catalogSettings.get);
const setPublished = jest.mocked(catalogSettings.setPublished);
const url = "https://yoyos.test/catalogo/00000000-0000-4000-8000-000000000001";
beforeEach(() => { get.mockReset(); setPublished.mockReset(); });

test("catalog settings screen restores the switch when saving fails", async () => {
  get.mockResolvedValue(ok({ published: false, url }));
  setPublished.mockResolvedValueOnce(err({ code: "NETWORK_ERROR", message: "offline" }))
    .mockResolvedValueOnce(ok({ published: true, url }));
  const screen = render(<CatalogSettingsScreen />);
  fireEvent(await screen.findByLabelText("Publicar catálogo", {}, { timeout: 5000 }), "valueChange", true);
  await screen.findByText("No pudimos guardar el cambio");
  expect(screen.getByLabelText("Publicar catálogo").props.value).toBe(false);
  expect(screen.queryByText(url)).toBeNull();

  fireEvent.press(screen.getByText("Reintentar"));
  await screen.findByText("Catálogo publicado");
  expect(screen.getByLabelText("Publicar catálogo").props.value).toBe(true);
  expect(screen.getByText(url)).toBeTruthy();
  expect(setPublished).toHaveBeenLastCalledWith(true);
});

test("hiding the catalog asks for confirmation before saving", async () => {
  get.mockResolvedValue(ok({ published: true, url }));
  setPublished.mockResolvedValueOnce(ok({ published: false, url }));
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  const screen = render(<CatalogSettingsScreen />);
  fireEvent(await screen.findByLabelText("Publicar catálogo", {}, { timeout: 5000 }), "valueChange", false);
  expect(setPublished).not.toHaveBeenCalled();
  const buttons = alert.mock.calls[0][2] ?? [];
  expect(alert.mock.calls[0][0]).toBe("¿Ocultar tu catálogo?");
  act(() => buttons.find(button => button.text === "Ocultar catálogo")?.onPress?.());
  await screen.findByText("Catálogo oculto");
  expect(setPublished).toHaveBeenCalledWith(false);
  alert.mockRestore();
});

test("share and view failures do not leave unhandled rejections", async () => {
  get.mockResolvedValue(ok({ published: true, url }));
  const share = jest.spyOn(Share, "share").mockRejectedValue(new Error("cancelled"));
  const open = jest.spyOn(Linking, "openURL").mockRejectedValue(new Error("no browser"));
  const screen = render(<CatalogSettingsScreen />);
  fireEvent.press(await screen.findByText("Compartir", {}, { timeout: 5000 }));
  fireEvent.press(screen.getByText("Ver catálogo"));
  await act(async () => { await Promise.resolve(); });
  expect(share).toHaveBeenCalledWith({ message: url });
  expect(open).toHaveBeenCalledWith(url);
  share.mockRestore(); open.mockRestore();
});
