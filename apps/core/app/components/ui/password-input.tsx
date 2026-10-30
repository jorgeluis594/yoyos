import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

type PasswordInputProps = Omit<React.ComponentProps<"input">, "type">;

function PasswordInput({ className, ref, ...props }: PasswordInputProps) {
  const { t } = useTranslation();
  const [visible, setVisible] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const selection = React.useRef<{ start: number | null; end: number | null }>({ start: null, end: null });
  const Icon = visible ? EyeOff : Eye;

  function setRefs(node: HTMLInputElement | null) {
    inputRef.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  }

  function toggle() {
    const input = inputRef.current;
    if (input) selection.current = { start: input.selectionStart, end: input.selectionEnd };
    setVisible((current) => !current);
  }

  React.useLayoutEffect(() => {
    const input = inputRef.current;
    const { start, end } = selection.current;
    if (!input || start === null || end === null) return;
    input.focus();
    input.setSelectionRange(start, end);
  }, [visible]);

  return (
    <div data-slot="password-input" className="relative">
      <Input ref={setRefs} type={visible ? "text" : "password"} className={cn("pr-12", className)} {...props} />
      <button
        type="button"
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
