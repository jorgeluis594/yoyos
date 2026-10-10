# WhatsApp mobile message API validation

Validated revision: `613d0a2` plus this documentation commit. The normative contract and scenario definitions are in `whatsapp-mobile-message-api-implementation.md` and `whatsapp-mobile-message-api-tasks.md`. This record describes the local API and its existing consumers; it does not certify a mobile consumer or a production rollout.

## Scenario evidence

The core Vitest configuration includes `src/**/*.{test,spec}.{ts,tsx}` in `unit`, `src/**/*.test.mjs` and `src/**/*.integration.test.ts` in `integration`, and `tests/e2e/**/*.spec.ts` in `e2e`. These paths therefore run in the six-command gate below.

| Scenario | Assertions and test locations |
| --- | --- |
| U01 | `apps/core/src/features/chats/presentation/mobile-message-schemas.test.ts`: text and image variants in both directions, optional image metadata and exact native-to-input mapping. Stored projection: `mobile-message-repository.integration.test.ts`. |
| U02 | `mobile-message-schemas.test.ts`: missing, empty, null, mixed, unsupported, coerced and unknown fields at every request level. |
| U03 | `mobile-message-schemas.test.ts`: LID, native ID prefix/encoding/UTF-8/JSON and exact tuple validation, including escaped equivalent IDs. |
| U04 | `mobile-message-schemas.test.ts`: exact and over-limit UTF-8 sizes, image size/MIME, scalar Unicode, whitespace and NUL. |
| U05 | `mobile-message-schemas.test.ts`: zero, historical, future and maximum timestamps; negative, fractional, non-finite and over-limit rejection. |
| U06 | `apps/core/src/features/chats/application/register-mobile-message.test.ts`: store then publish then mark, no publish after store failure. `mobile-message-dispatch.integration.test.ts`: separate database observer sees committed row; deferred commit failure publishes nothing. |
| U07 | `register-mobile-message.test.ts`: confirmed duplicate skips dispatch; pending duplicate uses original row despite changed request. `mobile-message-repository.integration.test.ts`: first content and dates remain unchanged. |
| U08 | `register-mobile-message.test.ts`: bus and marker failures followed by stable retry. `mobile-message-dispatch.integration.test.ts`: real provider and marker failure recovery. |
| U09 | `apps/core/src/features/chats/infrastructure/mobile-message-dispatch.test.ts` and `register-mobile-message.test.ts`: malformed payload/metadata, wrong tenant, unavailable bus and unexpected exception. |
| U10 | `apps/core/src/features/chats/presentation/mobile-message-routes.test.ts`, `mobile-message-schemas.test.ts` and `apps/core/src/shared/infrastructure/api-auth-middleware.test.ts`: strict output/error schema, parser, body limits, status mappings, invalid output and sanitized failures. E01–E06 assert HTTP status and `no-store` on the real route. |
| U11 | `apps/core/src/features/chats/domain/mobile-message-types.test.ts`: `@ts-expect-error` for event name/payload, mixed content and nominal IDs; `typecheck` enforces these negative cases. |
| I01 | `apps/core/src/features/chats/infrastructure/mobile-message-repository.integration.test.ts`: six direction/content combinations, nullable metadata, safe integer, dates, Unicode, reused Contact/Chat and no Image row. |
| I02 | `mobile-message-repository.integration.test.ts`: sequential retries and 12 simultaneous first registrations, one creator and identical persisted winner. |
| I03 | `mobile-message-repository.integration.test.ts`: account/chat/protocol/company independence, uploader independence and Cloud API external-ID coexistence. |
| I04 | `mobile-message-repository.integration.test.ts`: tenant reads/writes/foreign links, RLS policies, role grants, defaults and composite FKs. |
| I05 | The same repository and migration tests: insert and deferred commit rollback, unrelated UUID collision, and real SQL CHECK failures. |
| I06 | `apps/core/src/features/chats/infrastructure/mobile-message-dispatch.integration.test.ts`: tenant-scoped first marker, missing row and failed marker retaining the message. |
| I07 | `mobile-message-dispatch.integration.test.ts`: new composition/runtime recovers the persisted pending row and stable event after retry. |
| I08 | `mobile-message-dispatch.integration.test.ts`: real pg-boss provider without subscribers, no retained job, stopped provider failure and restart recovery. |
| I09 | `mobile-message-dispatch.integration.test.ts`: concurrent registration uses one row and one logical event ID while allowing repeated publish attempts. |
| I10 | `contact-repository.integration.test.ts`: phone-free LID identity and sale exclusion. `chats/infrastructure/chat-persistence.test.mjs` and webhook tests: old ingestion and image states. |
| E01 | `apps/core/tests/e2e/mobile-whatsapp-messages.spec.ts`: real authenticated POST returns 201 and tenant row with confirmed marker. |
| E02 | The same E2E file: ignored-response retry returns 200 with same IDs/date and original content. |
| E03 | The same E2E file: minimal historical outgoing image returns 201 with nullable metadata and no stored image ID; I01 also checks no Image row. |
| E04 | The same E2E file: 401/403/409, no writes, distinct tenant rows, unchanged A row/marker despite B's forged query/headers, and rejected forged body. |
| E05 | The same E2E file: malformed/duplicate JSON, media and encoding failures, 102400-byte accepted and 102401-byte rejected. |
| E06 | The same E2E file: dedicated HTTP listener with real provider failed startup against unavailable database, 503 and pending row, then new provider and 200 retry with original identity/date. |
| E07 | The same E2E file: ten HTTP requests, one creator/message ID and Cloud challenge/order-list smoke routes. Full `test:e2e` includes `whatsapp-chat.spec.ts` and order journeys for regression depth. |

