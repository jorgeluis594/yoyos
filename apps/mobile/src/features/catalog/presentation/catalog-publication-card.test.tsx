import { AccessibilityInfo, Alert } from "react-native";
import { act, fireEvent, render } from "@testing-library/react-native";
import { err, ok } from "@shared/functional";
import { catalogSettings } from "@mobile/features/catalog/composition";
import type { CatalogLinkError } from "@mobile/features/catalog/infrastructure/catalog-settings-api";
import { CatalogPublicationCard } from "@mobile/features/catalog/presentation/catalog-publication-card";
import "@mobile/i18n";

jest.mock("@mobile/features/catalog/composition", () => ({ catalogSettings: { get: jest.fn(), setPublished: jest.fn(), checkSubdomain: jest.fn(), saveSubdomain: jest.fn() } }));
const get = jest.mocked(catalogSettings.get);
const setPublished = jest.mocked(catalogSettings.setPublished);
const checkSubdomain = jest.mocked(catalogSettings.checkSubdomain);
const saveSubdomain = jest.mocked(catalogSettings.saveSubdomain);
const url = "https://fantasio.yoyos.lat/";
const link = { subdomain: "fantasio", domain: "yoyos.lat", suggestion: null };
beforeEach(() => { get.mockReset(); setPublished.mockReset(); checkSubdomain.mockReset(); saveSubdomain.mockReset(); });

test("publication card asks for confirmation before hiding and restores the switch when saving fails", async () => {
  get.mockResolvedValue(ok({ published: true, url, ...link }));
  setPublished.mockResolvedValueOnce(err({ code: "NETWORK_ERROR", message: "offline" })).mockResolvedValueOnce(ok({ published: false, url, ...link }));
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  const screen = render(<CatalogPublicationCard />);
  fireEvent(await screen.findByLabelText("Publicar catálogo", {}, { timeout: 5000 }), "valueChange", false);
  expect(setPublished).not.toHaveBeenCalled();
  expect(alert.mock.calls[0][0]).toBe("¿Ocultar tu catálogo?");
  const confirm = () => alert.mock.calls[0][2]?.find(button => button.text === "Ocultar catálogo")?.onPress?.();
  act(() => confirm());
  await screen.findByText("No pudimos guardar el cambio");
  expect(screen.getByLabelText("Publicar catálogo").props.value).toBe(true);

  // The hide was already confirmed, so retrying does not ask again.
  fireEvent.press(screen.getByText("Reintentar"));
  await screen.findByText("Catálogo oculto");
  expect(alert).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText("Publicar catálogo").props.value).toBe(false);
  expect(setPublished).toHaveBeenLastCalledWith(false);
  alert.mockRestore();
});

test("publishing saves at once without asking and says the change is saved at the moment", async () => {
  get.mockResolvedValue(ok({ published: false, url, ...link }));
  setPublished.mockResolvedValueOnce(ok({ published: true, url, ...link }));
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  const screen = render(<CatalogPublicationCard />);
  expect(await screen.findByText("Este cambio se guarda al momento.", {}, { timeout: 5000 })).toBeTruthy();
  fireEvent(screen.getByLabelText("Publicar catálogo"), "valueChange", true);
  await screen.findByText("Catálogo publicado");
  expect(alert).not.toHaveBeenCalled();
  alert.mockRestore();
});

test("shows the load error inside the card with Reintentar and loads again", async () => {
  get.mockResolvedValueOnce(err({ code: "NETWORK_ERROR", message: "offline" })).mockResolvedValueOnce(ok({ published: false, url, ...link }));
  const screen = render(<CatalogPublicationCard />);
  await screen.findByText("No pudimos cargar la configuración del catálogo", {}, { timeout: 5000 });
  fireEvent.press(screen.getByText("Reintentar"));
  expect((await screen.findByLabelText("Publicar catálogo")).props.value).toBe(false);
});

