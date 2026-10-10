import { Prisma } from "@prisma/client";

export function isPersistenceFailure(cause: unknown): boolean {
  return cause instanceof Prisma.PrismaClientKnownRequestError
    || cause instanceof Prisma.PrismaClientUnknownRequestError
    || cause instanceof Prisma.PrismaClientInitializationError
    || (cause instanceof Error && cause.name === "DriverAdapterError" && typeof cause.cause === "object" && cause.cause !== null);
}
