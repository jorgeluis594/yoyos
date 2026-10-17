import logoDark from "@/assets/brand/yoyos-logo-dark.svg";
import logoLight from "@/assets/brand/yoyos-logo-light.svg";
import { cn } from "@/lib/utils";

/** Yoyos wordmark; swaps with the `dark` class the theme toggle sets on <html>. */
export function BrandLogo({ className }: { className?: string }) {
  return <>
    <img src={logoLight} alt="Yoyos" className={cn("h-8 w-auto dark:hidden", className)} />
    <img src={logoDark} alt="Yoyos" className={cn("hidden h-8 w-auto dark:block", className)} />
  </>;
}
