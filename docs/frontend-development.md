# Frontend Development

This document records conventions for the core web frontend in `apps/core`.

## Forms

Use React Hook Form to manage form state. Zod defines validation rules, and
`zodResolver` connects the two.

- Initialize forms with `useForm`, a Zod resolver, and explicit `defaultValues`.
- Connect controlled inputs through `Controller`. Compose fields with the existing
  `FieldGroup`, `Field`, `FieldLabel`, and `FieldError` components.
- Display errors next to their fields. Set `data-invalid` on `Field` and
  `aria-invalid` on its input, and associate labels with inputs.
- Use `useFieldArray` for dynamic rows, such as delivery couriers.
- Use `formState.isDirty` to track unsaved changes instead of a separate flag.
  Reset the form after a confirmed successful save; preserve edits on failures
  and background data revalidation.
- Submit through `handleSubmit`. For tabbed forms, reveal the tab containing an
  invalid field before focusing it.

Reuse shared Zod schemas or their field schemas where their requirements match.
Keep incomplete editable drafts separate from valid domain settings, and adapt
form values to the request contract when their shapes differ.

Client-side validation provides immediate feedback. Keep server-side Zod
validation and domain rules authoritative, including version conflict checks.
Follow [Programming Style](programming-style.md) for JSON boundary validation.

Apply this convention to new forms and when refactoring existing forms. Existing
forms may still use manual state until they are migrated.

### Example

```tsx
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@core/app/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@core/app/components/ui/field";
import { Input } from "@core/app/components/ui/input";

const schema = z.object({ name: z.string().trim().min(1, "Enter a name.") });
type Values = z.infer<typeof schema>;

function NameForm({ onSave }: { onSave: (values: Values) => Promise<void> }) {
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: "" },
  });

  return (
    <form onSubmit={form.handleSubmit(onSave)}>
      <FieldGroup>
        <Controller
          name="name"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="name">Name</FieldLabel>
              <Input {...field} id="name" aria-invalid={fieldState.invalid} />
              {fieldState.error && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
        <Button type="submit" disabled={form.formState.isSubmitting}>Save</Button>
      </FieldGroup>
    </form>
  );
}
```
