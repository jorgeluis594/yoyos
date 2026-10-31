-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;

-- Orders already stored keep the order their lines were read in until now (by id).
UPDATE "OrderItem" i SET "position" = ranked.position
FROM (SELECT id, (row_number() OVER (PARTITION BY "orderId" ORDER BY id) - 1)::int AS position FROM "OrderItem") AS ranked
WHERE i.id = ranked.id;