Related regression coverage includes `apps/core/src/features/orders/presentation/api-routes.integration.test.ts` for sale contact search and `order_cancelled` publication, `apps/core/src/features/orders/infrastructure/order-repository.integration.test.ts` for buyer snapshots and cancelled-order dispatch, and the shared contract imports covered by core and mobile typechecks. The migration suite uses isolated temporary databases for replay; the new mobile-message integration and E2E fixtures create their own company/user IDs and clean those IDs. E06 proves failed provider startup and subsequent recovery; it does not simulate severing an already established pg-boss connection.

## Gate execution

Executed locally on macOS with Node 24.21.0, pnpm 12.5.1, PostgreSQL 18 and Mailpit in disposable containers on ports 55507, 11107 and 18107; E2E HTTP port 31107. `CORE_TEST_EXTERNAL_SERVICES=1` kept the test scripts on this isolated database while retaining role provisioning and real migrations. Dependencies were installed from frozen lockfiles in each package directory. Browser tests used installed Chromium. The logs below are local validation artifacts, not repository fixtures.

The exact executable was `/Users/jorgegonzalez/.local/share/mise/installs/pnpm/12.5.1/pnpm`, invoked from each package directory with `/Users/jorgegonzalez/.local/share/mise/installs/node/24.21.0/bin` and the pnpm installation directory first in `PATH`. For integration and E2E, the environment also set `CORE_TEST_EXTERNAL_SERVICES=1 CORE_TEST_PORT=55507 MAILPIT_SMTP_PORT=11107 MAILPIT_UI_PORT=18107 CORE_E2E_PORT=31107`. The equivalent root commands are the six `pnpm --dir apps/core …` commands in the normative specification.

| Package script, from its app directory | Result | Log |
| --- | --- | --- |
| `apps/core: pnpm lint` | Exit 0 | `/tmp/wa-api-validation-lint.log` |
| `apps/core: pnpm typecheck` | Exit 0 | `/tmp/wa-api-validation-typecheck.log` |
| `apps/core: pnpm test:unit` | Exit 0, `Todo OK` | `/tmp/wa-api-validation-test-unit.log` |
| `apps/core: pnpm test:integration` | Exit 0, `Todo OK` | `/tmp/wa-api-validation-integration.log` |
| `apps/core: pnpm test:e2e` | Exit 0, `Todo OK` | `/tmp/wa-api-validation-e2e.log` |
| `apps/core: pnpm build` | Exit 0 | `/tmp/wa-api-validation-build.log` |
| `apps/mobile: pnpm typecheck` | Exit 0 | `/tmp/wa-api-validation-mobile-typecheck.log` |

The package script suppresses successful Vitest details and prints `Todo OK`; exit status is the gate result. An independent run on the same `613d0a2` tree counted 366 passing unit tests and 138 passing integration tests; the buffered E2E script did not expose its total count. The new mobile-message E2E file defines five tests. These tests use no production database, WhatsApp account, QR session or phone.

## Enablement and rollback

1. Back up PostgreSQL. Apply the existing migration with `create-role.sql`, Prisma migration deploy, and `provision-role.sql`; keep persistent volumes and tenant policies. Check both an empty database and representative preexisting Cloud API contacts, chats, messages and images.
2. Deploy readers compatible with nullable contact phone and `metadata_only` images before admitting mobile message writes. Check Cloud API webhook ingestion, sale contact search, direct buyer selection and tenant isolation against the migrated schema. Release the server version that mounts the new POST route only after the full local gate and environment checks pass.
3. If a release fails before mobile writes, restore an older application only after confirming its readers support the migrated schema. Once a phone-free LID contact or `metadata_only` image has been accepted, an old reader is not a safe rollback target. Disable the route, repair or redeploy compatible readers, and preserve accepted rows. Do not delete records or revert the schema to start an old binary. Inspect long transactions and PostgreSQL state before retrying a failed concurrent-index migration.

## Future mobile consumer ACK

The future client should remove only its **HTTP registration pending item** after validating a `200` or `201` response against the shared success schema, including the returned message/event identity. It must retain that pending item after any `4xx`, `5xx`, timeout or malformed success body; a lost response can be retried with the same native identity. Keep each pending item tied to its original company and never resend it under a different company session. Preserve image references and local files after HTTP registration, because this API stores metadata without image bytes. Native `confirmMessageStored(deliveryId)` acknowledges local SQLite receipt separately; HTTP success does not replace that native ACK.

## Accepted limits

The account ID is declared by an authenticated user and ownership is not cryptographically verified. Image bytes are not stored here. The first valid write is immutable, so retries do not repair content. Dispatch may publish more than once with the same logical event ID. Recovery of a pending dispatch requires another POST; there is no autonomous relay. With no subscribers, the bus retains no job for later replay. Neither a successful HTTP response nor these tests guarantees handler execution or exactly-once processing.
