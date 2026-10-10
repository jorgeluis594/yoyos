import type { z } from "zod";
import {
  checkoutPreviewMessageSchema, checkoutPreviewReadySchema, type CheckoutPreviewMessage,
} from "@core/src/features/checkout-appearance/presentation/checkout-appearance-schemas";

type Incoming = Readonly<{ origin: string; source: MessageEventSource | null; data: unknown }>;

/** Accepts only messages sent by `sender` from this page's own origin that match `schema`. */
function accept<S extends z.ZodType>(schema: S, event: Incoming, origin: string, sender: unknown): z.infer<S> | null {
  if (event.origin !== origin || event.source !== sender) return null;
  const parsed = schema.safeParse(event.data);
  return parsed.success ? parsed.data : null;
}

/** Preview side: tells the editor the page is loaded and can receive the draft. */
export function announcePreviewReady(frame: Window): void {
  if (frame.parent === frame) return;
  frame.parent.postMessage(checkoutPreviewReadySchema.parse({ type: "checkout-appearance:ready" }), frame.location.origin);
}

/** Preview side: calls `onUpdate` for each valid message from the embedding editor. Returns the unsubscribe function. */
export function listenForPreviewUpdates(frame: Window, onUpdate: (message: CheckoutPreviewMessage) => void): () => void {
  const listener = (event: MessageEvent) => {
    const message = accept(checkoutPreviewMessageSchema, event, frame.location.origin, frame.parent);
    if (message) onUpdate(message);
  };
  frame.addEventListener("message", listener);
  return () => frame.removeEventListener("message", listener);
}

/** Editor side: sends the draft to the preview iframe. */
export function sendPreviewUpdate(preview: Window, message: CheckoutPreviewMessage): void {
  preview.postMessage(checkoutPreviewMessageSchema.parse(message), window.location.origin);
}

/** Editor side: calls `onReady` when `preview()` announces it can receive updates. Returns the unsubscribe function. */
export function listenForPreviewReady(editor: Window, preview: () => Window | null, onReady: () => void): () => void {
  const listener = (event: MessageEvent) => {
    const frame = preview();
    if (frame && accept(checkoutPreviewReadySchema, event, editor.location.origin, frame)) onReady();
  };
  editor.addEventListener("message", listener);
  return () => editor.removeEventListener("message", listener);
}
