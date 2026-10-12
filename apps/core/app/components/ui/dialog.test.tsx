// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test } from "vitest";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test("opens a labelled modal that closes from its footer", async () => {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  await act(async () => root.render(
    <Dialog>
      <DialogTrigger>Cancelar pedido</DialogTrigger>
      <DialogContent closeLabel="Cerrar">
        <DialogHeader><DialogTitle>¿Cancelar?</DialogTitle><DialogDescription>Se repone el stock.</DialogDescription></DialogHeader>
        <DialogFooter><DialogClose>Mantener</DialogClose></DialogFooter>
      </DialogContent>
    </Dialog>,
  ));
  await act(async () => container.querySelector("button")!.click());
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  expect(document.getElementById(dialog.getAttribute("aria-labelledby")!)?.textContent).toBe("¿Cancelar?");
  expect(document.getElementById(dialog.getAttribute("aria-describedby")!)?.textContent).toBe("Se repone el stock.");
  expect(dialog.querySelector('[aria-label="Cerrar"]')).not.toBeNull();
  await act(async () => [...dialog.querySelectorAll("button")].find((button) => button.textContent === "Mantener")!.click());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  root.unmount();
  container.remove();
});
