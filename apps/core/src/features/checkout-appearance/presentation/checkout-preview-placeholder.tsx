import { useTranslation } from "react-i18next";
import { CheckoutTheme } from "@core/src/features/checkout-appearance/presentation/checkout-theme";
import type { CheckoutPreviewMode, PublicCheckoutAppearance } from "@core/src/features/checkout-appearance/presentation/checkout-appearance-schemas";

type CheckoutPreviewPlaceholderProps = Readonly<{
  /** Draft appearance, in the shape the buyer receives. */
  appearance: PublicCheckoutAppearance;
  mode: CheckoutPreviewMode;
  onModeChange: (mode: CheckoutPreviewMode) => void;
}>;

const modes: readonly CheckoutPreviewMode[] = ["light", "dark"];

/**
 * Reserved space with the final dimensions of the live preview (phone width, scrollable canvas).
 * Replace with `<CheckoutPreviewFrame>`; the props are identical.
 */
export function CheckoutPreviewPlaceholder({ appearance, mode, onModeChange }: CheckoutPreviewPlaceholderProps) {
  const { t } = useTranslation();
  return <div className="flex min-w-0 flex-col items-center gap-4" data-testid="checkout-preview-slot">
    <div role="group" aria-label={t("checkoutAppearance.previewMode")} className="flex gap-1 rounded-md border bg-card p-1">
      {modes.map((option) => <button
        key={option} type="button" aria-pressed={mode === option} onClick={() => onModeChange(option)}
        className="min-h-9 rounded-sm px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-accent aria-pressed:text-accent-foreground"
      >{t(option === "light" ? "checkoutAppearance.modeLight" : "checkoutAppearance.modeDark")}</button>)}
    </div>
    <div className={`w-full max-w-[390px] overflow-hidden rounded-3xl border-8 border-foreground ${mode === "dark" ? "dark" : ""}`}>
      <CheckoutTheme appearance={appearance}>
        <div className="flex min-h-[640px] flex-col gap-4 p-4">
          {appearance.logoUrl && <span className="flex h-10 max-w-40 items-center self-start rounded-sm border bg-white px-2 py-1">
            <img src={appearance.logoUrl} alt="" className="max-h-full max-w-full object-contain" />
          </span>}
          <p className="text-sm text-muted-foreground">{t("checkoutAppearance.previewPlaceholder")}</p>
          <div className="mt-auto rounded-md bg-primary px-4 py-3 text-center text-sm font-medium text-primary-foreground" aria-hidden="true" />
        </div>
      </CheckoutTheme>
    </div>
  </div>;
}
