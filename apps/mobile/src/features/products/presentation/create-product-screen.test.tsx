import { useEffect, useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { err, ok } from "@shared/functional";
import CreateProductScreen from "@mobile/features/products/presentation/create-product-screen";
import OptionsScreen from "@mobile/features/products/presentation/options-screen";
import VariantsScreen from "@mobile/features/products/presentation/variants-screen";
import { ProductEditorProvider } from "@mobile/features/products/presentation/product-editor-state";
import i18n from '@mobile/i18n';

let mockOnline = true;
const mockReplace = jest.fn();
const mockPush = jest.fn();
const mockBack = jest.fn();
let mockOpen: (route: string | null) => void = () => {};
let mockUuid = 0;
const renderScreen = () => render(<ProductEditorProvider><CreateProductScreen /></ProductEditorProvider>);

/** The create screen with the screens that open above it: push shows one, back returns to the form. */
function Flow() {
  const [route, setRoute] = useState<string | null>(null);
  useEffect(() => { mockOpen = setRoute; }, []);
  return <>
    <CreateProductScreen />
    {route === "/products/new/options" ? <OptionsScreen /> : null}
    {route === "/products/new/variants" ? <VariantsScreen /> : null}
  </>;
}
const renderFlow = () => render(<ProductEditorProvider><Flow /></ProductEditorProvider>);
const mockCreate = jest.fn();
const mockStartAttempt = jest.fn();
const productId = "00000000-0000-4000-8000-000000000001";

jest.mock("expo-network", () => ({ getNetworkStateAsync: async () => ({ isConnected: mockOnline, isInternetReachable: mockOnline }) }));
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace, push: (path: string) => { mockPush(path); mockOpen(path); }, canGoBack: () => false, back: () => { mockBack(); mockOpen(null); } }),
  useNavigation: () => ({ dispatch: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));
jest.mock("expo-router/react-navigation", () => ({ usePreventRemove: jest.fn() }));
jest.mock("expo-crypto", () => ({ randomUUID: () => `00000000-0000-4000-8000-${String(1000 + ++mockUuid).padStart(12, "0")}` }));
jest.mock("react-native-safe-area-context", () => ({ SafeAreaView: jest.requireActual("react-native").View }));
jest.mock("@mobile/features/users/presentation/access-provider", () => ({
  useAccess: () => ({ state: { status: "ready", company: { country: "PE" } } }),
}));
jest.mock("@mobile/features/products/composition", () => ({
  products: { createProduct: (...args: unknown[]) => mockCreate(...args), uploadImage: jest.fn() },
}));
jest.mock("@mobile/features/printing/presentation/print-provider", () => ({ usePrint: () => ({ startAttempt: mockStartAttempt }) }));
jest.mock("@mobile/features/products/presentation/use-product-navigation-guard", () => ({ useProductNavigationGuard: () => jest.fn() }));
jest.mock("@mobile/features/products/presentation/draft-guard", () => ({ useProductDraft: () => ({ discardVersion: 0 }) }));
jest.mock("@mobile/features/products/presentation/product-photo", () => ({ ProductPhoto: () => null }));

const fillForm = () => {
  fireEvent.changeText(screen.getByLabelText("Nombre *"), "Camisa");
  fireEvent.changeText(screen.getByLabelText(/Precio de venta/), "20");
};

beforeEach(() => { jest.clearAllMocks(); mockUuid = 0; mockOnline = true; });

test("save waits for confirmed creation, then opens the persisted product without printing", async () => {
  let confirm!: (value: ReturnType<typeof ok<string>>) => void;
  mockCreate.mockReturnValue(new Promise((resolve) => { confirm = resolve; }));
  renderScreen();
  fillForm();
  expect(screen.queryByRole("button", { name: "Imprimir etiqueta" })).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "Guardar" }));
  expect(mockReplace).not.toHaveBeenCalled();
  await act(async () => confirm(ok(productId)));
  expect(mockReplace).toHaveBeenCalledWith({ pathname: "/products/[productId]", params: { productId } });
  expect(mockStartAttempt).not.toHaveBeenCalled();
});

test("creation offline says it was not sent, keeps the draft and never calls core", async () => {
  mockOnline = false;
  renderScreen();
  fillForm();
  fireEvent.press(screen.getByRole("button", { name: "Guardar" }));
  await screen.findByText("No se pudo guardar. Revisa tu conexión e inténtalo otra vez.");
  expect(mockCreate).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Nombre *").props.value).toBe("Camisa");
  expect(screen.queryByRole("button", { name: "Imprimir etiqueta" })).toBeNull();
  expect(mockReplace).not.toHaveBeenCalled();
  expect(mockStartAttempt).not.toHaveBeenCalled();
});

test("creation sent whose answer is lost is in doubt, keeps the draft and retries with the same id", async () => {
  mockCreate.mockResolvedValueOnce(err({ code: "NETWORK_ERROR", message: "lost" })).mockResolvedValueOnce(ok(productId));
  renderScreen();
  fillForm();
  fireEvent.press(screen.getByRole("button", { name: "Guardar" }));
  await screen.findByText("No se pudo confirmar si se creó este producto. Revisa el catálogo antes de iniciar otra creación.");
  expect(screen.getByLabelText("Nombre *").props.value).toBe("Camisa");
  expect(mockReplace).not.toHaveBeenCalled();
  await act(async () => { fireEvent.press(screen.getByRole("button", { name: "Guardar" })); });
  expect(mockCreate).toHaveBeenCalledTimes(2);
  expect(mockCreate.mock.calls[1][0].id).toBe(mockCreate.mock.calls[0][0].id);
});

