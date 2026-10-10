import { Text } from "react-native";
import { render, waitFor } from "@testing-library/react-native";
import { ok } from "@shared/functional";
import { useWhatsApp, WhatsAppProvider } from "@mobile/features/whatsapp/presentation/whatsapp-provider";
import type { WhatsAppRuntime } from "@mobile/features/whatsapp/composition";

let mockAccess: unknown = { status: "ready", user: { id: "u1" }, company: { id: "c1" } };
jest.mock("@mobile/features/users/presentation/access-provider", () => ({ useAccess: () => ({ state: mockAccess }) }));

function fakeRuntime() {
  const subscribers: (() => void)[] = [];
  const runtime = {
    setIdentity: jest.fn(),
    links: { active: jest.fn(async () => ok({ companyId: "c1" })) },
    store: { listConversations: jest.fn(async () => ok([{ unsynced: 2 }, { unsynced: 1 }])) },
    reception: {
      signedIn: jest.fn(async () => ok({ stop: () => undefined })),
      signedOut: jest.fn(async () => ok(undefined)),
      status: jest.fn(() => ({ connection: "connected", qr: null, notice: null, lastError: null })),
      subscribe: jest.fn((listener: () => void) => { subscribers.push(listener); return () => undefined; }),
    },
  };
  return runtime as unknown as WhatsAppRuntime & typeof runtime;
}

function Probe() {
  const { status } = useWhatsApp();
  return <Text>{`${status.link}:${status.connection}:${status.unsynced}`}</Text>;
}

beforeEach(() => { mockAccess = { status: "ready", user: { id: "u1" }, company: { id: "c1" } }; });

test("sign-in starts reception for the session company and publishes the status", async () => {
  const runtime = fakeRuntime();
  const screen = render(<WhatsAppProvider getRuntime={async () => runtime}><Probe /></WhatsAppProvider>);
  await waitFor(() => expect(screen.getByText("linked:connected:3")).toBeTruthy());
  expect(runtime.setIdentity).toHaveBeenCalledWith({ companyId: "c1", userId: "u1" });
  expect(runtime.reception.signedIn).toHaveBeenCalledTimes(1);
});

test("sign-out stops reception and clears the identity without logging out", async () => {
  const runtime = fakeRuntime();
  const screen = render(<WhatsAppProvider getRuntime={async () => runtime}><Probe /></WhatsAppProvider>);
  await waitFor(() => expect(screen.getByText("linked:connected:3")).toBeTruthy());
  screen.unmount();
  expect(runtime.reception.signedOut).toHaveBeenCalledTimes(1);
  expect(runtime.setIdentity).toHaveBeenLastCalledWith(null);
});

test("does nothing without a ready session", async () => {
  mockAccess = { status: "signed_out" };
  const getRuntime = jest.fn();
  render(<WhatsAppProvider getRuntime={getRuntime}><Probe /></WhatsAppProvider>);
  expect(getRuntime).not.toHaveBeenCalled();
});
