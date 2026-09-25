import * as React from "react";
import { cn } from "@/lib/utils";
import { controlClass } from "@/components/ui/field";

function Input({
  className,
  id,
  type,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
  ...props
}: React.ComponentProps<"input">) {
  return (
    <input
      data-slot="input"
      type={type}
      id={id}
      aria-invalid={ariaInvalid}
      aria-describedby={ariaDescribedBy}
      className={cn(controlClass, className)}
      {...props}
    />
  );
}

export { Input };