test("an offline retry after an in-doubt creation keeps the in-doubt warning and the same id", async () => {
  mockCreate.mockResolvedValueOnce(err({ code: "NETWORK_ERROR", message: "lost" })).mockResolvedValueOnce(ok(productId));
  renderScreen();
  fillForm();
  fireEvent.press(screen.getByRole("button", { name: "Guardar" }));
  await screen.findByText("No se pudo confirmar si se creó este producto. Revisa el catálogo antes de iniciar otra creación.");
  mockOnline = false;
  await act(async () => { fireEvent.press(screen.getByRole("button", { name: "Guardar" })); });
  expect(screen.getByText(/No se pudo confirmar si se creó este producto/)).toBeTruthy();
  expect(mockCreate).toHaveBeenCalledTimes(1);
  mockOnline = true;
  await act(async () => { fireEvent.press(screen.getByRole("button", { name: "Guardar" })); });
  expect(mockCreate.mock.calls[1][0].id).toBe(mockCreate.mock.calls[0][0].id);
});

test('new product form and validation are translated to Portuguese', async () => {
  await i18n.changeLanguage('pt-BR');
  try {
    const form = renderScreen();
    expect(screen.getByText('Novo produto')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('Informe o nome do produto.')).toBeTruthy();
    form.unmount();
  } finally {
    await i18n.changeLanguage('es');
  }
});

test("stock stepper adjusts the initial stock sent on creation", async () => {
  mockCreate.mockResolvedValue(ok(productId));
  renderScreen();
  fillForm();
  const decrease = screen.getByRole("button", { name: "Restar uno al stock" });
  expect(decrease.props.accessibilityState.disabled).toBe(true);
  fireEvent.press(screen.getByRole("button", { name: "Sumar uno al stock" }));
  fireEvent.press(screen.getByRole("button", { name: "Sumar uno al stock" }));
  fireEvent.press(decrease);
  expect(screen.getByLabelText("Stock inicial").props.value).toBe("1");
  await act(async () => fireEvent.press(screen.getByRole("button", { name: "Guardar" })));
  expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ draft: expect.objectContaining({ base: expect.objectContaining({ stock: 1, salePrice: 20 }) }) }));
});

test("close returns to the catalog", () => {
  renderScreen();
  fireEvent.press(screen.getByRole("button", { name: "Cerrar" }));
  expect(mockReplace).toHaveBeenCalledWith("/products");
});

const typeOption = (name: string, values: string[]) => {
  fireEvent.changeText(screen.getByLabelText("Nombre de la opción"), name);
  for (const value of values) fireEvent.changeText(screen.getByLabelText("Agregar otro valor"), value);
  fireEvent.press(screen.getAllByRole("button", { name: "Listo" })[1]);
};
const buildPolo = () => {
  renderFlow();
  fireEvent.changeText(screen.getByLabelText("Nombre *"), "Polo básico");
  fireEvent.changeText(screen.getByLabelText(/Precio de venta/), "39.90");
  fireEvent.changeText(screen.getByLabelText("Stock inicial"), "4");
  fireEvent.press(screen.getByRole("button", { name: "Agregar opciones como talla o color" }));
  typeOption("Talla", ["S", "M", "L"]);
  fireEvent.press(screen.getByRole("button", { name: "Agregar otra opción" }));
  typeOption("Color", ["Negro", "Azul"]);
  fireEvent.press(screen.getAllByRole("button", { name: "Listo" })[0]);
};

test("adding Talla and Color shows six combinations with copied price and stock notice", async () => {
  buildPolo();
  expect(mockPush).toHaveBeenCalledWith("/products/new/options");
  expect(screen.getByText("6 variantes")).toBeTruthy();
  expect(screen.getByText(/24 en stock · desde S\/\s?39\.90/)).toBeTruthy();
  expect(screen.queryByLabelText(/Precio de venta/)).toBeNull();
  expect(screen.getByText("Suma del stock de las variantes.")).toBeTruthy();
  fireEvent.press(screen.getByRole("button", { name: "Ver variantes" }));
  const labels = screen.getAllByRole("checkbox").map((box) => box.props.accessibilityLabel);
  expect(labels).toEqual(["S / Negro", "S / Azul", "M / Negro", "M / Azul", "L / Negro", "L / Azul"].map((name) => `Seleccionar ${name}`));
  expect(screen.getByText("Se copió el stock 4 a cada combinación. Corrige las que tengan otra cantidad.")).toBeTruthy();
  expect(screen.getAllByText(/^S\/\s?39\.90$/)).toHaveLength(6);
  mockCreate.mockResolvedValue(ok(productId));
  fireEvent.press(screen.getByRole("button", { name: "Volver" }));
  await act(async () => fireEvent.press(screen.getByRole("button", { name: "Guardar" })));
  const sent = mockCreate.mock.calls[0][0] as { draft: { rows: unknown[]; options: unknown[] } };
  expect(sent.draft.options).toHaveLength(2);
  expect(sent.draft.rows).toHaveLength(6);
});

test("chip L selects both L variants and tapping it again deselects them", () => {
  buildPolo();
  fireEvent.press(screen.getByRole("button", { name: "Ver variantes" }));
  const checked = (name: string) => screen.getByRole("checkbox", { name: `Seleccionar ${name}` }).props.accessibilityState.checked;
  fireEvent.press(screen.getByRole("button", { name: "L" }));
  expect([checked("L / Negro"), checked("L / Azul"), checked("S / Negro"), checked("M / Azul")]).toEqual([true, true, false, false]);
  expect(screen.getByRole("button", { name: "L" }).props.accessibilityState.selected).toBe(true);
  expect(screen.getAllByText("2 seleccionadas").length).toBeGreaterThan(0);
  fireEvent.press(screen.getByRole("button", { name: "L" }));
  expect([checked("L / Negro"), checked("L / Azul")]).toEqual([false, false]);
});
