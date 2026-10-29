import { useState } from "react";
import { useTranslation } from "react-i18next";
import { defaultPhoneCountry, joinPhone, phoneCountries, splitPhone } from "@shared/phone";
import { Field, FieldError, FieldLabel } from "@mobile/components/ui/field";
import { Input } from "@mobile/components/ui/input";
import { OptionSelector } from "@mobile/components/ui/option-selector";

type Props = Readonly<{ value: string; onChange: (phone: string) => void; label: string; testID: string; invalid: boolean; disabled?: boolean; required?: boolean; onBlur?: () => void }>;

/** Country selector plus national number over an E.164 value; a value changed from outside (a prefill) is split back into both parts. */
export function PhoneField({ value, onChange, label, testID, invalid, disabled, required, onBlur }: Props) {
  const { t } = useTranslation();
  const initial = splitPhone(value);
  const [country, setCountry] = useState(initial?.country ?? defaultPhoneCountry);
  const [national, setNational] = useState(initial?.national ?? value);
  const [synced, setSynced] = useState(value);
  if (value !== synced) {
    const outside = splitPhone(value);
    setSynced(value);
    if (outside) { setCountry(outside.country); setNational(outside.national); } else setNational(value);
  }
  const change = (nextCountry: string, nextNational: string) => {
    const next = joinPhone(nextCountry, nextNational);
    setCountry(nextCountry); setNational(nextNational); setSynced(next); onChange(next);
  };
  return <>
    <Field disabled={disabled}><FieldLabel>{t("customerCountry")}</FieldLabel>
      <OptionSelector testID={`${testID}-country`} value={country} onValueChange={next => change(next ?? defaultPhoneCountry, national)}
        options={phoneCountries.map(entry => ({ value: entry.iso, label: `${entry.iso} +${entry.dial}` }))} /></Field>
    <Field required={required} invalid={invalid} disabled={disabled}><FieldLabel>{label}</FieldLabel>
      <Input value={national} onChangeText={next => change(country, next)} onBlur={onBlur} invalid={invalid} keyboardType="phone-pad" accessibilityLabel={label} />
      {invalid ? <FieldError>{t("customerPhoneInvalid")}</FieldError> : null}</Field>
  </>;
}
