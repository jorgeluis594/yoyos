import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import { useState, type ReactNode } from "react";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxList } from "@/components/ui/combobox";
import { cn } from "@/lib/utils";

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
export function LocationCombobox({ id, label, options, value, onChange, placeholder, emptyText, disabled = false, themed = false, describedBy, children }: Readonly<{
  id: string; label: string; options: readonly LocationOption[]; value: string | null; onChange: (code: string | null) => void;
  placeholder: string; emptyText: string; disabled?: boolean;
  /** Carries the hooks of the checkout themes; the seller views keep their own look. */
  themed?: boolean; describedBy?: string; children?: ReactNode;
}>) {
  const [query, setQuery] = useState("");
  const selected = options.find(option => option.code === value) ?? null;
  return <>
    <label htmlFor={id} {...(themed ? { "data-slot": "label" } : {})} className="text-sm font-medium">{label}</label>
    <Combobox items={options} value={selected} disabled={disabled} autoHighlight openOnInputClick
      itemToStringLabel={(option: LocationOption) => option.name} itemToStringValue={(option: LocationOption) => option.name} isItemEqualToValue={(a: LocationOption, b: LocationOption) => a.code === b.code}
      filter={(option: LocationOption, term: string) => matchesLocation(option.name, term)}
      onInputValueChange={(text, details) => setQuery(details.reason === "input-change" ? text : "")}
      onValueChange={(option: LocationOption | null) => onChange(option?.code ?? null)}>
      <ComboboxInput id={id} placeholder={placeholder} aria-describedby={describedBy} {...(themed ? { "data-slot": "input" } : {})} />
      <ComboboxContent>
        <ComboboxEmpty>{emptyText}</ComboboxEmpty>
        <ComboboxList>{(option: LocationOption) =>
          <ComboboxPrimitive.Item key={option.code} value={option} data-slot="combobox-item"
            className={cn("flex min-h-10 cursor-default items-center rounded-sm px-2 py-1.5 text-sm outline-none select-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[selected]:font-medium")}>
            <OptionLabel name={option.name} query={query} />
          </ComboboxPrimitive.Item>}</ComboboxList>
      </ComboboxContent>
    </Combobox>
    {children}
  </>;
}
