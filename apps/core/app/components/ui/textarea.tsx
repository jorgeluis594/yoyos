import * as React from "react";
import { cn } from "@/lib/utils";
import { controlClass, useFieldContext } from "@/components/ui/field";

function Textarea({
  className,
  id,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
  ...props
}: React.ComponentProps<"textarea">) {
  const field = useFieldContext();
  const invalid = ariaInvalid ?? (field?.invalid || undefined);

  return (
    <textarea
      data-slot="textarea"
      id={id ?? field?.id}
      aria-invalid={invalid}
      aria-describedby={ariaDescribedBy ?? (invalid ? field?.errorId : undefined)}
      className={cn(controlClass, "py-2", className)}
      {...props}
    />
  );
}

export { Textarea };
