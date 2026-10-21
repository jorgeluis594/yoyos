import { contactMethodOptions, rubroOptions, type ContactMethod, type Rubro } from "@landing/src/content/demo-form";
import { track } from "@landing/src/lib/analytics";

type Field = HTMLInputElement | HTMLSelectElement;

const form = document.querySelector<HTMLFormElement>("[data-demo-form] form");
const button = form?.querySelector<HTMLButtonElement>('button[type="submit"]');

const messageOf = (field: Field) => form?.querySelector<HTMLElement>(`#${field.name}-error`);

function showError(field: Field): void {
  const message = messageOf(field);
  if (!message) return;
  message.textContent = field.dataset.error ?? "";
  message.hidden = false;
  field.setAttribute("aria-invalid", "true");
}

function clearError(field: Field): void {
  const message = messageOf(field);
  if (message) message.hidden = true;
  field.removeAttribute("aria-invalid");
}

const isRubro = (value: string): value is Rubro => rubroOptions.some((option) => option.value === value);
const isContactMethod = (value: string): value is ContactMethod => contactMethodOptions.some((option) => option.value === value);

if (form && button) {
  let submitting = false;
  const fields = [...form.querySelectorAll<Field>("[data-error]")];
  form.noValidate = true;

  form.addEventListener("submit", (event) => {
    const invalid = fields.filter((field) => !field.checkValidity());
    if (submitting || invalid.length > 0) {
      event.preventDefault();
      invalid.forEach(showError);
      if (invalid.length > 0) {
        invalid[0]?.focus();
        track({ name: "demo_form_error", location: "cta_final", reason: "validation" });
      }
      return;
    }
    submitting = true;
    button.textContent = form.dataset.sendingLabel ?? button.textContent;
    const data = new FormData(form);
    const rubro = String(data.get("rubro"));
    const contacto = String(data.get("contacto_preferido"));
    if (isRubro(rubro) && isContactMethod(contacto)) {
      track({ name: "demo_form_submit", location: "cta_final", rubro, contacto_preferido: contacto });
    }
  });

  for (const type of ["input", "change"]) {
    form.addEventListener(type, (event) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) clearError(event.target);
    });
  }
}
