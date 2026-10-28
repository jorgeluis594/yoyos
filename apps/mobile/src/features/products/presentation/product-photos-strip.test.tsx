import { useEffect } from "react";
import { AccessibilityInfo, Alert, StyleSheet, type AlertButton } from "react-native";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import * as ImagePicker from "expo-image-picker";
import { err, ok } from "@shared/functional";
import i18n from "@mobile/i18n";
import { ProductPhotosStrip } from "./product-photos-strip";
import { usePhotoField, type PhotoAsset, type PhotoFieldController, type SavedPhoto } from "./use-photo-field";

jest.mock("expo-image-picker", () => ({ requestCameraPermissionsAsync: jest.fn(), launchCameraAsync: jest.fn(), launchImageLibraryAsync: jest.fn() }));

type Answer = Awaited<ReturnType<Parameters<typeof usePhotoField>[0]["upload"]>>;
type Pending = { uri: string; resolve: (answer: Answer) => void };
let pending: Pending[] = [];
let busy = 0;
let peak = 0;
let controller: PhotoFieldController;
let alert: jest.SpyInstance;
const picker = ImagePicker as jest.Mocked<typeof ImagePicker>;

const upload = jest.fn((uri: string, { signal }: { signal: AbortSignal }) => new Promise<Answer>((resolve) => {
  busy += 1; peak = Math.max(peak, busy);
  const settle = (answer: Answer) => { busy -= 1; resolve(answer); };
  pending.push({ uri, resolve: settle });
  signal.addEventListener("abort", () => settle(err({ code: "ABORTED", message: "aborted" })));
}));
const prepare = async (asset: PhotoAsset) => ok(asset.uri);
const saved = (count: number): SavedPhoto[] => Array.from({ length: count }, (_, index) => ({ id: `saved-${index + 1}`, url: `https://cdn.example/${index + 1}.jpg` }));
const assets = (...names: string[]) => names.map((name) => ({ uri: `file:///${name}.jpg`, width: 100, height: 100 }));
const done = (n: number) => ok({ id: `new-${n}`, url: `https://cdn.example/new-${n}.jpg` });
const failure = (code: string, status?: number) => err({ code, message: code, ...(status ? { http: { status } } : {}) });

function Harness({ photos = [], disabled = false, send = upload }: { photos?: SavedPhoto[]; disabled?: boolean; send?: Parameters<typeof usePhotoField>[0]["upload"] }) {
  const field = usePhotoField({ upload: send, prepare, saved: photos });
  useEffect(() => { controller = field; });
  return <ProductPhotosStrip photos={field} disabled={disabled} />;
}
const settle = () => act(async () => {});
const buttons = (): AlertButton[] => alert.mock.calls.at(-1)?.[2] ?? [];
const pick = async (text: string) => { await act(async () => { buttons().find((button) => button.text === text)?.onPress?.(); }); };
const thumb = (label: string) => screen.getByLabelText(label);
const chooseFrom = async (source: "Elegir de galería" | "Tomar foto") => {
  fireEvent.press(screen.getByLabelText("Agregar fotos, Cámara o galería"));
  await pick(source);
};
const galleryReturns = (...names: string[]) => picker.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: assets(...names) } as never);

