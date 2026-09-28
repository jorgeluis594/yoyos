import type { ReactNode } from "react";
import { Form } from "react-router";
import { Search } from "lucide-react";
import { Button } from "@core/app/components/ui/button";
import { Field, FieldLabel } from "@core/app/components/ui/field";
import { Input } from "@core/app/components/ui/input";

type FilterBarProps = {
  searchName: string;
  searchValue: string;
  searchLabel: string;
  submitLabel: string;
  hiddenFields?: { name: string; value: string }[];
  action?: ReactNode;
};

export function FilterBar({ searchName, searchValue, searchLabel, submitLabel, hiddenFields = [], action }: FilterBarProps) {
  const searchId = `${searchName}-search`;

  return <div className="mt-6 flex items-end gap-3">
    <Form method="get" role="search" className="min-w-0 flex-1">
      {hiddenFields.map(({ name, value }) => <input key={name} type="hidden" name={name} value={value} />)}
      <Field className="min-w-0">
        <FieldLabel htmlFor={searchId}>{searchLabel}</FieldLabel>
        <div className="relative">
          <Input id={searchId} name={searchName} type="search" defaultValue={searchValue} className="min-h-11 pl-12" />
          <Button type="submit" variant="ghost" size="icon-lg" aria-label={submitLabel} className="absolute inset-y-0 left-0 h-full w-11 rounded-r-none">
            <Search aria-hidden="true" />
          </Button>
        </div>
      </Field>
    </Form>
    {action}
  </div>;
}
