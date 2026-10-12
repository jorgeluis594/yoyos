import * as React from "react";
import { cn } from "@/lib/utils";

/** Centered single-card screen for login, registration and account recovery. */
function AuthLayout({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <main data-slot="auth-layout" className="flex min-h-screen items-center justify-center px-page-mobile py-section">
      <div
        data-slot="auth-layout-panel"
        className={cn("flex w-full max-w-sm flex-col gap-6 rounded-[var(--radius-card)] border bg-card p-6 text-card-foreground sm:p-8", className)}
        {...props}
      >
        {children}
      </div>
    </main>
  );
}

function AuthLayoutHeader({ className, ...props }: React.ComponentProps<"header">) {
  return <header data-slot="auth-layout-header" className={cn("flex flex-col gap-2", className)} {...props} />;
}

function AuthLayoutTitle({ className, ...props }: React.ComponentProps<"h1">) {
  return <h1 data-slot="auth-layout-title" className={cn("text-2xl font-semibold", className)} {...props} />;
}

function AuthLayoutDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p data-slot="auth-layout-description" className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

/** Secondary links under the form ("¿No tienes cuenta?"). */
function AuthLayoutFooter({ className, ...props }: React.ComponentProps<"footer">) {
  return <footer data-slot="auth-layout-footer" className={cn("flex flex-col items-center gap-3 text-center text-sm text-muted-foreground", className)} {...props} />;
}

export { AuthLayout, AuthLayoutHeader, AuthLayoutTitle, AuthLayoutDescription, AuthLayoutFooter };
