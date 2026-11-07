import { useEffect, useState, type ReactNode } from "react";
import { Alert } from "react-native";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { err, ok } from "@shared/functional";
import { addOption, applyBulk, createDraft, draftFromProduct, removeRow, removeValue, rowLabel, setRow, type EditorDraft } from "@shared/product-variants";
import CreateProductScreen from "@mobile/features/products/presentation/create-product-screen";
import ProductManagementScreen from "@mobile/features/products/presentation/product-management-screen";
import OptionsScreen from "@mobile/features/products/presentation/options-screen";
import VariantsScreen from "@mobile/features/products/presentation/variants-screen";
import { ProductEditorProvider, useProductEditor } from "@mobile/features/products/presentation/product-editor-state";

const mockCreate = jest.fn();
const mockSave = jest.fn();
const mockLoad = jest.fn();
const mockUpdate = jest.fn();
const mockStatus = jest.fn();
const mockDelete = jest.fn();
let mockOnline = true;
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockDiscard = jest.fn();
let mockProductDirty = false;
let mockOpen: (route: string | null) => void = () => {};
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const productId = id(900);

jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace, push: (path: unknown) => { mockPush(path); mockOpen("push"); }, canGoBack: () => false, back: () => { mockBack(); mockOpen(null); } }),
  useNavigation: () => ({ dispatch: jest.fn() }),
  useLocalSearchParams: () => ({ productId: "00000000-0000-4000-8000-000000000900" }),
}));
jest.mock("expo-router/react-navigation", () => ({ usePreventRemove: jest.fn() }));
jest.mock("expo-network", () => ({ getNetworkStateAsync: async () => ({ isConnected: mockOnline, isInternetReachable: mockOnline }) }));
jest.mock("expo-crypto", () => ({ randomUUID: () => "00000000-0000-4000-8000-000000000901" }));
jest.mock("react-native-safe-area-context", () => ({ SafeAreaView: jest.requireActual("react-native").View }));
jest.mock("@mobile/features/users/presentation/access-provider", () => ({ useAccess: () => ({ state: { status: "ready", company: { country: "PE" } } }) }));
jest.mock("@mobile/features/products/composition", () => ({
  products: {
    createProduct: (...args: unknown[]) => mockCreate(...args), saveProduct: (...args: unknown[]) => mockSave(...args),
    loadProduct: (...args: unknown[]) => mockLoad(...args), uploadImage: jest.fn(),
  },
  variants: {
    updateVariant: (...args: unknown[]) => mockUpdate(...args), changeStatus: (...args: unknown[]) => mockStatus(...args), deleteVariant: (...args: unknown[]) => mockDelete(...args),
  },
  productPrinting: {},
}));
jest.mock("@mobile/features/printing/presentation/print-provider", () => ({ usePrint: () => ({ startAttempt: jest.fn(), showPrinterPicker: jest.fn(), printerName: null }) }));
jest.mock("@mobile/features/products/presentation/use-product-navigation-guard", () => ({ useProductNavigationGuard: () => jest.fn() }));
jest.mock("@mobile/features/products/presentation/draft-guard", () => ({ useProductDraft: () => ({ discardVersion: 0, dirty: mockProductDirty, discard: mockDiscard }) }));
jest.mock("@expo/ui/community/menu", () => ({
  MenuView: ({ actions, onPressAction, children }: { actions: { id: string; title: string }[]; onPressAction: (event: { nativeEvent: { event: string } }) => void; children: ReactNode }) => {
    const mockReact = jest.requireActual("react");
    const mockRN = jest.requireActual("react-native");
    return mockReact.createElement(mockReact.Fragment, null, children, ...actions.map((action) => mockReact.createElement(
      mockRN.Pressable, { key: action.id, accessibilityRole: "button", accessibilityLabel: action.title, onPress: () => onPressAction({ nativeEvent: { event: action.id } }) },
      mockReact.createElement(mockRN.Text, null, action.title))));
  },
}));

