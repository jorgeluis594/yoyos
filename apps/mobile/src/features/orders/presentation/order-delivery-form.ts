import { z } from "zod";
import { setRatedOrderDeliverySchema } from "@shared/contracts/orders";
import { moneySchema } from "@shared/contracts/money";
import { currencies } from "@shared/money";
import { getPeruDistrict } from "@shared/peru-geography";

// Keep incomplete and inactive fields in the draft; validate only the selected delivery.
export const orderDeliveryFormSchema = z.object({
  method: z.enum(["store", "home", "agency"]).nullable(),
  rateId: z.string(),
  price: moneySchema.nullable(),
  currency: z.enum(currencies),
  address: z.string(),
  districtCode: z.string(),
  instructions: z.string(),
  name: z.string(),
  phone: z.string(),
  documentType: z.enum(["absent", "national_id", "passport", "foreign_id"]),
  document: z.string(),
}).transform((values, ctx) => {
  const { method, rateId, price, currency, address, districtCode, instructions, name, phone, documentType, document } = values;
  if (method !== "store" && !getPeruDistrict(districtCode)) {
    ctx.addIssue({ code: "custom", path: ["districtCode"], message: "invalidHomeDestination" });
    return z.NEVER;
  }
  const recipient = { name, phone, identity: documentType === "absent" ? { kind: "absent" } : { kind: "document", documentType, document } };
  const delivery = method === "store" ? { method, recipient }
    : method === "home" ? { method, recipient, rateId, destination: { address, districtCode, instructions: instructions.trim() || null } }
    : { method, recipient, rateId, districtCode };
  const parsed = setRatedOrderDeliverySchema.safeParse({ delivery, expectedPrice: method === "store" ? { amount: 0, currency } : price });
  if (parsed.success) return parsed.data;
  for (const issue of parsed.error.issues) {
    const field = issue.path.includes("identity") && documentType === "absent" ? "documentType" : issue.path.at(-1);
    ctx.addIssue({ code: "custom", path: [typeof field === "string" ? field : "method"],
      message: method === "agency" ? "invalidRatedAgencyRecipient"
        : issue.path.includes("destination") ? "invalidHomeDestination" : "invalidOrderDelivery" });
  }
  return z.NEVER;
});

export type OrderDeliveryFormValues = z.input<typeof orderDeliveryFormSchema>;
