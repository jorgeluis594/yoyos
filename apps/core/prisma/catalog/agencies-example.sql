-- Example agency load (D5). Run with a role that can write the catalog (not core_app), after the migrations and the courier seed.
-- Rules: the UUID is generated here and never reused for another agency; "districtCode" must exist in shared/peru-geography.ts
-- (the CHECK only validates the format); to retire an agency set enabled = false instead of deleting it.
INSERT INTO "DeliveryAgency" (id, "courierId", name, address, "districtCode", enabled)
VALUES (
  '6f1c2f0e-4a53-4d0b-9a57-0d3f5b1e8c11',
  (SELECT id FROM "Courier" WHERE code = 'shalom'),
  'Shalom Miraflores',
  'Av. Larco 1301, Miraflores',
  '150122',
  true
)
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name, address = EXCLUDED.address, "districtCode" = EXCLUDED."districtCode", enabled = EXCLUDED.enabled;

-- Retire an agency (it stays referenced by existing options and orders):
-- UPDATE "DeliveryAgency" SET enabled = false WHERE id = '6f1c2f0e-4a53-4d0b-9a57-0d3f5b1e8c11';
