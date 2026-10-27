import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { GripVertical } from "lucide-react";
import { Button } from "@core/app/components/ui/button";

/** Moves by keyboard (arrow keys on the focused handle) and by dragging the handle with the mouse. */
export function useReorder(ids: readonly string[], onMove: (id: string, to: number) => void) {
  const dragging = useRef<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  // The handle that was moved takes focus back once, after the list re-renders in its new order.
  const focusId = useRef<string | null>(null);
  useEffect(() => {
    if (focusId.current === null) return;
    document.querySelector<HTMLElement>(`[data-handle="${focusId.current}"]`)?.focus();
    focusId.current = null;
  });
  return {
    announcement,
    announce: (text: string) => setAnnouncement(text),
    move: (id: string, to: number) => { onMove(id, to); focusId.current = id; },
    handleProps: (id: string) => ({
      draggable: true,
      onDragStart: (event: DragEvent) => { dragging.current = id; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", id); },
      onDragEnd: () => { dragging.current = null; },
    }),
    itemProps: (id: string) => ({
      onDragOver: (event: DragEvent) => { if (dragging.current) event.preventDefault(); },
      onDrop: (event: DragEvent) => {
        event.preventDefault();
        const from = dragging.current;
        dragging.current = null;
        if (from && from !== id) onMove(from, ids.indexOf(id));
      },
    }),
  };
}

export function ReorderHandle({ id, name, position, total, onMove, announce, dragProps }: {
  id: string;
  name: string;
  position: number;
  total: number;
  onMove: (id: string, to: number) => void;
  announce: (text: string) => void;
  dragProps: ReturnType<ReturnType<typeof useReorder>["handleProps"]>;
}) {
  const { t } = useTranslation();
  function onKeyDown(event: KeyboardEvent) {
    const step = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const to = position - 1 + step;
    if (to < 0 || to >= total) return;
    onMove(id, to);
    announce(t("productEditor.moved", { name, position: to + 1, total }));
  }
  return <Button type="button" variant="ghost" size="icon" data-handle={id} aria-label={t("productEditor.moveHandle", { name, position, total })}
    className="cursor-grab touch-none" onKeyDown={onKeyDown} {...dragProps}>
    <GripVertical aria-hidden="true" />
  </Button>;
}
