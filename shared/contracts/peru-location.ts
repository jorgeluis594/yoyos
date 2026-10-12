import { z } from "zod";

export const peruDistrictCodeSchema = z.string().regex(/^\d{6}$/);
export const peruDeliveryDistrictSchema = z.strictObject({
  country: z.literal("PE"), districtCode: peruDistrictCodeSchema,
  district: z.string().trim().min(1).max(120), province: z.string().trim().min(1).max(120), department: z.string().trim().min(1).max(120),
});
export type PeruDeliveryDistrictContract = z.infer<typeof peruDeliveryDistrictSchema>;
