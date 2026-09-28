import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { jwt } from "better-auth/plugins/jwt";
import { expo } from "@better-auth/expo";
import { systemPrisma } from "@core/src/shared/infrastructure/persistance";
import { accountEmails } from "@core/src/features/users/composition";

export const authIssuer = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

export const auth = betterAuth({
  baseURL: authIssuer,
  database: prismaAdapter(systemPrisma, { provider: "postgresql" }),
  emailVerification: {
    sendOnSignUp: true,
    expiresIn: 60 * 60 * 24,
    autoSignInAfterVerification: false,
    sendVerificationEmail: async ({ user, url }) => accountEmails.sendVerification(user.email, url),
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    autoSignIn: false,
    resetPasswordTokenExpiresIn: 60 * 30,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => accountEmails.sendReset(user.email, url),
    onExistingUserSignUp: async ({ user }) => {
      if (!user.emailVerified) {
        try {
          await auth.api.sendVerificationEmail({ body: { email: user.email, callbackURL: `${authIssuer}/account-verified` } });
        } catch {
          console.error("[email] verification resend failed", { code: "AUTH_CALLBACK_FAILED" });
        }
      }
    },
  },
  session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
  trustedOrigins: [authIssuer, "yoyos://", ...(process.env.NODE_ENV === "development" ? ["exp://**"] : [])],
  plugins: [expo(), jwt({
    jwt: {
      issuer: authIssuer,
      audience: "yoyos-core-api",
      expirationTime: "15m",
      definePayload: ({ session }) => ({ sid: session.id }),
    },
  })],
});
