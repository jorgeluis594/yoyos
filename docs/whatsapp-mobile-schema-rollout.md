# WhatsApp mobile schema rollout

1. Back up PostgreSQL and deploy the schema migration with the normal `create-role.sql` → `prisma migrate deploy` → `provision-role.sql` sequence. Keep persistent volumes. The migration adds nullable fields, widens Contact identity, and preserves Cloud API rows and tenant policies.
2. Deploy readers that understand phone-free LID contacts and `metadata_only` images before enabling any mobile message writes. Keep the new HTTP route disabled until its end-to-end gate passes.
3. Confirm Cloud API webhook ingestion, contact search, direct sale selection, and tenant isolation against the migrated database. Then enable the mobile route in a separate release.

If a release fails before mobile writes begin, restore the prior application only after confirming its readers can handle the migrated schema. After accepting a contact without a phone or a `metadata_only` image, the old application is not a safe rollback target. Disable the mobile route, fix or redeploy compatible readers, and preserve accepted rows; do not delete records or revert the schema to make an old binary start.

The new partial Cloud API index is created concurrently before the old global index is dropped. The enum value is committed before the replacement content check uses it. Concurrent index builds can wait on long transactions; schedule the migration during a low-write period and inspect PostgreSQL state before retrying a failed deploy. The migration uses a five-second DDL lock timeout; no production deployment is part of this change.
