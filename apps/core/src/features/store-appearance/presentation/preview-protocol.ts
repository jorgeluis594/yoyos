import type { z } from "zod";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import {
  storePreviewMessageSchema, storePreviewReadySchema, type StorePreviewMessage,
} from "@core/src/features/store-appearance/presentation/store-appearance-schemas";

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
  frame.parent.postMessage(storePreviewReadySchema.parse({ type: "store-appearance:ready" }), frame.location.origin);
}

/** Preview side: calls `onUpdate` for each valid message from the embedding editor. Returns the unsubscribe function. */
export function listenForPreviewUpdates(frame: Window, onUpdate: (message: StorePreviewMessage) => void): () => void {
  const listener = (event: MessageEvent) => {
    const message = accept(storePreviewMessageSchema, event, frame.location.origin, frame.parent);
    if (message) onUpdate(message);
  };
  frame.addEventListener("message", listener);
  return () => frame.removeEventListener("message", listener);
}

type InvalidPreviewMessage = Readonly<{ code: "INVALID_PREVIEW_MESSAGE"; message: string }>;

/** Editor side: sends the draft to the preview iframe. A draft that breaks the schema is not sent. */
export function sendPreviewUpdate(preview: Window, message: StorePreviewMessage): Result<null, InvalidPreviewMessage> {
  const parsed = storePreviewMessageSchema.safeParse(message);
  if (!parsed.success) return err({ code: "INVALID_PREVIEW_MESSAGE", message: "The draft does not match the preview message schema" });
  preview.postMessage(parsed.data, window.location.origin);
  return ok(null);
}

/** Editor side: calls `onReady` when `preview()` announces it can receive updates. Returns the unsubscribe function. */
export function listenForPreviewReady(editor: Window, preview: () => Window | null, onReady: () => void): () => void {
  const listener = (event: MessageEvent) => {
    const frame = preview();
    if (frame && accept(storePreviewReadySchema, event, editor.location.origin, frame)) onReady();
  };
  editor.addEventListener("message", listener);
  return () => editor.removeEventListener("message", listener);
}
