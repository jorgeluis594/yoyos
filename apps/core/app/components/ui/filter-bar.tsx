import type { ReactNode } from "react";
import { Form } from "react-router";
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

  return <div className="mt-6 flex flex-wrap items-end gap-3">
    <Form method="get" role="search" className="flex min-w-0 flex-1 flex-wrap items-end gap-3">
      {hiddenFields.map(({ name, value }) => <input key={name} type="hidden" name={name} value={value} />)}
      <Field className="min-w-0 flex-1 basis-48">
        <FieldLabel htmlFor={searchId}>{searchLabel}</FieldLabel>
        <Input id={searchId} name={searchName} type="search" defaultValue={searchValue} />
      </Field>
      <Button type="submit">{submitLabel}</Button>
    </Form>
    {action}
  </div>;
}
