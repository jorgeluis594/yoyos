import { Text } from "react-native";
import { act, render, waitFor } from "@testing-library/react-native";
import { ok } from "@shared/functional";
import { createReceptionLifecycle } from "@mobile/features/whatsapp/application/reception-lifecycle";
import { useWhatsApp, WhatsAppProvider } from "@mobile/features/whatsapp/presentation/whatsapp-provider";
import type { WhatsAppRuntime } from "@mobile/features/whatsapp/composition";

let mockAccess: unknown = { status: "ready", user: { id: "u1" }, company: { id: "c1" } };
jest.mock("@mobile/features/users/presentation/access-provider", () => ({ useAccess: () => ({ state: mockAccess }) }));

function fakeRuntime() {
  const subscribers: (() => void)[] = [];
  const changeListeners: (() => void)[] = [];
  const runtime = {
    setIdentity: jest.fn(),
    links: { active: jest.fn(async () => ok({ companyId: "c1" })) },
    store: { listConversations: jest.fn(async () => ok([{ unsynced: 2 }, { unsynced: 1 }])) },
    changes: { subscribe: jest.fn((listener: () => void) => { changeListeners.push(listener); return () => undefined; }) },
    reception: {
      signedIn: jest.fn(async () => ok({ stop: () => undefined })),
      signedOut: jest.fn(async () => ok(undefined)),
      status: jest.fn(() => ({ connection: "connected", qr: null, notice: null, lastError: null })),
      subscribe: jest.fn((listener: () => void) => { subscribers.push(listener); return () => undefined; }),
    },
  };
  return Object.assign(runtime, { changeListeners }) as unknown as WhatsAppRuntime & typeof runtime & { changeListeners: (() => void)[] };
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

test("unmounting while sign-in is pending leaves no listeners or connection", async () => {
  let open = () => undefined as void;
  const gate = new Promise<void>((resolve) => { open = resolve; });
  let listeners = 0;
  const connect = jest.fn(async () => ok(undefined));
  const whatsapp = {
    addListener: (() => { listeners += 1; return { remove: () => { listeners -= 1; } }; }) as never,
    initialize: async () => ok(undefined), connect, disconnect: async () => ok(undefined), logout: async () => ok(undefined),
  };
  const links = { active: async () => { await gate; return ok({ companyId: "c1" }); }, } as never;
  const reception = createReceptionLifecycle({
    whatsapp, links, session: () => ({ companyId: "c1", userId: "u1", generation: 1 }) as never,
    receive: jest.fn() as never, sync: { wake: jest.fn(), stop: jest.fn() },
  });
  const runtime = { ...fakeRuntime(), reception } as unknown as WhatsAppRuntime;
  const screen = render(<WhatsAppProvider getRuntime={async () => runtime}><Probe /></WhatsAppProvider>);
  await waitFor(() => expect(runtime.setIdentity).toHaveBeenCalled());
  screen.unmount();
  open();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(listeners).toBe(0);
  expect(connect).not.toHaveBeenCalled();
});

test("a burst of message changes refreshes the status once", async () => {
  jest.useFakeTimers();
  try {
    const runtime = fakeRuntime();
    const screen = render(<WhatsAppProvider getRuntime={async () => runtime}><Probe /></WhatsAppProvider>);
    await waitFor(() => expect(screen.getByText("linked:connected:3")).toBeTruthy());
    const before = runtime.links.active.mock.calls.length;
    runtime.store.listConversations.mockImplementation(async () => ok([{ unsynced: 5 }]));
    await act(async () => { runtime.changeListeners.forEach((notify) => { notify(); notify(); notify(); }); });
    expect(runtime.links.active).toHaveBeenCalledTimes(before);
    await act(async () => { jest.advanceTimersByTime(300); });
    await waitFor(() => expect(screen.getByText("linked:connected:5")).toBeTruthy());
    expect(runtime.links.active).toHaveBeenCalledTimes(before + 1);
  } finally {
    jest.useRealTimers();
  }
});
