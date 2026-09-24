import * as React from "react";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";

/** Shared base styles for text-like controls (Input, Textarea, Select). */
export const controlClass =
  "min-h-control w-full rounded-[var(--radius-control)] border border-input bg-background px-3 text-base outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground aria-invalid:border-destructive";

type FieldContextValue = { id: string; errorId: string; invalid: boolean };
const FieldContext = React.createContext<FieldContextValue | null>(null);

/** Optional context consumed by Input/Textarea/Select to wire label and error semantics. */
export function useFieldContext() {
  return React.useContext(FieldContext);
}

function Field({
  id,
  error,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & { id?: string; error?: string }) {
  const generatedId = React.useId();
  const fieldId = id ?? generatedId;
  const context: FieldContextValue = {
    id: fieldId,
    errorId: `${fieldId}-error`,
    invalid: Boolean(error),
  };

  return (
    <FieldContext.Provider value={context}>
      <div
        data-slot="field"
        className={cn("flex min-w-0 flex-col gap-2", className)}
        {...props}
      >
        {children}
        {error ? (
          <p id={context.errorId} role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}

function FieldLabel({ htmlFor, ...props }: React.ComponentProps<"label">) {
  const field = useFieldContext();
  return <Label htmlFor={htmlFor ?? field?.id} {...props} />;
}

export { Field, FieldLabel };
