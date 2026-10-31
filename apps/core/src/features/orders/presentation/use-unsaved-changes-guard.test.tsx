// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, Link, RouterProvider } from "react-router";
import { afterEach, expect, test } from "vitest";
import { useUnsavedChangesGuard } from "@core/src/features/orders/presentation/use-unsaved-changes-guard";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | undefined;
let container: HTMLDivElement;
afterEach(() => { act(() => root?.unmount()); root = undefined; container.remove(); });

function Page({ dirty, inDoubt = false, allowedPath }: Readonly<{ dirty: boolean; inDoubt?: boolean; allowedPath?: string }>) {
  const guard = useUnsavedChangesGuard({ dirty, inDoubt, allowedPath });
  return <div><Link to="/sales">Ver ventas</Link>
    {guard.blocked && <div role="dialog" data-mode={guard.mode}><button type="button" onClick={guard.stay}>stay</button><button type="button" onClick={guard.leave}>leave</button></div>}</div>;
}

async function mount(page: React.ReactNode) {
  const router = createMemoryRouter([{ path: "/orders/new", element: page }, { path: "/sales", element: <p>Ventas</p> }, { path: "/orders/o1", element: <p>Pedido</p> }], { initialEntries: ["/orders/new"] });
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(async () => root!.render(<RouterProvider router={router} />));
  return router;
}
const click = async (name: string) => act(async () => { [...container.querySelectorAll("a, button")].find((element) => element.textContent === name)!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })); });

test("lets the seller leave when there is nothing unsaved", async () => {
  const router = await mount(<Page dirty={false} />);
  await click("Ver ventas");
  expect(router.state.location.pathname).toBe("/sales");
});

test("holds the navigation while dirty and keeps the edits on stay", async () => {
  const router = await mount(<Page dirty />);
  await click("Ver ventas");
  expect(router.state.location.pathname).toBe("/orders/new");
  expect(container.querySelector('[role="dialog"]')?.getAttribute("data-mode")).toBe("changes");
  await click("stay");
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(router.state.location.pathname).toBe("/orders/new");
});

test("leaves after the seller confirms and asks the other question while a save is in doubt", async () => {
  const router = await mount(<Page dirty inDoubt />);
  await click("Ver ventas");
  expect(container.querySelector('[role="dialog"]')?.getAttribute("data-mode")).toBe("doubt");
  await click("leave");
  expect(router.state.location.pathname).toBe("/sales");
});

test("keeps holding other navigations while a save is in flight and lets only the saved order's own through", async () => {
  const router = await mount(<Page dirty allowedPath="/orders/o1" />);
  await click("Ver ventas");
  expect(router.state.location.pathname).toBe("/orders/new");
  expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  await click("stay");
  await act(async () => { await router.navigate("/orders/o1", { replace: true }); });
  expect(router.state.location.pathname).toBe("/orders/o1");
});

test("asks the browser to warn on reload only while there is something to lose", async () => {
  await mount(<Page dirty />);
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  act(() => root!.unmount());
  root = createRoot(container);
  await act(async () => root!.render(<RouterProvider router={createMemoryRouter([{ path: "/", element: <Page dirty={false} /> }])} />));
  const calm = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(calm);
  expect(calm.defaultPrevented).toBe(false);
});
