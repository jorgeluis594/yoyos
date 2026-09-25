import type { Meta, StoryObj } from "@storybook/react-vite";
import { Field, FieldError, FieldLabel } from "./field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "./select";

const meta = {
  title: "Design System/Components/Select",
  component: Select,
} satisfies Meta<typeof Select>;
export default meta;

type Story = StoryObj<typeof meta>;

const countries = [
  { value: null, label: "Selecciona un país" },
  { value: "PE", label: "Perú" },
  { value: "CO", label: "Colombia" },
  { value: "AR", label: "Argentina" },
  { value: "CL", label: "Chile" },
];

function CountrySelect({ name, id, defaultValue = null, disabled = false, invalid = false, describedBy }: { name: string; id?: string; defaultValue?: string | null; disabled?: boolean; invalid?: boolean; describedBy?: string }) {
  return (
    <Select name={name} items={countries} defaultValue={defaultValue} disabled={disabled}>
      <SelectTrigger id={id} aria-invalid={invalid || undefined} aria-describedby={describedBy}>
        <SelectValue placeholder="Selecciona un país" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {countries.map((country) => <SelectItem key={country.value ?? "placeholder"} value={country.value} disabled={country.value === null}>{country.label}</SelectItem>)}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

export const Default: Story = {
  render: () => <div className="max-w-form"><CountrySelect name="country" /></div>,
};

export const States: Story = {
  name: "Estados",
  render: () => (
    <div className="flex max-w-form flex-col gap-4">
      <CountrySelect name="normal" id="country-normal" defaultValue="PE" />
      <CountrySelect name="disabled" defaultValue="PE" disabled />
      <CountrySelect name="invalid" invalid />
    </div>
  ),
};

export const WithField: Story = {
  name: "Dentro de Field",
  render: () => (
    <div className="flex max-w-form flex-col gap-6">
      <Field>
        <FieldLabel htmlFor="country">País</FieldLabel>
        <CountrySelect name="country" id="country" />
      </Field>
      <Field data-invalid>
        <FieldLabel htmlFor="country-invalid">País</FieldLabel>
        <CountrySelect name="countryInvalid" id="country-invalid" invalid describedBy="country-invalid-error" />
        <FieldError id="country-invalid-error">Selecciona un país válido.</FieldError>
      </Field>
    </div>
  ),
};
