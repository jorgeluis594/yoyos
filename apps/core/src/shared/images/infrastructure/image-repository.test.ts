import { log } from "@core/src/shared/infrastructure/logger";
import { Prisma } from "@prisma/client";
import { afterEach, expect, it, vi } from "vitest";
import { imageRepository } from "@core/src/shared/images/infrastructure/image-repository";

const queries = vi.hoisted(() => ({ create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() }));
vi.mock("@core/src/shared/infrastructure/persistance", () => ({ prisma: { image: queries } }));

afterEach(() => vi.restoreAllMocks());

const operations = [
  { name: "create", query: queries.create, run: () => imageRepository.create("remote") },
  { name: "find", query: queries.findFirst, run: () => imageRepository.find("image") },
];

const prismaFailures = [
  new Prisma.PrismaClientKnownRequestError("database down", { code: "P1001", clientVersion: "7.10.0" }),
  new Prisma.PrismaClientUnknownRequestError("database down", { clientVersion: "7.10.0" }),
  new Prisma.PrismaClientInitializationError("database down", "7.10.0"),
];

for (const operation of operations) {
  it.each(prismaFailures)(`${operation.name} translates %s`, async (failure) => {
    const logged = vi.spyOn(log, "error").mockImplementation(() => {});
    operation.query.mockRejectedValueOnce(failure);
    expect(await operation.run()).toEqual({
      success: false,
      error: { code: "PERSISTENCE_UNAVAILABLE", message: `Unable to ${operation.name === "find" ? "find" : "create"} image record` },
    });
    expect(logged).toHaveBeenCalledWith(expect.objectContaining({ event: `unable_to_${operation.name}_image_record`, err: failure }), expect.any(String));
  });

  it(`${operation.name} lets unexpected errors reach the caller`, async () => {
    const failure = new Error("unexpected");
    operation.query.mockRejectedValueOnce(failure);
    await expect(operation.run()).rejects.toBe(failure);
  });
}

it("finds several images with a single query and skips empty lookups", async () => {
  queries.findMany.mockResolvedValueOnce([{ id: "a", storageKey: "a", visibility: "public" }]);
  expect(await imageRepository.findMany(["a", "b"])).toEqual({ success: true, data: [{ id: "a", storageKey: "a", visibility: "public" }] });
  expect(queries.findMany).toHaveBeenCalledOnce();
  expect(queries.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: { in: ["a", "b"] } }) }));
  expect(await imageRepository.findMany([])).toEqual({ success: true, data: [] });
  expect(queries.findMany).toHaveBeenCalledOnce();
});

it.each(prismaFailures)("findMany translates %s", async (failure) => {
  const logged = vi.spyOn(log, "error").mockImplementation(() => {});
  queries.findMany.mockRejectedValueOnce(failure);
  expect(await imageRepository.findMany(["a"])).toEqual({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE", message: "Unable to find image records" } });
  expect(logged).toHaveBeenCalledWith(expect.objectContaining({ event: "unable_to_find_image_records", err: failure }), expect.any(String));
});
