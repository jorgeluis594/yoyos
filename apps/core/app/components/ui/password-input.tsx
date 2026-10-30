import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

type PasswordInputProps = Omit<React.ComponentProps<"input">, "type">;

function PasswordInput({ className, ref, disabled, ...props }: PasswordInputProps) {
  const { t } = useTranslation();
  const [visible, setVisible] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const restore = React.useRef<{ start: number | null; end: number | null; focusInput: boolean } | null>(null);
  const Icon = visible ? EyeOff : Eye;

  const setRefs = React.useCallback((node: HTMLInputElement | null) => {
    inputRef.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  }, [ref]);

  function toggle(event: React.MouseEvent<HTMLButtonElement>) {
    const input = inputRef.current;
    // detail === 0 means keyboard activation: the focus stays on the button so it can be pressed again.
    restore.current = input ? { start: input.selectionStart, end: input.selectionEnd, focusInput: event.detail !== 0 } : null;
    setVisible((current) => !current);
  }

  // Chromium resets the caret after React rewrites `type` on the focused input, so restore it on the next frame.
  React.useLayoutEffect(() => {
    const input = inputRef.current;
    const pending = restore.current;
    restore.current = null;
    if (!input || !pending || pending.start === null || pending.end === null) return;
    const frame = requestAnimationFrame(() => {
      // The user may have tabbed to the button before the frame ran: never pull focus back from another element.
      const active = document.activeElement;
      if (active !== input && active !== document.body && active !== null) return;
      if (pending.focusInput) input.focus();
      input.setSelectionRange(pending.start, pending.end);
    });
    return () => cancelAnimationFrame(frame);
  }, [visible]);

  return (
    <div data-slot="password-input" className="relative">
      <Input ref={setRefs} type={visible ? "text" : "password"} disabled={disabled} className={cn("pr-12 [&::-ms-reveal]:hidden", className)} {...props} />
      <button
        type="button"
        disabled={disabled}
        aria-label={visible ? t("common.hidePassword") : t("common.showPassword")}
        aria-pressed={visible}
        onMouseDown={(event) => event.preventDefault()}
        onClick={toggle}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-[var(--radius-control)] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Icon aria-hidden="true" className="size-5" />
      </button>
    </div>
  );
}

export { PasswordInput };
