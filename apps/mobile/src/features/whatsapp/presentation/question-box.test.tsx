import { AccessibilityInfo } from "react-native";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import * as Clipboard from "expo-clipboard";
import { QuestionBox } from "@mobile/features/whatsapp/presentation/question-box";
import i18n from "@mobile/i18n";

jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn(async () => true) }));

const point = { id: "p1", text: "Polo básico: ¿en qué talla, S, M o L?", about: "Polo básico" };

beforeEach(async () => { jest.clearAllMocks(); jest.mocked(Clipboard.setStringAsync).mockResolvedValue(true); await i18n.changeLanguage("es"); });
afterEach(cleanup);

test("shows the question as selectable text under «Pregúntale al cliente:» with Copiar pregunta", () => {
  const screen = render(<QuestionBox point={point} />);
  expect(screen.getByText("Pregúntale al cliente:")).toBeTruthy();
  expect(screen.getByText(point.text).props.selectable).toBe(true);
  expect(screen.getByRole("button", { name: /^Copiar pregunta/ })).toBeTruthy();
  expect(screen.queryByText("Pregunta copiada")).toBeNull();
});

test("copying puts the question on the clipboard and announces «Pregunta copiada»", async () => {
  const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => undefined);
  const screen = render(<QuestionBox point={point} />);
  fireEvent.press(screen.getByRole("button", { name: /^Copiar pregunta/ }));
  expect(await screen.findByText("Pregunta copiada")).toBeTruthy();
  expect(Clipboard.setStringAsync).toHaveBeenCalledWith(point.text);
  expect(announce).toHaveBeenCalledWith("Pregunta copiada");
});

test("each button names the product it asks about, in Spanish and Portuguese", async () => {
  const screen = render(<QuestionBox point={point} />);
  expect(screen.getByRole("button", { name: "Copiar pregunta sobre Polo básico" })).toBeTruthy();
  await i18n.changeLanguage("pt-BR");
  screen.rerender(<QuestionBox point={point} />);
  expect(screen.getByRole("button", { name: "Copiar pergunta sobre Polo básico" })).toBeTruthy();
});

test("every successful copy announces «Pregunta copiada»", async () => {
  const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => undefined);
  const screen = render(<QuestionBox point={point} />);
  fireEvent.press(screen.getByRole("button"));
  await waitFor(() => expect(announce).toHaveBeenCalledTimes(1));
  fireEvent.press(screen.getByRole("button"));
  await waitFor(() => expect(announce).toHaveBeenCalledTimes(2));
});

test("a copy the system refuses fails silently and the text stays selectable", async () => {
  jest.mocked(Clipboard.setStringAsync).mockRejectedValueOnce(new Error("denied"));
  const screen = render(<QuestionBox point={point} />);
  fireEvent.press(screen.getByRole("button", { name: /^Copiar pregunta/ }));
  await waitFor(() => expect(Clipboard.setStringAsync).toHaveBeenCalled());
  expect(screen.queryByText("Pregunta copiada")).toBeNull();
  expect(screen.getByText(point.text).props.selectable).toBe(true);
  jest.mocked(Clipboard.setStringAsync).mockResolvedValueOnce(false);
  fireEvent.press(screen.getByRole("button", { name: /^Copiar pregunta/ }));
  await waitFor(() => expect(Clipboard.setStringAsync).toHaveBeenCalledTimes(2));
  expect(screen.queryByText("Pregunta copiada")).toBeNull();
});

test("speaks Portuguese", async () => {
  await i18n.changeLanguage("pt-BR");
  const screen = render(<QuestionBox point={point} />);
  expect(screen.getByText("Pergunte ao cliente:")).toBeTruthy();
  fireEvent.press(screen.getByRole("button", { name: /^Copiar pergunta/ }));
  expect(await screen.findByText("Pergunta copiada")).toBeTruthy();
});