const base = { sku: null, salePrice: 39.9, purchasePrice: null, stock: 4 };
const must = (edit: ReturnType<typeof addOption>) => { if (!edit.success) throw new Error(edit.error.code); return edit.data; };
const named = (start: number, names: string[]) => names.map((name, index) => ({ id: id(start + index), name }));
const polo = () => must(addOption(must(addOption(createDraft(base), { id: id(1), name: "Talla", values: named(10, ["S", "M", "L"]) })), { id: id(2), name: "Color", values: named(20, ["Negro", "Azul"]) }));

function Seed({ draft, children }: { draft: EditorDraft; children: ReactNode }) {
  const editor = useProductEditor();
  useEffect(() => { editor.reset(draft, "PEN"); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return editor.draft ? <>{children}</> : null;
}
const renderVariants = (draft: EditorDraft) => render(<ProductEditorProvider><Seed draft={draft}><VariantsScreen /></Seed></ProductEditorProvider>);
const checked = (name: string) => screen.getByRole("checkbox", { name: `Seleccionar ${name}` }).props.accessibilityState.checked;

beforeEach(() => { jest.clearAllMocks(); mockOpen = () => {}; mockProductDirty = false; mockOnline = true; });

/** A new product that holds a draft with options, as if edited on the Opciones screen. */
function SeededCreate({ draft }: { draft: EditorDraft }) {
  const editor = useProductEditor();
  const [route, setRoute] = useState<string | null>(null);
  useEffect(() => { mockOpen = (value) => setRoute(value); editor.reset(draft, "PEN"); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <><CreateProductScreen />{route ? <VariantsScreen /> : null}</>;
}

test("a rejected save marks rows and the product shows '2 con errores'", async () => {
  const draft = [0, 1].reduce((current, index) => setRow(current, current.rows[index].ref, { sku: "POLO-01" }), polo());
  mockCreate.mockResolvedValue(err({ code: "VALIDATION_ERROR", message: "x", issues: [
    { scope: "newVariant", index: 0, field: "sku", reason: "DUPLICATE_SKU" }, { scope: "newVariant", index: 1, field: "sku", reason: "DUPLICATE_SKU" },
  ] }));
  render(<ProductEditorProvider><SeededCreate draft={draft} /></ProductEditorProvider>);
  fireEvent.changeText(await screen.findByLabelText("Nombre *"), "Polo básico");
  await act(async () => fireEvent.press(screen.getByRole("button", { name: "Guardar" })));
  expect(await screen.findByText("Revisa 2 variantes marcadas.")).toBeTruthy();
  expect(screen.getByText("2 con errores")).toBeTruthy();
  fireEvent.press(screen.getByRole("button", { name: "Ver variantes" }));
  expect(screen.getAllByText("SKU en uso por otra variante")).toHaveLength(2);
});

test("a successful save shows the returned detail without another request", async () => {
  const colorId = id(20);
  const detail = (variants: number) => ({
    id: productId, name: "Camisa", currency: "PEN", photos: [], structureVersion: variants, options: [{ id: colorId, name: "Color", values: Array.from({ length: variants }, (_, index) => ({ id: id(30 + index), name: `C${index}` })) }],
    variants: Array.from({ length: variants }, (_, index) => ({ id: id(40 + index), qrCode: id(50 + index), combination: [{ optionId: colorId, valueId: id(30 + index) }], salePrice: { amount: 20, currency: "PEN" }, stock: 1, status: "active", hasOrders: false })),
  });
  mockLoad.mockResolvedValue(ok(detail(2)));
  mockSave.mockResolvedValue(ok({ product: detail(3), catalogEmptied: false }));
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  try {
    render(<ProductEditorProvider><ProductManagementScreen /></ProductEditorProvider>);
    fireEvent.changeText(await screen.findByLabelText("Nombre *"), "Camisa nueva");
    expect(screen.getByText("2 variantes")).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByRole("button", { name: "Guardar" })));
    expect(await screen.findByText("3 variantes")).toBeTruthy();
    expect(mockLoad).toHaveBeenCalledTimes(1);
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledWith("Cambios guardados", expect.any(String));
  } finally { alert.mockRestore(); }
});

const savedProduct = (): EditorDraft => ({ ...polo(), saved: true, rows: polo().rows.map((row, index) => ({ ...row, id: id(100 + index), original: { sku: null, salePrice: 39.9, purchasePrice: null, stock: row.stock } })) });

/** The product core would answer for a saved draft, so the inline editor has what the product screen published. */
function detailOf(draft: EditorDraft, patch: (index: number) => Record<string, unknown> = () => ({})) {
  return {
    id: productId, name: "Polo", currency: "PEN", photos: [], structureVersion: 1, hidden: false,
    options: draft.options.map((option) => ({ id: option.id, name: option.name, values: option.values.map((value) => ({ id: value.id, name: value.name })) })),
    variants: draft.rows.map((row, index) => ({
      id: row.id, qrCode: id(500 + index), combination: draft.options.map((option) => ({ optionId: option.id, valueId: row.combination[option.id] })), sku: row.sku,
      salePrice: { amount: row.salePrice, currency: "PEN" }, purchasePrice: row.purchasePrice === null ? null : { amount: row.purchasePrice, currency: "PEN" },
      stock: row.stock, status: row.status, hasOrders: row.hasOrders, ...patch(index),
    })),
  };
}
function Publish({ product, children }: { product: unknown; children: ReactNode }) {
  const editor = useProductEditor();
  useEffect(() => { editor.publish(product as never); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return editor.detail ? <>{children}</> : null;
}
const renderSaved = (draft: EditorDraft = savedProduct(), product: unknown = detailOf(draft)) =>
  render(<ProductEditorProvider><Seed draft={draft}><Publish product={product}><VariantsScreen /><Capture onEditor={(value) => { mockEditor = value; }} /></Publish></Seed></ProductEditorProvider>);
let mockEditor!: ReturnType<typeof useProductEditor>;
const open = (name: string) => fireEvent.press(screen.getByRole("button", { name: `Editar ${name}` }));
const answered = (draft: EditorDraft, index: number, patch: Record<string, unknown>) => ok(detailOf(draft, (position) => position === index ? patch : {}));
const typeStock = (value: string) => fireEvent.changeText(screen.getByLabelText("Stock"), value);

test("tapping a row expands its editor and collapses the open one", () => {
  renderSaved();
  expect(screen.getAllByRole("checkbox")).toHaveLength(6);
  open("S / Negro");
  expect(screen.getByRole("button", { name: "Editar S / Negro" }).props.accessibilityState.expanded).toBe(true);
  expect(screen.getByRole("button", { name: "Guardar variante" })).toBeTruthy();
  expect(screen.getAllByRole("button", { name: "Guardar variante" })).toHaveLength(1);
  open("M / Negro");
  expect(screen.getAllByRole("button", { name: "Guardar variante" })).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Editar S / Negro" }).props.accessibilityState.expanded).toBe(false);
  expect(mockPush).not.toHaveBeenCalled();
});

test("saving a changed stock sends only the stock and shows Variante guardada", async () => {
  const draft = savedProduct();
  mockUpdate.mockResolvedValue(answered(draft, 0, { stock: 7 }));
  renderSaved(draft);
  open("S / Negro");
  expect(screen.getByRole("button", { name: "Guardar variante" }).props.accessibilityState.disabled).toBe(true);
  typeStock("7");
  await act(async () => fireEvent.press(screen.getByRole("button", { name: "Guardar variante" })));
  expect(mockUpdate).toHaveBeenCalledWith(productId, id(100), { stock: 7 });
  expect(await screen.findByText("Variante guardada.")).toBeTruthy();
  expect(screen.getByText("7 en stock")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Editar S / Negro" }).props.accessibilityState.expanded).toBe(true);
});

test("a stock refusal shows its text under Stock", async () => {
  mockUpdate.mockResolvedValue(err({ code: "VALIDATION_ERROR", message: "x", issues: [{ field: "stock", reason: "INVALID_STOCK" }] }));
  renderSaved();
  open("S / Negro");
  typeStock("7");
  await act(async () => fireEvent.press(screen.getByRole("button", { name: "Guardar variante" })));
  expect(await screen.findByText("Ingresa un número entero no negativo.")).toBeTruthy();
  expect(screen.queryByText(/Revisa los datos/)).toBeNull();
  expect((screen.getByLabelText("Stock") as unknown as { props: { value: string } }).props.value).toBe("7");
});

test("an empty stock on a saved row is refused before sending", async () => {
  renderSaved();
  open("S / Negro");
  typeStock("");
  await act(async () => fireEvent.press(screen.getByRole("button", { name: "Guardar variante" })));
  expect(screen.getByText("Ingresa un número entero no negativo.")).toBeTruthy();
  expect(mockUpdate).not.toHaveBeenCalled();
});

test("an inline save keeps other rows' pending edits", async () => {
  const draft = savedProduct();
  mockUpdate.mockResolvedValue(answered(draft, 0, { stock: 7 }));
  renderSaved(draft);
  const other = draft.rows[1];
  act(() => mockEditor.setDraft(setRow(mockEditor.draft!, other.ref, { salePrice: 50 })));
  open("S / Negro");
  typeStock("7");
  await act(async () => fireEvent.press(screen.getByRole("button", { name: "Guardar variante" })));
  await screen.findByText("Variante guardada.");
  expect(mockEditor.draft!.rows[1].salePrice).toBe(50);
  expect(mockEditor.draft!.rows[0].original?.stock).toBe(7);
  expect(mockEditor.baseline!.rows[1].salePrice).toBe(39.9);
  expect(mockEditor.dirty).toBe(true);
});

test("deactivate keeps other rows' pending edits", async () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  try {
    const draft = savedProduct();
    mockStatus.mockResolvedValue(answered(draft, 0, { status: "inactive" }));
    renderSaved(draft);
  act(() => mockEditor.setDraft(setRow(mockEditor.draft!, draft.rows[1].ref, { salePrice: 50 })));
    open("S / Negro");
    fireEvent.press(screen.getByRole("button", { name: "Desactivar variante" }));
    await act(async () => { (alert.mock.calls[0][2] as { text: string; onPress?: () => void }[]).find((button) => button.text === "Desactivar")!.onPress!(); });
    expect(await screen.findByText("Variante desactivada.")).toBeTruthy();
    expect(mockStatus).toHaveBeenCalledWith(productId, id(100), "inactive");
    expect(mockEditor.draft!.rows[1].salePrice).toBe(50);
    expect(mockEditor.draft!.rows[0].status).toBe("inactive");
  } finally { alert.mockRestore(); }
});

test("offline and in-doubt never show «Variante guardada.»", async () => {
  mockUpdate.mockResolvedValue(err({ code: "NETWORK_ERROR", message: "x" }));
  renderSaved();
  open("S / Negro");
  typeStock("7");
  mockOnline = false;
  await act(async () => fireEvent.press(screen.getByRole("button", { name: "Guardar variante" })));
  expect(await screen.findByText("No se pudo guardar. Revisa tu conexión e inténtalo otra vez.")).toBeTruthy();
  expect(mockUpdate).not.toHaveBeenCalled();
  mockOnline = true;
  await act(async () => fireEvent.press(screen.getByRole("button", { name: "Guardar variante" })));
  expect(await screen.findByText("No se pudo confirmar si se guardó la variante. Inténtalo otra vez.")).toBeTruthy();
  expect(screen.queryByText("Variante guardada.")).toBeNull();
  expect(screen.getByRole("button", { name: "Guardar variante" }).props.accessibilityState.disabled).toBeFalsy();
  expect((screen.getByLabelText("Stock") as unknown as { props: { value: string } }).props.value).toBe("7");
});

test("tapping another row with typed changes asks to discard", () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  try {
    renderSaved();
    open("S / Negro");
    typeStock("7");
    open("M / Negro");
    expect(alert).toHaveBeenCalledWith("¿Descartar cambios?", "Se perderán los cambios que no guardaste.", expect.anything(), expect.anything());
    expect(screen.getByRole("button", { name: "Editar S / Negro" }).props.accessibilityState.expanded).toBe(true);
    act(() => { (alert.mock.calls[0][2] as { text: string; onPress?: () => void }[]).find((button) => button.text === "Descartar")!.onPress!(); });
    expect(screen.getByRole("button", { name: "Editar M / Negro" }).props.accessibilityState.expanded).toBe(true);
  } finally { alert.mockRestore(); }
});

test("a row with a pending bulk price shows it and saves it", async () => {
  const draft = savedProduct();
  mockUpdate.mockResolvedValue(answered(draft, 1, { salePrice: { amount: 50, currency: "PEN" } }));
  renderSaved(draft);
  act(() => mockEditor.setDraft(setRow(mockEditor.draft!, draft.rows[1].ref, { salePrice: 50 })));
  open(rowLabel(draft, draft.rows[1]));
  expect(screen.getByDisplayValue("50.00")).toBeTruthy();
  await act(async () => fireEvent.press(screen.getByRole("button", { name: "Guardar variante" })));
  expect(mockUpdate).toHaveBeenCalledWith(productId, id(101), { salePrice: 50 });
  expect(mockEditor.dirty).toBe(false);
});

test("delete is replaced by the pending-edits text while the product has pending edits", () => {
  const draft = savedProduct();
  const zero = { ...draft, rows: draft.rows.map((row) => ({ ...row, stock: 0, original: { ...row.original!, stock: 0 } })) };
  renderSaved(zero);
  open("S / Negro");
  expect(screen.getByRole("button", { name: "Eliminar variante" })).toBeTruthy();
  act(() => mockEditor.setDraft(setRow(mockEditor.draft!, zero.rows[1].ref, { salePrice: 50 })));
  expect(screen.queryByRole("button", { name: "Eliminar variante" })).toBeNull();
  expect(screen.getByText("Guarda o descarta los cambios del producto para eliminar esta variante.")).toBeTruthy();
});

test("deleting without pending edits removes the row and pins Variante eliminada", async () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  try {
    const draft = savedProduct();
    const zero = { ...draft, rows: draft.rows.map((row) => ({ ...row, stock: 0, original: { ...row.original!, stock: 0 } })) };
    const product = detailOf(zero);
    mockDelete.mockResolvedValue(ok({ ...product, variants: product.variants.slice(1) }));
    renderSaved(zero, product);
    open("S / Negro");
    fireEvent.press(screen.getByRole("button", { name: "Eliminar variante" }));
    await act(async () => { (alert.mock.calls[0][2] as { text: string; onPress?: () => void }[]).find((button) => button.text === "Eliminar variante")!.onPress!(); });
    expect(await screen.findByText("Variante eliminada.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Editar S / Negro" })).toBeNull();
    expect(mockDelete).toHaveBeenCalledWith(productId, id(100));
  } finally { alert.mockRestore(); }
});

test("only the expanded row renders an editor with 100 variants", () => {
  const colorId = id(20);
  const draft: EditorDraft = { ...createDraft(base), saved: true,
    options: [{ id: colorId, name: "Color", saved: true, marked: false, valueForExistingVariants: null, values: Array.from({ length: 100 }, (_, index) => ({ id: id(1000 + index), name: `C${index}`, saved: true, marked: false })) }],
    rows: Array.from({ length: 100 }, (_, index) => ({ ref: id(2000 + index), id: id(2000 + index), combination: { [colorId]: id(1000 + index) }, sku: null, salePrice: 10, purchasePrice: null, stock: 1,
      status: "active" as const, hasOrders: false, marked: false, copiedFromInactive: false, original: { sku: null, salePrice: 10, purchasePrice: null, stock: 1 } })) };
  renderSaved(draft);
  open("C0");
  expect(screen.getAllByLabelText(/^Precio de venta/)).toHaveLength(1);
});

test("editing the price of the selected variants replaces it only on them", () => {
  renderVariants(polo());
  fireEvent.press(screen.getByRole("button", { name: "L" }));
  fireEvent.press(screen.getByRole("button", { name: "Editar precio" }));
  expect(screen.getByText("Aplicar a las 2 seleccionadas (talla L).")).toBeTruthy();
  expect(screen.getByText("Reemplaza el valor actual de cada variante.")).toBeTruthy();
  fireEvent.changeText(screen.getByLabelText(/Editar precio de venta/), "42.90");
  fireEvent.press(screen.getByRole("button", { name: "Aplicar a 2" }));
  expect(screen.getAllByText(/^S\/\s?42\.90$/)).toHaveLength(2);
  expect(screen.getAllByText(/^S\/\s?39\.90$/)).toHaveLength(4);
});

test("a stock edit with saved variants selected applies to all of them", () => {
  const draft = polo();
  const saved: EditorDraft = { ...draft, saved: true, rows: draft.rows.map((row, index) => index < 4 ? { ...row, id: id(100 + index), original: { sku: null, salePrice: 39.9, purchasePrice: null, stock: row.stock } } : row) };
  renderVariants(saved);
  fireEvent.press(screen.getByRole("button", { name: "Todas" }));
  fireEvent.press(screen.getByRole("button", { name: "Editar stock" }));
  expect(screen.getByRole("button", { name: "Aplicar a 6" })).toBeTruthy();
});

test("a row removed from a new product is marked with Deshacer and leaves the counter", () => {
  const draft = polo();
  const removed = removeRow(draft, draft.rows[1].ref);
  if (!removed.success) throw new Error("remove");
  renderVariants(removed.data);
  expect(screen.getByText("5 de 100 variantes")).toBeTruthy();
  expect(screen.getByText("Se quitará")).toBeTruthy();
  expect(screen.getByRole("checkbox", { name: "Seleccionar M / Negro" }).props.accessibilityState.disabled).toBe(true);
  fireEvent.press(screen.getByRole("button", { name: "Deshacer" }));
  expect(screen.getByText("6 de 100 variantes")).toBeTruthy();
  expect(checked("M / Negro")).toBe(false);
});

test("a deactivated variant is shown as such and is never selected by a chip", () => {
  const product = { id: productId, name: "Polo", description: null, hidden: false, photos: [], currency: "PEN" as const, qrCode: id(1), createdAt: "", updatedAt: "", structureVersion: 1,
    options: [{ id: id(1), name: "Talla", values: named(10, ["S", "M"]) }],
    variants: named(10, ["S", "M"]).map((value, index) => ({ id: id(100 + index), combination: [{ optionId: id(1), valueId: value.id }], sku: null, salePrice: { amount: 10, currency: "PEN" as const }, purchasePrice: null, qrCode: id(200 + index), status: index === 1 ? "inactive" : "active", stock: 2, hasOrders: false })) };
  renderVariants(draftFromProduct(product));
  expect(screen.getByText("2 de 100 variantes · 1 desactivada")).toBeTruthy();
  fireEvent.press(screen.getByRole("button", { name: "Todas" }));
  expect([checked("S"), checked("M")]).toEqual([true, false]);
  expect(screen.getByRole("checkbox", { name: "Seleccionar M" }).props.accessibilityState.disabled).toBe(true);
});

function Capture({ onEditor }: { onEditor: (editor: ReturnType<typeof useProductEditor>) => void }) {
  onEditor(useProductEditor());
  return null;
}

test("a bulk price edit on the variant of a product that had no options survives the save", async () => {
  const simple = { id: productId, name: "Camisa", currency: "PEN", photos: [], structureVersion: 1, options: [],
    variants: [{ id: id(40), qrCode: id(50), combination: [], salePrice: { amount: 20, currency: "PEN" }, stock: 1, status: "active", hasOrders: false }] };
  mockLoad.mockResolvedValue(ok(simple));
  mockSave.mockResolvedValue(ok({ product: simple, catalogEmptied: false }));
  let editor!: ReturnType<typeof useProductEditor>;
  render(<ProductEditorProvider><ProductManagementScreen /><Capture onEditor={(value) => { editor = value; }} /></ProductEditorProvider>);
  await screen.findByLabelText("Nombre *");
  const withTalla = must(addOption(editor.draft!, { id: id(1), name: "Talla", values: named(10, ["S", "M"]), valueForExistingVariants: id(10) }));
  const edited = applyBulk(withTalla, [withTalla.rows[0].ref], { salePrice: 50 }).draft;
  act(() => editor.setDraft(edited));
  await act(async () => fireEvent.press(screen.getByRole("button", { name: "Guardar" })));
  expect(mockSave.mock.calls[0][0].draft.rows.find((row: { id: string | null }) => row.id === id(40)).salePrice).toBe(50);
});

test("a save rejected because a marked value now has orders shows the reason on the value in Opciones", async () => {
  const colorId = id(20);
  const saved = { id: productId, name: "Camisa", currency: "PEN", photos: [], structureVersion: 1, options: [{ id: colorId, name: "Color", values: [{ id: id(30), name: "Negro" }, { id: id(31), name: "Azul" }] }],
    variants: [30, 31].map((value, index) => ({ id: id(40 + index), qrCode: id(50 + index), combination: [{ optionId: colorId, valueId: id(value) }], salePrice: { amount: 20, currency: "PEN" }, stock: 0, status: "active", hasOrders: false })) };
  mockLoad.mockResolvedValue(ok(saved));
  mockSave.mockResolvedValue(err({ code: "VALIDATION_ERROR", message: "x", issues: [{ scope: "variant", variantId: id(41), field: "id", reason: "VARIANT_HAS_ORDERS" }] }));
  let editor!: ReturnType<typeof useProductEditor>;
  let showOptions: (show: boolean) => void = () => {};
  function Gate() { const [show, setShow] = useState(false); useEffect(() => { showOptions = setShow; }, []); return show ? <OptionsScreen /> : null; }
  render(<ProductEditorProvider><ProductManagementScreen /><Capture onEditor={(value) => { editor = value; }} /><Gate /></ProductEditorProvider>);
  await screen.findByLabelText("Nombre *");
  const marked = removeValue(editor.draft!, id(31));
  if (!marked.success) throw new Error("mark");
  act(() => editor.setDraft(marked.data));
  await act(async () => fireEvent.press(screen.getByRole("button", { name: "Guardar" })));
  expect(await screen.findByText("Revisa las opciones y valores marcados.")).toBeTruthy();
  expect(screen.queryByText("Revisa esta variante.")).toBeNull();
  act(() => showOptions(true));
  fireEvent.press(screen.getByRole("button", { name: "Editar Color" }));
  expect(screen.getByText("No se puede eliminar «Azul»: ahora tiene pedidos o stock.")).toBeTruthy();
  fireEvent.press(screen.getByRole("button", { name: "Deshacer" }));
  expect(screen.queryByText("No se puede eliminar «Azul»: ahora tiene pedidos o stock.")).toBeNull();
});

test("a cleared base price does not block saving once the product has options", async () => {
  const simple = { id: productId, name: "Camisa", currency: "PEN", photos: [], structureVersion: 1, options: [],
    variants: [{ id: id(40), qrCode: id(50), combination: [], salePrice: { amount: 20, currency: "PEN" }, stock: 1, status: "active", hasOrders: false }] };
  mockLoad.mockResolvedValue(ok(simple));
  mockSave.mockResolvedValue(ok({ product: simple, catalogEmptied: false }));
  let editor!: ReturnType<typeof useProductEditor>;
  render(<ProductEditorProvider><ProductManagementScreen /><Capture onEditor={(value) => { editor = value; }} /></ProductEditorProvider>);
  fireEvent.changeText(await screen.findByLabelText(/Precio de venta/), "");
  act(() => editor.setDraft(must(addOption(editor.draft!, { id: id(1), name: "Talla", values: named(10, ["S", "M"]), valueForExistingVariants: id(10) }))));
  await act(async () => fireEvent.press(screen.getByRole("button", { name: "Guardar" })));
  expect(mockSave).toHaveBeenCalledTimes(1);
});
