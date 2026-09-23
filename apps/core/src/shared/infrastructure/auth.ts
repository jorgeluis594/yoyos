import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { authPrisma } from "./persistance.js";

export const auth = betterAuth({
  database: prismaAdapter(authPrisma, { provider: "postgresql" }),
  emailAndPassword: { enabled: true },
});
