import { useEffect, type ReactNode } from "react";
import { Alert } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { addOption, addValue, createDraft, type EditorDraft } from "@shared/product-variants";
import OptionsScreen from "@mobile/features/products/presentation/options-screen";
import { ProductEditorProvider, useProductEditor } from "@mobile/features/products/presentation/product-editor-state";

const mockBack = jest.fn();
const mockDispatch = jest.fn();
const mockPrevent = jest.fn();
let mockUuid = 0;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

jest.mock("expo-router", () => ({ useRouter: () => ({ back: mockBack }), useNavigation: () => ({ dispatch: mockDispatch }) }));
jest.mock("expo-router/react-navigation", () => ({ usePreventRemove: (prevent: boolean, callback: unknown) => mockPrevent(prevent, callback) }));
jest.mock("expo-crypto", () => ({ randomUUID: () => `00000000-0000-4000-8000-${String(1000 + ++mockUuid).padStart(12, "0")}` }));
jest.mock("react-native-safe-area-context", () => ({ SafeAreaView: jest.requireActual("react-native").View }));

function Seed({ draft, children }: { draft: EditorDraft; children: ReactNode }) {
  const editor = useProductEditor();
  useEffect(() => { editor.reset(draft, "PEN"); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return editor.draft ? <>{children}</> : null;
}
const renderOptions = (draft: EditorDraft) => render(<ProductEditorProvider><Seed draft={draft}><OptionsScreen /></Seed></ProductEditorProvider>);
const must = (edit: ReturnType<typeof addOption>) => { if (!edit.success) throw new Error(edit.error.code); return edit.data; };
const values = (prefix: number, names: string[]) => names.map((name, index) => ({ id: id(prefix + index), name }));
const base = { sku: null, salePrice: 10, purchasePrice: null, stock: 0 };
const tallaColor = () => {
  const talla = must(addOption(createDraft(base), { id: id(1), name: "Talla", values: values(10, ["S", "M", "L"]) }));
  return must(addOption(talla, { id: id(2), name: "Color", values: values(20, ["Negro", "Azul"]) }));
};

beforeEach(() => { jest.clearAllMocks(); mockUuid = 0; });

test("header Listo is disabled while an option has errors or the limit is exceeded", () => {
  const sizes = must(addOption(createDraft(base), { id: id(1), name: "Talla", values: values(10, ["XS", "S", "M", "L", "XL"]) }));
  const withColors = must(addOption(sizes, { id: id(2), name: "Color", values: values(20, ["Negro", "Azul", "Rojo", "Verde", "Gris", "Blanco"]) }));
  renderOptions(withColors);
  const header = () => screen.getAllByRole("button", { name: "Listo" })[0];
  expect(header().props.accessibilityState.disabled).toBe(false);

  fireEvent.press(screen.getByRole("button", { name: "Agregar otra opción" }));
  fireEvent.changeText(screen.getByLabelText("Nombre de la opción"), "Manga");
  for (const name of ["Corta", "Larga", "Tres cuartos", "Sisa"]) fireEvent.changeText(screen.getByLabelText("Agregar otro valor"), name);
  expect(screen.getByText(/Máximo 100 variantes/)).toBeTruthy();
  expect(screen.getByText(/Con estos valores serían 120 combinaciones \(5 tallas × 6 colores × 4 mangas\)\. Quita algún valor para continuar\./)).toBeTruthy();
  expect(header().props.accessibilityState.disabled).toBe(true);
  expect(screen.getAllByRole("button", { name: "Listo" })[1].props.accessibilityState.disabled).toBe(true);
});

test("a duplicated value is flagged next to its field and blocks Listo", () => {
  renderOptions(tallaColor());
  fireEvent.press(screen.getByRole("button", { name: "Editar Talla" }));
  fireEvent.changeText(screen.getByLabelText("M"), "S ");
  expect(screen.getByText("«S» ya está en esta opción.")).toBeTruthy();
  expect(screen.getAllByRole("button", { name: "Listo" })[0].props.accessibilityState.disabled).toBe(true);
  fireEvent.changeText(screen.getByLabelText("Nombre de la opción"), "");
  expect(screen.getByText("Escribe el nombre de la opción.")).toBeTruthy();
});

test("X after a change asks to discard", () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  try {
    renderOptions(tallaColor());
    expect(mockPrevent).toHaveBeenLastCalledWith(false, expect.any(Function));
    fireEvent.press(screen.getByRole("button", { name: "Editar Talla" }));
    fireEvent.changeText(screen.getByLabelText("Nombre de la opción"), "Tamaño");
    expect(mockPrevent).toHaveBeenLastCalledWith(true, expect.any(Function));
    fireEvent.press(screen.getByRole("button", { name: "Cerrar" }));
    expect(mockBack).toHaveBeenCalled();
    (mockPrevent.mock.lastCall![1] as (event: { data: { action: unknown } }) => void)({ data: { action: { type: "GO_BACK" } } });
    expect(alert).toHaveBeenCalledWith("¿Descartar cambios?", "Se perderán los cambios que no guardaste.", expect.anything(), expect.anything());
  } finally { alert.mockRestore(); }
});

test("removing a value marks it with Deshacer and the footer counts the combinations", () => {
  renderOptions(tallaColor());
  expect(screen.getByText("Hasta 3 opciones · Se crearán 6 variantes (máximo 100).")).toBeTruthy();
  fireEvent.press(screen.getByRole("button", { name: "Editar Color" }));
  fireEvent.press(screen.getByRole("button", { name: "Eliminar «Azul»" }));
  expect(screen.getByText("Azul se quitará al guardar")).toBeTruthy();
  expect(screen.getByText("Hasta 3 opciones · Se crearán 3 variantes (máximo 100).")).toBeTruthy();
  fireEvent.press(screen.getByRole("button", { name: "Deshacer" }));
  expect(screen.queryByText("Azul se quitará al guardar")).toBeNull();
  expect(screen.getByText("Hasta 3 opciones · Se crearán 6 variantes (máximo 100).")).toBeTruthy();
});

test("the handle offers Subir and Bajar, never Subir on the first item", () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  try {
    renderOptions(tallaColor());
    fireEvent.press(screen.getByRole("button", { name: "Mover «Talla», posición 1 de 2" }));
    expect((alert.mock.calls[0][2] as { text: string }[]).map((button) => button.text)).toEqual(["Bajar", "Cancelar"]);
    fireEvent.press(screen.getByRole("button", { name: "Mover «Color», posición 2 de 2" }));
    expect((alert.mock.calls[1][2] as { text: string }[]).map((button) => button.text)).toEqual(["Subir", "Cancelar"]);
  } finally { alert.mockRestore(); }
});

