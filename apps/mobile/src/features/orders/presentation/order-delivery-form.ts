import { z } from "zod";
import { setOrderDeliverySchema } from "@shared/contracts/orders";

// Keep incomplete and inactive fields in the draft; validate only the selected delivery.
export const orderDeliveryFormSchema = z.object({
  method: z.enum(["store", "home", "agency"]).nullable(),
  courierId: z.string(),
  agency: z.string(),
  address: z.string(),
  district: z.string(),
  instructions: z.string(),
  name: z.string(),
  phone: z.string(),
  documentType: z.enum(["absent", "national_id", "passport", "foreign_id"]),
  document: z.string(),
  charge: z.boolean(),
}).transform((values, ctx) => {
  const { method, courierId, agency, address, district, instructions, name, phone, documentType, document, charge } = values;
  const recipient = { name, phone, identity: documentType === "absent" ? { kind: "absent" } : { kind: "document", documentType, document } };
  const delivery = method === "store" ? { method, recipient }
    : method === "home" ? { method, recipient, destination: { address, district, instructions: instructions.trim() || null } }
    : { method, recipient, courierId, agency };
  const parsed = setOrderDeliverySchema.safeParse({ delivery, chargeDeliveryToCustomer: charge });
  if (parsed.success) return parsed.data;
  for (const issue of parsed.error.issues) {
    const field = issue.path.includes("identity") && documentType === "absent" ? "documentType" : issue.path.at(-1);
    ctx.addIssue({ code: "custom", path: [typeof field === "string" ? field : "method"],
      message: method === "agency" ? "invalidAgencyDelivery"
        : issue.path.includes("destination") ? "invalidHomeDestination" : "invalidOrderDelivery" });
  }
  return z.NEVER;
});

export type OrderDeliveryFormValues = z.input<typeof orderDeliveryFormSchema>;
