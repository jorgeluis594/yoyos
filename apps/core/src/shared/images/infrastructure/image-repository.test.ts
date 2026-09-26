import { Prisma } from "@prisma/client";
import { afterEach, expect, it, vi } from "vitest";
import { imageRepository } from "@core/src/shared/images/infrastructure/image-repository";

const queries = vi.hoisted(() => ({ create: vi.fn(), findUnique: vi.fn() }));
vi.mock("@core/src/shared/infrastructure/persistance", () => ({ prisma: { image: queries } }));

afterEach(() => vi.restoreAllMocks());

const operations = [
  { name: "create", query: queries.create, run: () => imageRepository.create("remote") },
  { name: "find", query: queries.findUnique, run: () => imageRepository.find("image") },
];
const prismaFailures = [
  new Prisma.PrismaClientKnownRequestError("database down", { code: "P1001", clientVersion: "7.10.0" }),
  new Prisma.PrismaClientUnknownRequestError("database down", { clientVersion: "7.10.0" }),
  new Prisma.PrismaClientInitializationError("database down", "7.10.0"),
];

for (const operation of operations) {
  it.each(prismaFailures)(`${operation.name} translates %s`, async (failure) => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    operation.query.mockRejectedValueOnce(failure);
    expect(await operation.run()).toEqual({
      success: false,
      error: { code: "PERSISTENCE_UNAVAILABLE", message: `Unable to ${operation.name === "find" ? "find" : "create"} image record` },
    });
    expect(logged).toHaveBeenCalledWith(expect.any(String), failure);
  });

  it(`${operation.name} lets unexpected errors reach the caller`, async () => {
    const failure = new Error("unexpected");
    operation.query.mockRejectedValueOnce(failure);
    await expect(operation.run()).rejects.toBe(failure);
  });
}