test("the third option replaces the add button with the maximum notice", () => {
  const three = must(addOption(tallaColor(), { id: id(3), name: "Manga", values: values(30, ["Corta"]) }));
  renderOptions(three);
  expect(screen.getByText("Llegaste al máximo de 3 opciones.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Agregar otra opción" })).toBeNull();
});

test("a saved product asks which value its current variants receive for a new option", () => {
  const saved: EditorDraft = { ...tallaColor(), saved: true, rows: tallaColor().rows.map((row, index) => ({ ...row, id: id(100 + index), original: { sku: null, salePrice: 10, purchasePrice: null } })) };
  renderOptions({ ...saved, options: saved.options.map((option) => ({ ...option, saved: true, values: option.values.map((value) => ({ ...value, saved: true })) })) });
  fireEvent.press(screen.getByRole("button", { name: "Agregar otra opción" }));
  fireEvent.changeText(screen.getByLabelText("Nombre de la opción"), "Manga");
  fireEvent.changeText(screen.getByLabelText("Agregar otro valor"), "Corta");
  fireEvent.changeText(screen.getByLabelText("Agregar otro valor"), "Larga");
  expect(screen.getByText("Valor de Manga para las 6 variantes actuales")).toBeTruthy();
  expect(screen.getByText("Conservan su QR, stock y pedidos. Solo se crean las combinaciones nuevas con «Larga».")).toBeTruthy();
});

test("adding a value to an option keeps the typed text in the same field", () => {
  renderOptions(tallaColor());
  fireEvent.press(screen.getByRole("button", { name: "Editar Talla" }));
  fireEvent.changeText(screen.getByLabelText("Agregar otro valor"), "XL");
  expect(screen.getByLabelText("XL").props.value).toBe("XL");
  expect(screen.getByLabelText("Agregar otro valor").props.value).toBe("");
  expect(screen.getByText("Hasta 3 opciones · Se crearán 8 variantes (máximo 100).")).toBeTruthy();
  void addValue;
});

test("a collapsed card lists the same rejection of two values without repeating a React key", () => {
  const error = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    const draft = tallaColor();
    const reason = "Este valor no se puede eliminar.";
    const Errors = ({ children }: { children: ReactNode }) => {
      const editor = useProductEditor();
      useEffect(() => { editor.setErrors({ rows: {}, options: {}, values: { [id(10)]: reason, [id(11)]: reason } }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
      return <>{children}</>;
    };
    render(<ProductEditorProvider><Seed draft={draft}><Errors><OptionsScreen /></Errors></Seed></ProductEditorProvider>);
    expect(screen.getAllByText(reason)).toHaveLength(2);
    expect(error.mock.calls.filter((call) => String(call[0]).includes("same key"))).toEqual([]);
  } finally { error.mockRestore(); }
});
