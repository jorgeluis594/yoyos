import { auth } from "./auth.js";
import { authPrisma } from "./prisma.js";

export async function resolveCurrentUser(headers: Headers) {
  const session = await auth.api.getSession({ headers });
  if (!session) return null;
  return authPrisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, companyId: true },
  });
}
