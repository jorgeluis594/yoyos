import { contactMethodValues, rubroValues, type ContactMethod, type Rubro } from "@landing/src/content/demo-form-values";
import { track } from "@landing/src/lib/analytics";

type Field = HTMLInputElement | HTMLSelectElement;

const form = document.querySelector<HTMLFormElement>("[data-demo-form] form");
const button = form?.querySelector<HTMLButtonElement>('button[type="submit"]');

// A name made only of spaces is as empty as no name; the pattern of the field says the same without JavaScript.
const isValid = (field: Field) => field.checkValidity() && !(field.name === "nombre" && field.value.trim() === "");

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

const isRubro = (value: string): value is Rubro => rubroValues.some((option) => option === value);
const isContactMethod = (value: string): value is ContactMethod => contactMethodValues.some((option) => option === value);

if (form && button) {
  let submitting = false;
  const fields = [...form.querySelectorAll<Field>("[data-error]")];
  form.noValidate = true;

  form.addEventListener("submit", (event) => {
    const invalid = fields.filter((field) => !isValid(field));
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
    // The endpoint accepts spaces between the 3-3-3 groups too, but this form submits the plain 9 digits.
    const telefono = form.elements.namedItem("telefono");
    if (telefono instanceof HTMLInputElement) telefono.value = telefono.value.replaceAll(" ", "");
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
