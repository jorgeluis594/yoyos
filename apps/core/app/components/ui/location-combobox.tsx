import { useState, type ReactNode } from "react";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import { SelectPortalContainer } from "@/components/ui/select";

export type LocationOption = Readonly<{ code: string; name: string }>;

const normalize = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("es").trim();

/** Accent- and case-insensitive match on the name only; the code is never searchable because it is never shown. */
export function matchesLocation(name: string, query: string): boolean {
  return normalize(name).includes(normalize(query));
}

/** Splits a name around the first match so the matched text can be bold, keeping the original accents. */
export function highlightMatch(name: string, query: string): Readonly<{ before: string; match: string; after: string }> | null {
  const term = normalize(query);
  if (!term) return null;
  // Normalizing each character keeps the indexes of the normalized text aligned with the original name.
  const chars = [...name];
  const normalized = chars.map(char => normalize(char));
  const text = normalized.join("");
  const start = text.indexOf(term);
  if (start < 0) return null;
  let offset = 0;
  let from = -1;
  let to = chars.length;
  for (let index = 0; index < chars.length; index++) {
    if (from < 0 && offset + normalized[index]!.length > start) from = index;
    offset += normalized[index]!.length;
    if (from >= 0 && offset >= start + term.length) { to = index + 1; break; }
  }
  return { before: chars.slice(0, from).join(""), match: chars.slice(from, to).join(""), after: chars.slice(to).join("") };
}

function OptionLabel({ name, query }: Readonly<{ name: string; query: string }>) {
  const parts = highlightMatch(name, query);
  return parts ? <span>{parts.before}<strong className="font-semibold">{parts.match}</strong>{parts.after}</span> : <span>{name}</span>;
}

/** Search and choose in the same control: a single-choice WAI-ARIA combobox over named options (codes travel only in `onChange`). */
export function LocationCombobox({ id, label, options, value, onChange, placeholder, emptyText, disabled = false, describedBy, children }: Readonly<{
  id: string; label: string; options: readonly LocationOption[]; value: string | null; onChange: (code: string | null) => void;
  placeholder: string; emptyText: string; disabled?: boolean;
  describedBy?: string; children?: ReactNode;
}>) {
  const [query, setQuery] = useState("");
  // The list is portaled out of its field; inside a store theme it must stay in that subtree to take the theme's tokens.
  const [labelElement, setLabelElement] = useState<HTMLLabelElement | null>(null);
  const themeRoot = labelElement?.closest<HTMLElement>("[data-store-theme]") ?? null;
  const selected = options.find(option => option.code === value) ?? null;
  return <SelectPortalContainer.Provider value={themeRoot}>
    <Label ref={setLabelElement} htmlFor={id}>{label}</Label>
    <Combobox items={options} value={selected} disabled={disabled} autoHighlight openOnInputClick
      itemToStringLabel={(option: LocationOption) => option.name} itemToStringValue={(option: LocationOption) => option.name} isItemEqualToValue={(a: LocationOption, b: LocationOption) => a.code === b.code}
      filter={(option: LocationOption, term: string) => matchesLocation(option.name, term)}
      onInputValueChange={(text, details) => setQuery(details.reason === "input-change" ? text : "")}
      onValueChange={(option: LocationOption | null) => onChange(option?.code ?? null)}>
      <ComboboxInput id={id} placeholder={placeholder} aria-describedby={describedBy} data-slot="input" />
      <ComboboxContent>
        <ComboboxEmpty>{emptyText}</ComboboxEmpty>
        <ComboboxList aria-label={label}>{(option: LocationOption) =>
          <ComboboxItem key={option.code} value={option}><OptionLabel name={option.name} query={query} /></ComboboxItem>}</ComboboxList>
      </ComboboxContent>
    </Combobox>
    {children}
  </SelectPortalContainer.Provider>;
}
