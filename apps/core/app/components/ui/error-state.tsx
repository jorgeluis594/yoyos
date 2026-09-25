import * as React from "react";
import { cn } from "@/lib/utils";

/** Full-page error for route boundaries: title, recovery hint, and a way forward. */
function ErrorState({
  title,
  description,
  action,
  className,
  ...props
}: React.ComponentProps<"section"> & {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <section
      role="alert"
      data-slot="error-state"
      className={cn("mx-auto max-w-form", className)}
      {...props}
    >
      <h1 className="break-words text-2xl font-semibold tracking-tight">
        {title}
      </h1>
      {description ? (
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-5 flex flex-wrap gap-3">{action}</div> : null}
    </section>
  );
}

export { ErrorState };
