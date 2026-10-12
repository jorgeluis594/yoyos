import { cleanup, fireEvent, render } from "@testing-library/react-native";
import { ok } from "@shared/functional";
import { MessageImage } from "@mobile/features/whatsapp/presentation/message-image";
import type { WhatsAppRuntime } from "@mobile/features/whatsapp/composition";
import type { NativeMessageId } from "@mobile/features/whatsapp/domain/ids";
import i18n from "@mobile/i18n";

jest.mock("expo-image", () => ({ Image: "Image" }));

const messageId = "wa-message:v1:m1" as NativeMessageId;
beforeEach(async () => { await i18n.changeLanguage("es"); });
afterEach(cleanup);

test("releases the file when the component unmounted while the download was running", async () => {
  const errors = jest.spyOn(console, "error").mockImplementation(() => undefined);
  let finish = (_result: unknown) => undefined as void;
  const viewImage = jest.fn(() => new Promise((resolve) => { finish = resolve; }));
  const releaseImage = jest.fn(async () => ok(undefined));
  const runtime = { viewImage, releaseImage } as unknown as WhatsAppRuntime;
  const screen = render(<MessageImage runtime={runtime} companyId="c1" messageId={messageId} />);
  fireEvent.press(screen.getByRole("button"));
  screen.unmount();
  expect(releaseImage).not.toHaveBeenCalled();
  await Promise.resolve(finish(ok({ uri: "file:///a.jpg" })));
  await new Promise((resolve) => setImmediate(resolve));
  expect(releaseImage).toHaveBeenCalledTimes(1);
  expect(releaseImage).toHaveBeenCalledWith(messageId);
  expect(errors).not.toHaveBeenCalled();
  errors.mockRestore();
});

test("releases a loaded image once on unmount", async () => {
  const viewImage = jest.fn(async () => ok({ uri: "file:///a.jpg" }));
  const releaseImage = jest.fn(async () => ok(undefined));
  const runtime = { viewImage, releaseImage } as unknown as WhatsAppRuntime;
  const screen = render(<MessageImage runtime={runtime} companyId="c1" messageId={messageId} />);
  fireEvent.press(screen.getByRole("button"));
  await screen.findByLabelText("Imagen");
  screen.unmount();
  expect(releaseImage).toHaveBeenCalledTimes(1);
});
