import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { jwt } from "better-auth/plugins/jwt";
import { expo } from "@better-auth/expo";
import { systemPrisma } from "@core/src/shared/infrastructure/persistance";

export const authIssuer = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

export const auth = betterAuth({
  baseURL: authIssuer,
  database: prismaAdapter(systemPrisma, { provider: "postgresql" }),
  emailAndPassword: { enabled: true },
  session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
  trustedOrigins: ["yoyos://", ...(process.env.NODE_ENV === "development" ? ["exp://**"] : [])],
  plugins: [expo(), jwt({
    jwt: {
      issuer: authIssuer,
      audience: "yoyos-core-api",
      expirationTime: "15m",
      definePayload: ({ session }) => ({ sid: session.id }),
    },
  })],
});
