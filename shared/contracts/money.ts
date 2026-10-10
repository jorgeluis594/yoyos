import { z } from "zod";
import { currencies } from "@shared/money";

export const moneySchema = z.strictObject({ amount: z.number().finite(), currency: z.enum(currencies) });