describe("the link", () => {
  const empty = { published: false, subdomain: null, url: null, domain: "yoyos.lat", suggestion: null };
  const withSuggestion = { ...empty, suggestion: "cafe-fantasio" };
  const saved = { published: false, subdomain: "fantasio", url, domain: "yoyos.lat", suggestion: null };
  const failure = (error: CatalogLinkError) => ({ success: false as const, error });
  const available = (subdomain: string) => ok({ status: "available" as const, subdomain });
  const answered = (code: "SUBDOMAIN_TAKEN" | "UNAUTHENTICATED" | "RATE_LIMITED") => failure({ kind: "answered", code, reason: null });
  const field = (screen: ReturnType<typeof render>) => screen.getByLabelText("Link de tu catálogo");
  const type = async (screen: ReturnType<typeof render>, text: string) => {
    fireEvent.changeText(field(screen), text);
    await act(async () => { jest.advanceTimersByTime(400); });
  };
  const open = async (settings: Awaited<ReturnType<typeof get>> extends infer R ? R : never) => {
    get.mockResolvedValueOnce(settings);
    const screen = render(<CatalogPublicationCard />);
    await screen.findByLabelText("Link de tu catálogo", {}, { timeout: 5000 });
    return screen;
  };
  const switchOff = (screen: ReturnType<typeof render>) => screen.getByLabelText("Publicar catálogo").props;
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

  test("prefills the available suggestion and keeps the switch disabled until the link is saved", async () => {
    const screen = await open(ok(withSuggestion));
    expect(field(screen).props.value).toBe("cafe-fantasio");
    expect(screen.getByText(/cafe-fantasio\.yoyos\.lat está disponible/)).toBeTruthy();
    expect(screen.getByText("Elige el link de tu catálogo para poder publicarlo.")).toBeTruthy();
    expect(switchOff(screen).disabled).toBe(true);
    expect(checkSubdomain).not.toHaveBeenCalled();

    saveSubdomain.mockResolvedValueOnce(ok({ ...withSuggestion, subdomain: "cafe-fantasio", url: "https://cafe-fantasio.yoyos.lat/", suggestion: null }));
    await act(async () => fireEvent.press(screen.getByText("Guardar link")));
    expect(saveSubdomain).toHaveBeenCalledWith("cafe-fantasio");
    expect(screen.getByText(/Link guardado/)).toBeTruthy();
    expect(screen.getByText("Tu link: https://cafe-fantasio.yoyos.lat/")).toBeTruthy();
    expect(screen.queryByText("Copiar link")).toBeNull();
    expect(switchOff(screen).disabled).toBe(false);
  });

  test("publish answered SUBDOMAIN_REQUIRED from an outdated screen turns the switch off with «Elige el link de tu catálogo para poder publicarlo.»", async () => {
    const screen = await open(ok(saved));
    setPublished.mockResolvedValueOnce(err({ code: "API_ERROR", message: "x", http: { status: 409, body: { code: "SUBDOMAIN_REQUIRED", error: "x" } } }));
    await act(async () => fireEvent(screen.getByLabelText("Publicar catálogo"), "valueChange", true));
    expect(screen.getByText("Elige el link de tu catálogo para poder publicarlo.")).toBeTruthy();
    expect(switchOff(screen).value).toBe(false);
    expect(screen.queryByText("No pudimos guardar el cambio")).toBeNull();
  });

  test("a save answered with a session or company error shows the failed-save state and makes no re-read", async () => {
    const screen = await open(ok(empty));
    checkSubdomain.mockResolvedValue(available("fantasio"));
    await type(screen, "fantasio");
    saveSubdomain.mockResolvedValueOnce(answered("UNAUTHENTICATED"));
    await act(async () => fireEvent.press(screen.getByText("Guardar link")));
    expect(screen.getByText("No pudimos guardar tu link. Inténtalo de nuevo.")).toBeTruthy();
    expect(field(screen).props.value).toBe("fantasio");
    expect(get).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Reintentar")).toBeTruthy();
  });

  test("shows only the verdict for the latest value after the pause and never announces Revisando", async () => {
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => undefined);
    announce.mockClear();
    const screen = await open(ok(empty));
    let late: (value: Awaited<ReturnType<typeof checkSubdomain>>) => void = () => undefined;
    checkSubdomain.mockReturnValueOnce(new Promise(resolve => { late = resolve; })).mockResolvedValueOnce(available("fantasio-store"));
    await type(screen, "fantasio");
    expect(screen.getByText("Revisando…")).toBeTruthy();
    fireEvent.changeText(field(screen), "fantasio-");
    // Every edit drops the verdict: until the pause ends the help text shows, and Guardar link is disabled.
    expect(screen.getByText("Usa el nombre de tu marca: letras, números y guiones.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Guardar link" }).props.accessibilityState.disabled).toBe(true);
    await act(async () => { jest.advanceTimersByTime(200); });
    fireEvent.changeText(field(screen), "fantasio-store");
    await act(async () => { jest.advanceTimersByTime(400); });
    expect(checkSubdomain).toHaveBeenCalledTimes(2);
    expect(checkSubdomain).toHaveBeenLastCalledWith("fantasio-store", expect.any(AbortSignal));
    expect(screen.queryByText(/No puede empezar ni terminar con guion/)).toBeNull();

    await act(async () => late(ok({ status: "in_use", subdomain: "fantasio" })));
    expect(screen.getByText(/fantasio-store\.yoyos\.lat está disponible/)).toBeTruthy();
    expect(screen.queryByText(/ya está en uso/)).toBeNull();
    expect(announce.mock.calls.map(call => call[0])).toEqual(["fantasio-store.yoyos.lat está disponible"]);
  });

  test("lowercases Fantasio while typing and keeps a 40 character paste whole with its reason", async () => {
    const screen = await open(ok(empty));
    checkSubdomain.mockResolvedValue(available("fantasio"));
    await type(screen, "Fantasio");
    expect(field(screen).props.value).toBe("fantasio");
    expect(checkSubdomain).toHaveBeenCalledWith("fantasio", expect.any(AbortSignal));
    const long = "a".repeat(40);
    await type(screen, long);
    expect(field(screen).props.value).toBe(long);
    expect(field(screen).props.maxLength).toBeUndefined();
    expect(screen.getByText("Usa hasta 30 caracteres.")).toBeTruthy();
    expect(checkSubdomain).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Guardar link" }).props.accessibilityState.disabled).toBe(true);
    await type(screen, "pay");
    expect(screen.getByText("Ese nombre está reservado. Prueba con otro.")).toBeTruthy();
    await type(screen, "pa");
    expect(screen.getByText("Usa el nombre de tu marca: letras, números y guiones.")).toBeTruthy();
    expect(checkSubdomain).toHaveBeenCalledTimes(1);
  });

  test("asks before replacing a saved link and saves nothing on Mantener link actual", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    const screen = await open(ok(saved));
    expect(screen.getByText("Es tu link actual")).toBeTruthy();
    checkSubdomain.mockResolvedValue(available("fantasio-store"));
    await type(screen, "fantasio-store");
    fireEvent.press(screen.getByText("Guardar link"));
    expect(alert.mock.calls[0][0]).toBe("¿Cambiar el link de tu catálogo?");
    expect(alert.mock.calls[0][1]).toBe("fantasio.yoyos.lat dejará de ser tuyo y otra tienda podrá usarlo. Los links de tu catálogo y de tus pedidos que ya compartiste dejarán de funcionar.");
    const buttons = alert.mock.calls[0][2] ?? [];
    expect(buttons.find(button => button.text === "Cambiar link")?.style).toBe("destructive");
    expect(buttons.find(button => button.text === "Mantener link actual")?.style).toBe("cancel");
    expect(saveSubdomain).not.toHaveBeenCalled();
    expect(field(screen).props.value).toBe("fantasio-store");

    // Each attempt asks again, and confirming saves.
    saveSubdomain.mockResolvedValueOnce(ok({ ...saved, subdomain: "fantasio-store", url: "https://fantasio-store.yoyos.lat/" }));
    fireEvent.press(screen.getByText("Guardar link"));
    expect(alert).toHaveBeenCalledTimes(2);
    await act(async () => alert.mock.calls[1][2]?.find(button => button.text === "Cambiar link")?.onPress?.());
    expect(saveSubdomain).toHaveBeenCalledWith("fantasio-store");
    expect(screen.getByText(/Link guardado/)).toBeTruthy();
    expect(screen.getByText("Tu link: https://fantasio-store.yoyos.lat/")).toBeTruthy();
  });

  test("shows Alguien acaba de tomar after an available verdict and the plain in-use text after a failed check", async () => {
    const screen = await open(ok(empty));
    checkSubdomain.mockResolvedValueOnce(available("fantasio"));
    await type(screen, "fantasio");
    saveSubdomain.mockResolvedValueOnce(answered("SUBDOMAIN_TAKEN"));
    await act(async () => fireEvent.press(screen.getByText("Guardar link")));
    expect(screen.getByText("Alguien acaba de tomar fantasio.yoyos.lat. Prueba con otro.")).toBeTruthy();
    expect(field(screen).props.value).toBe("fantasio");
    expect(screen.getByRole("button", { name: "Guardar link" }).props.accessibilityState.disabled).toBe(true);

    checkSubdomain.mockResolvedValueOnce(answered("RATE_LIMITED"));
    await type(screen, "fantasio2");
    saveSubdomain.mockResolvedValueOnce(answered("SUBDOMAIN_TAKEN"));
    await act(async () => fireEvent.press(screen.getByText("Guardar link")));
    expect(screen.getByText("fantasio2.yoyos.lat ya está en uso. Prueba con otro.")).toBeTruthy();
  });

  test("shows the check-failed state when the availability check is rate-limited", async () => {
    const screen = await open(ok(empty));
    checkSubdomain.mockResolvedValueOnce(answered("RATE_LIMITED")).mockResolvedValueOnce(available("fantasio"));
    await type(screen, "fantasio");
    expect(screen.getByText("No pudimos revisar si está disponible.")).toBeTruthy();
    expect(field(screen).props.value).toBe("fantasio");
    expect(screen.getByRole("button", { name: "Guardar link" }).props.accessibilityState.disabled).toBe(false);
    await act(async () => fireEvent.press(screen.getByText("Reintentar")));
    expect(checkSubdomain).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/fantasio\.yoyos\.lat está disponible/)).toBeTruthy();
  });

  test("a save without an answer re-reads and shows Link guardado or Tu link no se guardó", async () => {
    const screen = await open(ok(empty));
    checkSubdomain.mockResolvedValue(available("fantasio"));
    await type(screen, "fantasio");
    saveSubdomain.mockResolvedValue(failure({ kind: "no_response" }));
    let finish: (value: Awaited<ReturnType<typeof get>>) => void = () => undefined;
    get.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    await act(async () => fireEvent.press(screen.getByText("Guardar link")));
    expect(screen.getByText("No sabemos si tu link se guardó. Lo estamos revisando…")).toBeTruthy();
    expect(field(screen).props.editable).toBe(false);
    expect(switchOff(screen).disabled).toBe(true);
    await act(async () => finish(ok({ ...saved, subdomain: "fantasio" })));
    expect(screen.getByText(/Link guardado/)).toBeTruthy();
    expect(screen.getByText("Tu link: https://fantasio.yoyos.lat/")).toBeTruthy();

    // Not saved: the previous value stays, the typed value is checked again and the message stays.
    await type(screen, "fantasio-store");
    checkSubdomain.mockResolvedValue(available("fantasio-store"));
    saveSubdomain.mockResolvedValue(failure({ kind: "no_response" }));
    get.mockResolvedValueOnce(ok(saved));
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    await act(async () => { jest.advanceTimersByTime(0); });
    await act(async () => fireEvent.press(screen.getByText("Guardar link")));
    await act(async () => alert.mock.calls[0][2]?.find(button => button.text === "Cambiar link")?.onPress?.());
    expect(screen.getByText(/Tu link no se guardó\. fantasio-store\.yoyos\.lat está disponible/)).toBeTruthy();
    expect(field(screen).props.value).toBe("fantasio-store");
    expect(screen.getByText("Tu link: https://fantasio.yoyos.lat/")).toBeTruthy();

    // The re-read fails: Reintentar sends the same save again.
    saveSubdomain.mockResolvedValueOnce(failure({ kind: "no_response" }));
    get.mockResolvedValueOnce(err({ code: "NETWORK_ERROR", message: "offline" }));
    await act(async () => fireEvent.press(screen.getByText("Guardar link")));
    await act(async () => alert.mock.calls[1][2]?.find(button => button.text === "Cambiar link")?.onPress?.());
    expect(screen.getByText("No sabemos si tu link se guardó. Revisa tu conexión.")).toBeTruthy();
    saveSubdomain.mockResolvedValueOnce(ok({ ...saved, subdomain: "fantasio-store", url: "https://fantasio-store.yoyos.lat/" }));
    await act(async () => fireEvent.press(screen.getByText("Reintentar")));
    expect(saveSubdomain).toHaveBeenLastCalledWith("fantasio-store");
    expect(alert).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Tu link: https://fantasio-store.yoyos.lat/")).toBeTruthy();
  });

  test("the return key saves only when Guardar link is enabled", async () => {
    const screen = await open(ok(empty));
    fireEvent(field(screen), "submitEditing");
    expect(saveSubdomain).not.toHaveBeenCalled();
    expect(field(screen).props.returnKeyLabel).toBe("Guardar");
    checkSubdomain.mockResolvedValue(available("fantasio"));
    await type(screen, "fantasio");
    saveSubdomain.mockResolvedValue(ok({ ...saved, published: false }));
    await act(async () => fireEvent(field(screen), "submitEditing"));
    expect(saveSubdomain).toHaveBeenCalledWith("fantasio");
  });

  test("shows Copiar link and Ver catálogo only while published and reports the unsaved link", async () => {
    const onUnsaved = jest.fn();
    get.mockResolvedValueOnce(ok({ ...saved, published: true }));
    const screen = render(<CatalogPublicationCard onUnsavedLinkChange={onUnsaved} />);
    await screen.findByLabelText("Link de tu catálogo", {}, { timeout: 5000 });
    expect(screen.getByText("Copiar link")).toBeTruthy();
    expect(screen.getByText("Ver catálogo")).toBeTruthy();
    expect(onUnsaved).toHaveBeenLastCalledWith(false);
    fireEvent.changeText(field(screen), "fantasio-store");
    expect(onUnsaved).toHaveBeenLastCalledWith(true);
    fireEvent.changeText(field(screen), "fantasio");
    expect(onUnsaved).toHaveBeenLastCalledWith(false);
  });
});
