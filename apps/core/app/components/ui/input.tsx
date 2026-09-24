import * as React from "react";
import { cn } from "@/lib/utils";
import { controlClass, useFieldContext } from "@/components/ui/field";

function Input({
  className,
  id,
  type,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
  ...props
}: React.ComponentProps<"input">) {
  const field = useFieldContext();
  const invalid = ariaInvalid ?? (field?.invalid || undefined);

  return (
    <input
      data-slot="input"
      type={type}
      id={id ?? field?.id}
      aria-invalid={invalid}
      aria-describedby={ariaDescribedBy ?? (invalid ? field?.errorId : undefined)}
      className={cn(controlClass, className)}
      {...props}
    />
  );
}

export { Input };
