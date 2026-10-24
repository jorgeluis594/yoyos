import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@core/app/components/ui/input";
import { controlClass } from "@core/app/components/ui/field";
import { defaultPhoneCountry, joinPhone, phoneCountries, splitPhone } from "@shared/phone";

export type PhoneFieldProps = Readonly<{
  /** Id of the national number input; the field's label points at it. */
  id: string;
  /** The phone in E.164 (`+51977909427`), or "" while empty. Leave it out for an uncontrolled field seeded by `defaultValue`. */
  value?: string;
  defaultValue?: string;
  onChange?: (phone: string) => void;
  onBlur?: () => void;
  invalid?: boolean;
  describedBy?: string;
  disabled?: boolean;
  required?: boolean;
}>;

type Parts = Readonly<{ country: string; text: string }>;
const parts = (phone: string, fallback = defaultPhoneCountry): Parts => {
  const split = splitPhone(phone);
  return split ? { country: split.country, text: split.national } : { country: fallback, text: "" };
};

function useCountryOptions(language: string) {
  return useMemo(() => {
    const names = new Intl.DisplayNames([language], { type: "region" });
    return phoneCountries.map(({ iso, dial }) => ({ iso, label: `${iso} +${dial} · ${names.of(iso) ?? iso}`, name: names.of(iso) ?? iso }))
      .sort((a, b) => a.name.localeCompare(b.name, language));
  }, [language]);
}

/** Country selector plus the number in national format; reports the E.164 phone ("" until digits are typed). */
export function PhoneField({ id, value, defaultValue = "", onChange, onBlur, invalid, describedBy, disabled, required }: PhoneFieldProps) {
  const { t, i18n } = useTranslation();
  const options = useCountryOptions(i18n.language);
  const [state, setState] = useState<Parts>(() => parts(value ?? defaultValue));
  // A controlled value changed from outside (a reset, a saved phone): follow it, unless it is what the user just typed.
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (value !== undefined && joinPhone(state.country, state.text) !== value) setState(parts(value, state.country));
  }
  const update = (next: Parts) => { setState(next); onChange?.(joinPhone(next.country, next.text)); };
  const type = (text: string) => {
    const pasted = text.trimStart().startsWith("+") ? splitPhone(text) : null;
    update(pasted ? { country: pasted.country, text: pasted.national } : { country: state.country, text: text.replace(/[^\d\s().-]/g, "") });
  };
  return <div data-store-part="phone" className="flex gap-2">
    <select data-slot="select" aria-label={t("phoneField.country")} className={`${controlClass} w-[8.5rem] shrink-0`} value={state.country} disabled={disabled} onBlur={onBlur}
      onChange={event => update({ country: event.target.value, text: state.text })}>
      {options.map(option => <option key={option.iso} value={option.iso}>{option.label}</option>)}
    </select>
    <Input id={id} type="tel" inputMode="tel" autoComplete="tel-national" required={required} disabled={disabled} placeholder={t("phoneField.placeholder")}
      aria-invalid={invalid} aria-describedby={describedBy} value={state.text} onBlur={onBlur} onChange={event => type(event.target.value)} />
  </div>;
}