beforeEach(() => {
  jest.clearAllMocks();
  pending = []; busy = 0; peak = 0; upload.mockClear();
  alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
  jest.spyOn(AccessibilityInfo, "setAccessibilityFocus").mockImplementation(() => {});
  picker.requestCameraPermissionsAsync.mockResolvedValue({ granted: true } as never);
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

test("choosing three gallery photos and one camera photo adds four thumbnails in that order", async () => {
  render(<Harness />);
  galleryReturns("g1", "g2", "g3");
  await chooseFrom("Elegir de galería");
  picker.launchCameraAsync.mockResolvedValue({ canceled: false, assets: assets("c1") } as never);
  await chooseFrom("Tomar foto");
  await settle();
  expect(controller.field.photos.map((photo) => controller.previewOf(photo.key))).toEqual(["file:///g1.jpg", "file:///g2.jpg", "file:///g3.jpg", "file:///c1.jpg"]);
  expect(thumb("Foto 1 de 4, principal, subiendo")).toBeTruthy();
  expect(thumb("Foto 4 de 4, subiendo")).toBeTruthy();
});

test("a product created before the change shows its photo as 1 de 8 fotos and Principal", () => {
  render(<Harness photos={saved(1)} />);
  expect(screen.getByText("1 de 8 fotos")).toBeTruthy();
  expect(screen.getByText("Principal")).toBeTruthy();
});

test("the gallery picker is capped at the free places", async () => {
  render(<Harness photos={saved(5)} />);
  picker.launchImageLibraryAsync.mockResolvedValue({ canceled: true } as never);
  fireEvent.press(screen.getByLabelText("Agregar fotos, Cámara o galería"));
  expect(alert).toHaveBeenLastCalledWith("Fotos", "Puedes agregar 3 fotos más.", expect.anything());
  await pick("Elegir de galería");
  expect(picker.launchImageLibraryAsync).toHaveBeenCalledWith(expect.objectContaining({ allowsMultipleSelection: true, selectionLimit: 3, orderedSelection: true }));
});

test("the source sheet explains the limit on a product without photos and uses the singular", () => {
  const empty = render(<Harness />);
  fireEvent.press(screen.getByLabelText("Agregar fotos, Cámara o galería"));
  expect(alert).toHaveBeenLastCalledWith("Fotos", "Puedes agregar hasta 8 fotos. La primera es la principal.", expect.anything());
  empty.unmount();
  render(<Harness photos={saved(7)} />);
  fireEvent.press(screen.getByLabelText("Agregar fotos, Cámara o galería"));
  expect(alert).toHaveBeenLastCalledWith("Fotos", "Puedes agregar 1 foto más.", expect.anything());
});

test("a gallery that ignores the cap adds only the free places and shows the notice line", async () => {
  render(<Harness photos={saved(6)} />);
  galleryReturns("a", "b", "c", "d");
  await chooseFrom("Elegir de galería");
  expect(controller.field.photos).toHaveLength(8);
  expect(screen.getByText("Elegiste 4 fotos y quedan 2 lugares. Se agregan las 2 primeras.")).toBeTruthy();
  expect(screen.queryByLabelText("Agregar fotos, Cámara o galería")).toBeNull();
});

test("the notice line uses the singular with one free place", async () => {
  render(<Harness photos={saved(7)} />);
  galleryReturns("a", "b", "c");
  await chooseFrom("Elegir de galería");
  expect(screen.getByText("Elegiste 3 fotos y queda 1 lugar. Se agrega la primera.")).toBeTruthy();
});

test("make primary from the sheet moves the photo first, keeps the others' order and returns focus to it", async () => {
  jest.useFakeTimers();
  const handle = jest.requireActual("react-native");
  jest.spyOn(handle, "findNodeHandle").mockReturnValue(42);
  render(<Harness photos={saved(3)} />);
  fireEvent.press(thumb("Foto 3 de 3"));
  expect(alert).toHaveBeenLastCalledWith("Foto 3 de 3", undefined, expect.anything());
  expect(buttons().map((button) => button.text)).toEqual(["Hacer principal", "Quitar foto", "Cancelar"]);
  await pick("Hacer principal");
  expect(controller.field.photos.map((photo) => photo.key)).toEqual(["saved-3", "saved-1", "saved-2"]);
  expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith("Foto 1 de 3, ahora es la principal.");
  await act(async () => { jest.advanceTimersByTime(300); });
  expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenCalledWith(42);
});

test("Quitar foto on the primary marks it Se eliminará and moves Principal to the next without a dialog", async () => {
  render(<Harness photos={saved(3)} />);
  fireEvent.press(thumb("Foto 1 de 3, principal"));
  expect(buttons().map((button) => button.text)).toEqual(["Quitar foto", "Cancelar"]);
  await pick("Quitar foto");
  expect(alert).toHaveBeenCalledTimes(1);
  expect(thumb("Foto 1 de 3, se eliminará al guardar")).toBeTruthy();
  expect(thumb("Foto 2 de 3, principal")).toBeTruthy();
  expect(screen.getByText("Se eliminará")).toBeTruthy();
  expect(screen.getByText("3 de 8 fotos · 1 se eliminará")).toBeTruthy();
});

test("removing a photo added in this session shows Se quitará", async () => {
  render(<Harness photos={saved(1)} />);
  galleryReturns("a");
  await chooseFrom("Elegir de galería");
  await settle();
  await act(async () => { pending[0]?.resolve(done(1)); });
  fireEvent.press(thumb("Foto 2 de 2"));
  await pick("Quitar foto");
  expect(thumb("Foto 2 de 2, se quitará al guardar")).toBeTruthy();
  expect(screen.getByText("Se quitará")).toBeTruthy();
  expect(screen.getByText("2 de 8 fotos · 1 se quitará")).toBeTruthy();
  expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith("Foto 2 de 2 se quitará al guardar.");
});

test("Deshacer on a marked photo restores it in place and as primary when first", async () => {
  render(<Harness photos={saved(3)} />);
  fireEvent.press(thumb("Foto 1 de 3, principal"));
  await pick("Quitar foto");
  fireEvent.press(thumb("Foto 1 de 3, se eliminará al guardar"));
  expect(buttons().map((button) => button.text)).toEqual(["Deshacer", "Cancelar"]);
  await pick("Deshacer");
  expect(thumb("Foto 1 de 3, principal")).toBeTruthy();
  expect(thumb("Foto 2 de 3")).toBeTruthy();
  expect(controller.toSave()).toEqual({ kind: "untouched" });
});

test("a marked photo keeps its place until saving", async () => {
  render(<Harness photos={saved(8)} />);
  fireEvent.press(thumb("Foto 8 de 8"));
  await pick("Quitar foto");
  expect(thumb("Foto 8 de 8, se eliminará al guardar")).toBeTruthy();
  expect(controller.free).toBe(0);
  expect(screen.queryByLabelText("Agregar fotos, Cámara o galería")).toBeNull();
});

test("the add tile disappears at eight photos and the counter shows the limit, also with a marked photo", async () => {
  render(<Harness photos={saved(8)} />);
  expect(screen.queryByLabelText("Agregar fotos, Cámara o galería")).toBeNull();
  expect(screen.getByText("8 de 8 fotos. Llegaste al máximo.")).toBeTruthy();
  fireEvent.press(thumb("Foto 2 de 8"));
  await pick("Quitar foto");
  expect(screen.getByText("8 de 8 fotos · 1 se eliminará. Guarda para liberar lugar.")).toBeTruthy();
});

test("each thumbnail is announced with position, state and the actions hint", async () => {
  render(<Harness photos={saved(2)} />);
  galleryReturns("a");
  await chooseFrom("Elegir de galería");
  await settle();
  expect(thumb("Foto 1 de 3, principal").props.accessibilityHint).toBe("Abre las acciones de la foto");
  expect(thumb("Foto 2 de 3").props.accessibilityActions).toEqual([{ name: "makePrimary", label: "Hacer principal" }, { name: "remove", label: "Quitar foto" }]);
  expect(thumb("Foto 3 de 3, subiendo").props.accessibilityActions).toEqual([{ name: "cancelUpload", label: "Cancelar subida" }]);
  fireEvent(thumb("Foto 2 de 3"), "accessibilityAction", { nativeEvent: { actionName: "makePrimary" } });
  expect(controller.field.photos[0]?.key).toBe("saved-2");
});

test("tapping a failed thumbnail opens Foto 2 de 3 with the reason, Reintentar, Quitar and Cancelar", async () => {
  render(<Harness photos={saved(1)} />);
  galleryReturns("a", "b");
  await chooseFrom("Elegir de galería");
  await settle();
  await act(async () => { pending[0]?.resolve(failure("SERVICE_UNAVAILABLE")); });
  fireEvent.press(thumb("Foto 2 de 3, no se subió: No se pudo subir. Revisa la conexión."));
  expect(alert).toHaveBeenLastCalledWith("Foto 2 de 3", "No se pudo subir. Revisa la conexión.", expect.anything());
  expect(buttons().map((button) => button.text)).toEqual(["Reintentar", "Quitar", "Cancelar"]);
});

test("the line under the strip counts failed photos and takes precedence over the counter", async () => {
  render(<Harness />);
  galleryReturns("a", "b");
  await chooseFrom("Elegir de galería");
  await settle();
  await act(async () => { pending[0]?.resolve(failure("SERVICE_UNAVAILABLE")); });
  expect(screen.getByText("1 foto no se subió. Tócala para ver por qué.")).toBeTruthy();
  expect(screen.queryByText("2 de 8 fotos")).toBeNull();
  await act(async () => { pending[1]?.resolve(failure("SERVICE_UNAVAILABLE")); });
  expect(screen.getByText("2 fotos no se subieron. Tócalas para ver por qué.")).toBeTruthy();
});

test("a 413 answer shows the dimensions text", async () => {
  render(<Harness />);
  galleryReturns("a");
  await chooseFrom("Elegir de galería");
  await settle();
  await act(async () => { pending[0]?.resolve(failure("IMAGE_TOO_LARGE", 413)); });
  fireEvent.press(thumb("Foto 1 de 1, principal, no se subió: Supera 8000 px por lado o 24 MP."));
  expect(alert).toHaveBeenLastCalledWith("Foto 1 de 1", "Supera 8000 px por lado o 24 MP.", expect.anything());
  expect(buttons().map((button) => button.text)).toEqual(["Quitar", "Cancelar"]);
});

test("a connection failure keeps the photo in place and Reintentar keeps the order", async () => {
  render(<Harness />);
  galleryReturns("a", "b", "c");
  await chooseFrom("Elegir de galería");
  await settle();
  await act(async () => { pending[1]?.resolve(failure("NETWORK_ERROR")); });
  await act(async () => { pending[0]?.resolve(done(1)); });
  await act(async () => { pending[2]?.resolve(done(3)); });
  fireEvent.press(thumb("Foto 2 de 3, no se subió: No se pudo subir. Revisa la conexión."));
  await pick("Reintentar");
  await settle();
  await act(async () => { pending[3]?.resolve(done(2)); });
  expect(controller.toSave()).toEqual({ kind: "set", photoIds: ["new-1", "new-2", "new-3"] });
});

test("an upload without answer for two minutes becomes a retryable failure", async () => {
  jest.useFakeTimers();
  render(<Harness />);
  galleryReturns("a");
  await chooseFrom("Elegir de galería");
  await act(async () => { jest.advanceTimersByTime(119_000); });
  expect(thumb("Foto 1 de 1, principal, subiendo")).toBeTruthy();
  await act(async () => { jest.advanceTimersByTime(2_000); });
  fireEvent.press(thumb("Foto 1 de 1, principal, no se subió: No se pudo subir. Revisa la conexión."));
  expect(buttons().map((button) => button.text)).toEqual(["Reintentar", "Quitar", "Cancelar"]);
});

test("Cancelar subida removes the photo and Guardar saves the others", async () => {
  render(<Harness photos={saved(1)} />);
  galleryReturns("a", "b");
  await chooseFrom("Elegir de galería");
  await settle();
  fireEvent.press(thumb("Foto 2 de 3, subiendo"));
  expect(buttons().map((button) => button.text)).toEqual(["Cancelar subida", "Seguir subiendo"]);
  await pick("Cancelar subida");
  await act(async () => { pending[0]?.resolve(done(1)); });
  expect(controller.field.photos).toHaveLength(2);
  await act(async () => { pending[1]?.resolve(done(2)); });
  expect(controller.toSave()).toEqual({ kind: "set", photoIds: ["saved-1", "new-2"] });
  expect(controller.blocker()).toBeNull();
});

test("while an upload runs, the add tile stays and the field counts as unsaved", async () => {
  render(<Harness photos={saved(1)} />);
  galleryReturns("a");
  await chooseFrom("Elegir de galería");
  await settle();
  expect(screen.getByLabelText("Agregar fotos, Cámara o galería")).toBeTruthy();
  expect(controller.unsaved).toBe(true);
  expect(controller.blocker()).toMatchObject({ kind: "uploading" });
});

test("Principal stays on an uploading first photo and passes to the next after Quitar on its failure", async () => {
  render(<Harness />);
  galleryReturns("a", "b");
  await chooseFrom("Elegir de galería");
  await settle();
  await act(async () => { pending[1]?.resolve(done(2)); });
  expect(thumb("Foto 1 de 2, principal, subiendo")).toBeTruthy();
  fireEvent.press(thumb("Foto 2 de 2"));
  expect(buttons().map((button) => button.text)).toEqual(["Hacer principal", "Quitar foto", "Cancelar"]);
  await act(async () => { pending[0]?.resolve(failure("INTERNAL_ERROR")); });
  expect(thumb("Foto 1 de 2, principal, no se subió: No se pudo subir. Revisa la conexión.")).toBeTruthy();
  fireEvent.press(thumb("Foto 1 de 2, principal, no se subió: No se pudo subir. Revisa la conexión."));
  await pick("Quitar");
  expect(thumb("Foto 1 de 1, principal")).toBeTruthy();
});

test("at most two photos are prepared or uploading at once", async () => {
  render(<Harness />);
  galleryReturns("a", "b", "c", "d");
  await chooseFrom("Elegir de galería");
  await settle();
  expect(pending).toHaveLength(2);
  await act(async () => { pending[0]?.resolve(done(1)); });
  expect(pending).toHaveLength(3);
  await act(async () => { pending[1]?.resolve(done(2)); pending[2]?.resolve(done(3)); });
  await act(async () => { pending[3]?.resolve(done(4)); });
  expect(peak).toBe(2);
  expect(controller.toSave()).toEqual({ kind: "set", photoIds: ["new-1", "new-2", "new-3", "new-4"] });
});

test("resetting the field drops uploads in progress and leaves the product as saved", async () => {
  render(<Harness photos={saved(1)} />);
  galleryReturns("a");
  await chooseFrom("Elegir de galería");
  await settle();
  await act(async () => { controller.reset(saved(1)); });
  await act(async () => { pending[0]?.resolve(done(1)); });
  expect(controller.field.photos).toHaveLength(1);
  expect(controller.unsaved).toBe(false);
});

test("a denied camera permission keeps the form and leaves the gallery available", async () => {
  picker.requestCameraPermissionsAsync.mockResolvedValue({ granted: false } as never);
  render(<Harness />);
  await chooseFrom("Tomar foto");
  expect(alert).toHaveBeenLastCalledWith("Permiso de cámara", "Puedes continuar y elegir una foto de la galería.");
  expect(picker.launchCameraAsync).not.toHaveBeenCalled();
});

test("shows the Portuguese texts and singular counts", async () => {
  await i18n.changeLanguage("pt-BR");
  try {
    render(<Harness photos={saved(1)} />);
    expect(screen.getByLabelText("Adicionar fotos, Câmera ou galeria")).toBeTruthy();
    expect(screen.getByText("1 de 8 fotos")).toBeTruthy();
    galleryReturns("a");
    fireEvent.press(screen.getByLabelText("Adicionar fotos, Câmera ou galeria"));
    expect(alert).toHaveBeenLastCalledWith("Fotos", "Você pode adicionar mais 7 fotos.", expect.anything());
    await pick("Escolher da galeria");
    await settle();
    await act(async () => { pending[0]?.resolve(failure("INTERNAL_ERROR")); });
    expect(screen.getByText("1 foto não foi enviada. Toque nela para ver o motivo.")).toBeTruthy();
    expect(screen.getByLabelText("Foto 2 de 2, não enviada: Não foi possível enviar. Verifique a conexão.")).toBeTruthy();
  } finally { await act(async () => { await i18n.changeLanguage("es"); }); }
});

test("the band keeps the app's small text size and may wrap instead of shrinking", () => {
  render(<Harness photos={saved(2)} />);
  const style = StyleSheet.flatten(screen.getByText("Principal").props.style);
  expect(style.fontSize).toBe(14);
  expect(screen.getByText("Principal").props.numberOfLines).toBeUndefined();
});

test("an upload that never settles still fails after two minutes and frees its slot", async () => {
  jest.useFakeTimers();
  const silent = jest.fn((_uri: string, _options: { signal: AbortSignal }) => new Promise<Answer>(() => {}));
  render(<Harness send={silent} />);
  galleryReturns("a", "b", "c");
  await chooseFrom("Elegir de galería");
  await act(async () => { jest.advanceTimersByTime(1_000); });
  expect(silent).toHaveBeenCalledTimes(2);
  await act(async () => { jest.advanceTimersByTime(120_000); });
  expect(thumb("Foto 1 de 3, principal, no se subió: No se pudo subir. Revisa la conexión.")).toBeTruthy();
  expect(silent).toHaveBeenCalledTimes(3);
});

test("accessibility actions do nothing while the form is saving", () => {
  render(<Harness photos={saved(2)} disabled />);
  fireEvent(thumb("Foto 2 de 2"), "accessibilityAction", { nativeEvent: { actionName: "makePrimary" } });
  expect(controller.field.photos[0]?.key).toBe("saved-1");
});
