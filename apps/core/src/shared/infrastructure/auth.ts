import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { systemPrisma } from "./persistance.js";

export const auth = betterAuth({
  database: prismaAdapter(systemPrisma, { provider: "postgresql" }),
  emailAndPassword: { enabled: true },
});
