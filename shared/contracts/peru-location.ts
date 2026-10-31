import { z } from "zod";
import { parsePeruAreaSelection } from "@shared/peru-geography";

export const peruDepartmentCodeSchema = z.string().regex(/^\d{2}$/);
export const peruProvinceCodeSchema = z.string().regex(/^\d{4}$/);
export const peruDistrictCodeSchema = z.string().regex(/^\d{6}$/);
/** Canonical catalog selection; the caps are the catalog's size. */
export const peruAreaSelectionSchema = z.strictObject({
  departmentCodes: z.array(peruDepartmentCodeSchema).max(25), provinceCodes: z.array(peruProvinceCodeSchema).max(196),
  districtCodes: z.array(peruDistrictCodeSchema).max(1892),
}).transform((value, context) => {
  const parsed = parsePeruAreaSelection(value);
  if (parsed.success) return parsed.data;
  context.issues.push({ code: "custom", input: value, path: [parsed.error.field], message: parsed.error.message });
  return z.NEVER;
});
export const peruDeliveryDistrictSchema = z.strictObject({
  country: z.literal("PE"), districtCode: peruDistrictCodeSchema,
  district: z.string().trim().min(1).max(120), province: z.string().trim().min(1).max(120), department: z.string().trim().min(1).max(120),
});
export type PeruDeliveryDistrictContract = z.infer<typeof peruDeliveryDistrictSchema>;
