import { Alert } from "react-native";
import { act, fireEvent, render } from "@testing-library/react-native";
import { err, ok } from "@shared/functional";
import { catalogSettings } from "@mobile/features/catalog/composition";
import { CatalogPublicationCard } from "@mobile/features/catalog/presentation/catalog-publication-card";
import "@mobile/i18n";

jest.mock("@mobile/features/catalog/composition", () => ({ catalogSettings: { get: jest.fn(), setPublished: jest.fn() } }));
const get = jest.mocked(catalogSettings.get);
const setPublished = jest.mocked(catalogSettings.setPublished);
const url = "https://yoyos.test/catalogo/00000000-0000-4000-8000-000000000001";
beforeEach(() => { get.mockReset(); setPublished.mockReset(); });

test("publication card asks for confirmation before hiding and restores the switch when saving fails", async () => {
  get.mockResolvedValue(ok({ published: true, url }));
  setPublished.mockResolvedValueOnce(err({ code: "NETWORK_ERROR", message: "offline" })).mockResolvedValueOnce(ok({ published: false, url }));
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
  get.mockResolvedValue(ok({ published: false, url }));
  setPublished.mockResolvedValueOnce(ok({ published: true, url }));
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  const screen = render(<CatalogPublicationCard />);
  expect(await screen.findByText("Este cambio se guarda al momento.", {}, { timeout: 5000 })).toBeTruthy();
  fireEvent(screen.getByLabelText("Publicar catálogo"), "valueChange", true);
  await screen.findByText("Catálogo publicado");
  expect(alert).not.toHaveBeenCalled();
  alert.mockRestore();
});

test("shows the load error inside the card with Reintentar and loads again", async () => {
  get.mockResolvedValueOnce(err({ code: "NETWORK_ERROR", message: "offline" })).mockResolvedValueOnce(ok({ published: false, url }));
  const screen = render(<CatalogPublicationCard />);
  await screen.findByText("No pudimos cargar la configuración del catálogo", {}, { timeout: 5000 });
  fireEvent.press(screen.getByText("Reintentar"));
  expect((await screen.findByLabelText("Publicar catálogo")).props.value).toBe(false);
});
