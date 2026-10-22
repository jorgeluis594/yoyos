import { RadioGroup } from "radix-ui";
import { Check } from "lucide-react";
import { storeThemeIds, storeThemes, type StoreThemeId } from "@shared/store-themes";
import { ThemeSample } from "@core/src/features/store-appearance/presentation/theme-sample";

type ThemePickerProps = Readonly<{
  value: StoreThemeId;
  onChange: (theme: StoreThemeId) => void;
  /** Accessible name of the group. */
  label: string;
  /** The route passes the translated descriptions, so this component owns no translation keys. */
  descriptions: Readonly<Record<StoreThemeId, string>>;
}>;

const isTheme = (value: string): value is StoreThemeId => (storeThemeIds as readonly string[]).includes(value);

/** The five themes in catalog order, each with a sample made from its own values. Choosing the selected theme changes nothing. */
export function ThemePicker({ value, onChange, label, descriptions }: ThemePickerProps) {
  return <RadioGroup.Root value={value} aria-label={label} className="grid gap-3"
    onValueChange={(next) => { if (isTheme(next) && next !== value) onChange(next); }}>
    {storeThemeIds.map((id) => <RadioGroup.Item key={id} value={id}
      className="relative flex min-h-touch w-full cursor-pointer items-center gap-3 rounded-[var(--radius-control)] border bg-card p-3 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring data-[state=checked]:border-primary data-[state=checked]:bg-accent">
      <ThemeSample theme={id} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-medium">{storeThemes[id].name}</span>
        <span className="text-sm text-muted-foreground">{descriptions[id]}</span>
      </span>
      <RadioGroup.Indicator className="shrink-0 text-primary"><Check aria-hidden="true" className="size-5" /></RadioGroup.Indicator>
    </RadioGroup.Item>)}
  </RadioGroup.Root>;
}
