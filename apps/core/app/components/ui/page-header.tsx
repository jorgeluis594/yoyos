import * as React from "react";
import { cn } from "@/lib/utils";

function Root({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="page-header"
      className={cn("flex flex-wrap items-start justify-between gap-4", className)}
      {...props}
    />
  );
}

function Heading({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="page-header-heading"
      className={cn("min-w-0", className)}
      {...props}
    />
  );
}

function Title({ className, ...props }: React.ComponentProps<"h1">) {
  return (
    <h1
      data-slot="page-header-title"
      className={cn("flex flex-wrap items-baseline gap-x-3 gap-y-1 break-words text-balance text-2xl font-semibold tracking-tight", className)}
      {...props}
    />
  );
}

/** Inline record count next to the title, e.g. "Productos 128". */
function Count({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="page-header-count"
      className={cn("text-base font-normal tabular-nums text-muted-foreground", className)}
      {...props}
    />
  );
}

function Description({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="page-header-description"
      className={cn("mt-2 text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

function Actions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="page-header-actions"
      className={cn("flex flex-wrap items-center gap-3", className)}
      {...props}
    />
  );
}

/** Stateless page header. Pages compose their own interactive controls inside Actions. */
export const PageHeader = Object.assign(Root, {
  Heading,
  Title,
  Count,
  Description,
  Actions,
});
