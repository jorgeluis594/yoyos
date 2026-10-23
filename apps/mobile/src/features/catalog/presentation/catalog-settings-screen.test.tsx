import { Linking, Share } from "react-native";
import { act, fireEvent, render } from "@testing-library/react-native";
import { err, ok } from "@shared/functional";
import { catalogSettings } from "@mobile/features/catalog/composition";
import CatalogSettingsScreen from "@mobile/features/catalog/presentation/catalog-settings-screen";
import "@mobile/i18n";

const mockPush = jest.fn();
let mockRefocus: (() => void) | undefined;
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
  // Runs the effect on mount like a focused screen, and lets a test focus the screen again.
  useFocusEffect: (effect: () => void) => { jest.requireActual("react").useEffect(() => { mockRefocus = effect; effect(); }, [effect]); },
}));
jest.mock("@mobile/features/catalog/composition", () => ({ catalogSettings: { get: jest.fn(), setPublished: jest.fn() } }));
jest.mock("react-native-safe-area-context", () => ({ SafeAreaView: jest.requireActual("react-native").View }));
const get = jest.mocked(catalogSettings.get);
const url = "https://yoyos.test/catalogo/00000000-0000-4000-8000-000000000001";
const link = { subdomain: "fantasio", domain: "yoyos.lat", suggestion: null };
beforeEach(() => { get.mockReset(); mockPush.mockReset(); mockRefocus = undefined; });

test("Catálogo re-reads the publication on focus and never offers Compartir for a hidden catalog", async () => {
  get.mockResolvedValueOnce(ok({ published: true, url, ...link }));
  const screen = render(<CatalogSettingsScreen />);
  await screen.findByText("Compartir", {}, { timeout: 5000 });
  expect(screen.getByText("Para ocultar tu catálogo, ve a Apariencia de la tienda.")).toBeTruthy();

  // Hidden elsewhere: while it re-reads the last known state stays, and then the link goes away.
  let finish: (value: Awaited<ReturnType<typeof catalogSettings.get>>) => void = () => undefined;
  get.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  act(() => mockRefocus?.());
  expect(screen.getByText("Compartir")).toBeTruthy();
  await act(async () => finish(ok({ published: false, url, ...link })));
  expect(screen.queryByText("Compartir")).toBeNull();
  expect(screen.queryByText(url)).toBeNull();
  expect(screen.queryByText("Copiar link")).toBeNull();
  expect(screen.getByText("Tu catálogo está oculto. Publícalo desde Apariencia de la tienda.")).toBeTruthy();
});

test("keeps the last known state when the re-read on focus fails", async () => {
  get.mockResolvedValueOnce(ok({ published: true, url, ...link })).mockResolvedValueOnce(err({ code: "NETWORK_ERROR", message: "offline" }));
  const screen = render(<CatalogSettingsScreen />);
  await screen.findByText("Compartir", {}, { timeout: 5000 });
  await act(async () => mockRefocus?.());
  expect(screen.getByText("Compartir")).toBeTruthy();
});

test("Catálogo opens Apariencia de la tienda from the published and the hidden state", async () => {
  get.mockResolvedValueOnce(ok({ published: true, url, ...link }));
  const screen = render(<CatalogSettingsScreen />);
  fireEvent.press(await screen.findByText("Ir a Apariencia de la tienda", {}, { timeout: 5000 }));
  expect(mockPush).toHaveBeenLastCalledWith("/settings/appearance");
  get.mockResolvedValueOnce(ok({ published: false, url, ...link }));
  await act(async () => mockRefocus?.());
  fireEvent.press(screen.getByText("Ir a Apariencia de la tienda"));
  expect(mockPush).toHaveBeenCalledTimes(2);
});

test("shows the load error with Reintentar when the first read fails", async () => {
  get.mockResolvedValueOnce(err({ code: "NETWORK_ERROR", message: "offline" })).mockResolvedValueOnce(ok({ published: false, url, ...link }));
  const screen = render(<CatalogSettingsScreen />);
  await screen.findByText("No pudimos cargar la configuración del catálogo", {}, { timeout: 5000 });
  fireEvent.press(screen.getByText("Reintentar"));
  await screen.findByText("Tu catálogo está oculto. Publícalo desde Apariencia de la tienda.");
});

test("share and view failures do not leave unhandled rejections", async () => {
  get.mockResolvedValue(ok({ published: true, url, ...link }));
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
