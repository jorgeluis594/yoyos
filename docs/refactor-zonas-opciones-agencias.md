# Refactor de zonas, opciones, couriers y agencias: diseño técnico

Análisis del 11 de octubre de 2026 sobre el código posterior al checkout por zonas (`d1cf155`). Implementado en las tareas T0 a T6 (ver [tareas](refactor-zonas-opciones-agencias-tareas.md)); este documento conserva el diseño normativo y las decisiones D1–D14, que quedaron como están en el código. Complementa el [diseño técnico de despachos y rótulos](preparacion-despachos-rotulos-tecnico.md), sección "Zonas, opciones, couriers y agencias". Define contratos, estructura de datos, persistencia y tipos; no acredita implementación. Las tareas para implementarlo están en [refactor-zonas-opciones-agencias-tareas.md](refactor-zonas-opciones-agencias-tareas.md).

Los bloques de código son contratos de diseño: fijan forma, nombres y restricciones, pero no son código ya incorporado. Siguen [programming-style.md](programming-style.md): Zod en los bordes JSON, tipos inferidos con `z.infer`, uniones discriminadas, marcas (`brand`) solo detrás de un parser y `Result` para operaciones que pueden fallar.

Etiquetas: **[Z]** zona → opción · **[C]** courier global · **[A]** agencias · **[L]** eliminación de variantes anteriores a las tarifas.

## 1. Decisiones

Todas están implementadas; las que eran *propuesta* se confirmaron al implementar.

| # | Tema | Decisión | Estado |
| --- | --- | --- | --- |
| D1 | Zona | Solo agrupa distritos: `name`, `enabled`, `districtCodes`. Sin modalidad ni precio. | Decidido |
| D2 | Opción | Pertenece a una zona; `method` (`home`/`agency`), `name`, `enabled`, `price`. La tarifa depende solo de la opción. | Decidido |
| D3 | Agencia | **Catálogo del sistema**, compartido entre empresas: `DeliveryAgency` pertenece a un `Courier` del catálogo; `name`, `address`, `districtCode`, `enabled`. Sin `companyId` ni RLS; solo lectura para la app. El distrito es ubicación, no cobertura. | Decidido |
| D4 | Courier global | Tabla `Courier` del sistema, solo lectura para la app. Las empresas solo eligen couriers del catálogo: `CompanyCourier` referencia `Courier`, no tiene nombre propio y es único por `(companyId, courierId)`. | Decidido |
| D5 | Edición de agencias | El equipo mantiene las agencias por **SQL directo**, fuera de la app; los couriers, por el seed JSON (D14). No hay ruta, caso de uso ni UI de escritura de agencias. La empresa solo asocia agencias del catálogo a sus opciones de agencia. | Decidido |
| D6 | `pricing` del snapshot | `{ quotationId, rateId, optionId, settingsVersion }`. Sin `zoneId`: se deriva de la opción si hace falta. | Decidido |
| D7 | Agencia pendiente | Se elimina `courier: null, agency: null`. `agencyId` es obligatorio al elegir agencia. | Decidido |
| D8 | Error de agencia | Una agencia o courier no disponible al resolver produce `RATE_UNAVAILABLE` (ya dispara recotización). Se elimina `COURIER_UNAVAILABLE`, que no se produce. | Decidido |
| D9 | `Order.checkoutDeliveryRequest` | Se elimina la columna en la migración del refactor. | Decidido |
| D10 | Refine de agencia | Se mantiene “agencia habilitada ⇒ algún courier habilitado”. No se exige agencia habilitada: una opción sin agencias elegibles simplemente no aplica. | Decidido |
| D11 | Nombres repetidos | Nombre de opción único por zona (sin distinguir mayúsculas, tras `trim`). La tarifa expone `zoneName` para desambiguar entre zonas. | Decidido |
| D12 | Inmutables | En opciones existentes no cambian `zoneId` ni `method`. Zonas, opciones y couriers de empresa se deshabilitan, no se borran. En el catálogo, agencias y couriers también se deshabilitan por SQL en lugar de borrarse (las FK `Restrict` lo impiden si están referenciados). | Decidido |
| D13 | Compatibilidad | Sin backfill ni lectura compatible: la app no está en producción. | Decidido |
| D14 | Catálogo de couriers | Solo Shalom y Olva Courier. Se definen en `apps/core/prisma/catalog/couriers.json` y se cargan con un seed idempotente que hace upsert por `code`, un código interno estable y único por courier (`shalom`, `olva`). Las agencias se cargan por SQL (D5). | Decidido |

### Memorias del repositorio afectadas

El 11 de octubre de 2026 se actualizó `10cbf628` con la nueva decisión, se crearon las decisiones “Delivery zones group districts and delivery options carry method, name and price” y “Rated agency delivery selection requires agencyId and stores courier and agency”, y se añadió el cambio planificado a las demás memorias de esta tabla. Al implementar, reescribirlas para que describan el estado nuevo como actual:

| Memoria | Qué cambia |
| --- | --- |
| `10cbf628` “Couriers are manually named and agency destinations entered per order” | Sustituida por D3, D4 y D5: catálogos globales de couriers y agencias mantenidos por SQL, no texto libre por pedido. |
| `47d3affe` “Rated order delivery snapshots preserve historical formats and pending agency assignment” | Sustituida por D6, D7 y D13: `pricing.optionId`, sin asignación pendiente (`courier: null, agency: null`) ni lectura de formatos históricos. Se mantiene que el snapshot se lee sin depender de la configuración vigente. |
| `5ddc2c38` “Delivery settings save atomically with version conflict detection” | El guardado ya no renombra couriers (D4); el resto se mantiene. Las agencias no se guardan desde la app (D5). |
| `a1aace29` “Quotation stores destination data only…” y `1b78eadb` “Quotation creation evaluates zones…” | `zoneId` → `optionId`; la evaluación pasa a opciones. Se mantienen sus reglas (ver invariantes de §2). |
| `f6c555e1` “Delivery zones may overlap districts within the same modality” | Las zonas superpuestas se mantienen; la tarifa es por opción y el índice pasa a `(companyId, districtCode)`. |

Siguen vigentes sin cambios `6206483d` (IDs generados por el servidor y conjunto retenido completo), `0fc62dc5` (la configuración no altera destinos de pedidos existentes) y `03a63c3f` (precios con `Money` y contratos tipados); este diseño aplica sus reglas a opciones y agencias.

## 2. Modelo de dominio

| Concepto | Nivel | Identidad | Campos |
| --- | --- | --- | --- |
| Distrito | Sistema | `PeruDistrictCode` | Catálogo de `shared/peru-geography.ts`. Sin cambios. |
| `Courier` | Sistema | `CourierCatalogId` | `name`, `enabled`. **Nuevo.** |
| `CompanyCourier` | Empresa | `CourierId` (se conserva el nombre del tipo) | `catalogId`, `enabled`; `name` se lee de `Courier`. |
| `DeliveryZone` | Empresa | `DeliveryZoneId` | `name`, `enabled`, `districtCodes` (no vacío), `options`. |
| `DeliveryOption` | Empresa | `DeliveryOptionId` | Unión por `method`: `home` o `agency` (con `agencyIds`). `name`, `enabled`, `price`. **Nuevo.** |
| `DeliveryAgency` | Sistema | `DeliveryAgencyId` | `courierId` (catálogo), `name`, `address`, `districtCode`, `enabled`. Mantenida por SQL. **Nuevo.** |
| `DeliveryOptionAgency` | Empresa | `(optionId, agencyId)` | Asociación de una opción de agencia de la empresa con agencias del catálogo. **Nuevo.** |
| `DeliveryRate` | Empresa | `DeliveryRateId` | Generada al cotizar, una por opción aplicable: `optionId`, `method`, `districtCode`, `price`, `settingsVersion`. |

`CourierId` sigue identificando al courier **de la empresa**: es el ID que hoy guarda el snapshot y que usa el filtro de despachos. El ID del catálogo (`CourierCatalogId`) es un tipo distinto para que el compilador impida mezclarlos. Una agencia pertenece a un courier del catálogo; el courier de empresa del snapshot se deriva buscando el `CompanyCourier` de la empresa con ese `courierId`.

### Invariantes

| Invariante | Dónde se garantiza |
| --- | --- |
| Toda fila por empresa pertenece a `app.company_id`. | RLS + `companyId` en PK/FK compuestas. |
| Opción, tarifa y asociación opción–agencia comparten `method`. | FK `(companyId, method, optionId)` → `DeliveryOption(companyId, method, id)`. |
| Solo opciones `agency` tienen agencias. | `DeliveryOptionAgency.method` con CHECK `= 'agency'` dentro de la FK; en tipos, `agencyIds` solo existe en la variante `agency`. |
| La empresa solo asocia agencias de couriers que tiene como `CompanyCourier` (habilitado o no). | `prepareDeliveryZones`. |
| La app no escribe `Courier` ni `DeliveryAgency`. | `REVOKE INSERT, UPDATE, DELETE` a `core_app`. |
| Opción de agencia aplicable ⇔ `settings.agency.enabled`, zona y opción habilitadas, y al menos una agencia asociada habilitada cuyo courier del catálogo esté habilitado y la empresa lo tenga como `CompanyCourier` habilitado. | `applicableDeliveryOptions` (dominio puro). |
| Opción `home` aplicable ⇔ `settings.home.enabled` y zona y opción habilitadas. | `applicableDeliveryOptions`. |
| El precio cobrado es el precio actual de la opción. | `validateSelectedDeliveryRate`, bajo bloqueo de configuración. |
| Ninguna entidad existente desaparece de una escritura. | `prepareDeliveryZones`, `prepareCouriers` (retención). Las asociaciones opción–agencia sí se reemplazan. |
| Cada escritura de configuración incrementa `version`. | Casos de uso, dentro de la transacción con `SELECT … FOR UPDATE`. |
| Los IDs nuevos (couriers de empresa, zonas, opciones) los genera el servidor después de comprobar `version` bajo bloqueo; un reintento con versión antigua da conflicto antes de generar nada. | Casos de uso; inputs `kind: "new"` sin ID. |
| Un distrito puede estar en varias zonas: se genera una tarifa por opción aplicable, sin colapsar por método ni precio. | `applicableDeliveryOptions`. |
| Un distrito sin cobertura produce una cotización vacía exitosa, nunca una tarifa implícita en cero. | `buildQuotationWithRates`. |
| `DeliveryRate` es un snapshot inmutable: no tiene FK a la pertenencia de distritos, y quitar cobertura no altera tarifas generadas. Cotizar no cambia `version` ni reserva precio. | Esquema y `createQuotation`. |
| Un cambio de `version` ajeno a la opción no invalida la tarifa; solo la invalidan la opción no aplicable, la agencia no elegible o un precio distinto. | `validateSelectedDeliveryRate`. |
| El bloqueo de configuración se mantiene hasta la escritura atómica del pedido. | Casos de uso de pedidos que llaman a `resolveSelectedDeliveryRate`. |
| El snapshot del pedido no depende de la configuración vigente: cambiar zonas, opciones o el catálogo de agencias no altera pedidos existentes. | Lectura del agregado sin joins a configuración. |

### Flujo

1. **Cotizar** un distrito: una tarifa por cada opción aplicable de las zonas habilitadas que lo cubren, ordenadas por método (`home` primero), precio y `id`. Las tarifas de agencia incluyen sus agencias elegibles; estas no se persisten.
2. **Elegir**: el comprador o vendedor envía `rateId` y, en agencia, `agencyId`. El courier se deriva de la agencia.
3. **Resolver** bajo el mismo bloqueo de configuración: la tarifa existe y coincide en empresa, método y distrito; la opción sigue aplicable; el precio no cambió; la agencia está asociada a la opción, habilitada y con courier habilitado.
4. **Snapshot**: guarda `pricing.optionId` y, para agencia, courier `{ id, name }` y agencia `{ id, name, address, location }`.

## 3. Persistencia

### 3.1 Esquema Prisma

`apps/core/prisma/schema.prisma`. `companyDefault` abrevia el default existente `dbgenerated("(NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid")`.

```prisma
model Courier {
  id        String @id @db.Uuid
  code      String @unique @db.VarChar(40) // código interno estable; clave de idempotencia del seed
  name      String @db.VarChar(120)
  enabled   Boolean
  companies CompanyCourier[]
  agencies  DeliveryAgency[]
}

model CompanyCourier {
  id        String @id @db.Uuid
  companyId String @default(companyDefault) @db.Uuid
  company   Company @relation(fields: [companyId], references: [id])
  settings  CompanyDeliverySettings @relation(fields: [companyId], references: [companyId], map: "CompanyCourier_settings_fkey")
  courierId String @db.Uuid
  courier   Courier @relation(fields: [courierId], references: [id], onDelete: Restrict, onUpdate: NoAction)
  enabled   Boolean
  // se elimina `name`

  @@unique([companyId, id])
  @@unique([companyId, courierId])
}

model DeliveryZone {
  id        String @id @db.Uuid
  companyId String @default(companyDefault) @db.Uuid
  company   Company @relation(fields: [companyId], references: [id])
  name      String @db.VarChar(120)
  enabled   Boolean
  districts DeliveryZoneDistrict[]
  options   DeliveryOption[]

  @@unique([companyId, id])
}

model DeliveryZoneDistrict {
  companyId    String @default(companyDefault) @db.Uuid
  company      Company @relation(fields: [companyId], references: [id])
  zoneId       String @db.Uuid
  zone         DeliveryZone @relation(fields: [companyId, zoneId], references: [companyId, id], onDelete: Restrict, onUpdate: NoAction)
  districtCode String @db.VarChar(6)

  @@id([companyId, zoneId, districtCode])
  @@index([companyId, districtCode])
}

model DeliveryOption {
  id            String @id @db.Uuid
  companyId     String @default(companyDefault) @db.Uuid
  company       Company @relation(fields: [companyId], references: [id])
  zoneId        String @db.Uuid
  zone          DeliveryZone @relation(fields: [companyId, zoneId], references: [companyId, id], onDelete: Restrict, onUpdate: NoAction)
  method        String
  name          String @db.VarChar(120)
  enabled       Boolean
  priceAmount   Decimal @db.Decimal(15, 2)
  priceCurrency String
  agencies      DeliveryOptionAgency[]
  rates         DeliveryRate[]

  @@unique([companyId, id])
  @@unique([companyId, method, id])
  @@index([companyId, zoneId])
}

model DeliveryAgency {
  id           String @id @db.Uuid
  courierId    String @db.Uuid
  courier      Courier @relation(fields: [courierId], references: [id], onDelete: Restrict, onUpdate: NoAction)
  name         String @db.VarChar(120)
  address      String @db.VarChar(500)
  districtCode String @db.VarChar(6)
  enabled      Boolean
  options      DeliveryOptionAgency[]

  @@index([courierId])
}

model DeliveryOptionAgency {
  companyId String @default(companyDefault) @db.Uuid
  company   Company @relation(fields: [companyId], references: [id])
  optionId  String @db.Uuid
  method    String @default("agency")
  option    DeliveryOption @relation(fields: [companyId, method, optionId], references: [companyId, method, id], onDelete: Restrict, onUpdate: NoAction)
  agencyId  String @db.Uuid
  agency    DeliveryAgency @relation(fields: [agencyId], references: [id], onDelete: Restrict, onUpdate: NoAction)

  @@id([companyId, optionId, agencyId])
  @@index([companyId, agencyId])
}

model DeliveryRate {
  id              String @id @db.Uuid
  companyId       String @default(companyDefault) @db.Uuid
  company         Company @relation(fields: [companyId], references: [id])
  quotationId     String @db.Uuid
  quotation       Quotation @relation(fields: [companyId, quotationId], references: [companyId, id], onDelete: Restrict, onUpdate: NoAction)
  method          String
  optionId        String @db.Uuid
  option          DeliveryOption @relation(fields: [companyId, method, optionId], references: [companyId, method, id], onDelete: Restrict, onUpdate: NoAction)
  districtCode    String @db.VarChar(6)
  priceAmount     Decimal @db.Decimal(15, 2)
  priceCurrency   String
  settingsVersion Int
  createdAt       DateTime @db.Timestamptz(6)

  @@unique([companyId, id])
  @@unique([companyId, quotationId, optionId])
}
```

Otros cambios:
- `Company`: relaciones `deliveryOptions`, `deliveryOptionAgencies`. `DeliveryAgency` no tiene `companyId`.
- `Order`: se elimina `checkoutDeliveryRequest` (D9).
- `Quotation` y `CompanyDeliverySettings`: sin cambios de columnas.
- No se agregan índices únicos de nombre en BD (D11 se valida en dominio): evita conflictos transitorios en upserts que renombran.

### 3.2 Migración

El contenido de la migración se describe aquí como una unidad, pero el [plan de tareas](refactor-zonas-opciones-agencias-tareas.md) lo reparte en una migración aditiva inicial y migraciones destructivas por tarea, para permitir trabajo en paralelo. Referencia: `split_delivery_zone_options_and_agencies`, generada con `pnpm exec prisma migrate dev --create-only --name split_delivery_zone_options_and_agencies` desde `apps/core` y completada a mano según `.agents/skills/database-migrations/SKILL.md`. Estructura:

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';

-- 1. Datos de desarrollo incompatibles (orden de FK). No toca Order.
DELETE FROM "DeliveryRate";
DELETE FROM "Quotation";
DELETE FROM "DeliveryZoneDistrict";
DELETE FROM "DeliveryZone";
DELETE FROM "CompanyCourier";                                  -- courierId NOT NULL
UPDATE "CompanyDeliverySettings" SET "agencyEnabled" = false;  -- el refine D10 exige courier habilitado

-- 2. DDL generado por Prisma (drop de FKs/índices con method, columnas, tablas nuevas, FKs compuestas).
--    Revisar que elimine:
--      DeliveryZoneDistrict_companyId_method_zoneId_fkey, DeliveryRate_companyId_method_zoneId_fkey,
--      DeliveryZone_companyId_method_id_key, DeliveryZoneDistrict_companyId_method_districtCode_idx,
--      DeliveryRate_companyId_quotationId_zoneId_key.

-- 3. CHECK eliminados explícitamente (desaparecen con sus columnas, pero se documenta la intención).
ALTER TABLE "DeliveryZone"
  DROP CONSTRAINT IF EXISTS "DeliveryZone_method_check",
  DROP CONSTRAINT IF EXISTS "DeliveryZone_price_check",
  DROP CONSTRAINT IF EXISTS "DeliveryZone_currency_check";

-- 4. CHECK nuevos.
ALTER TABLE "Courier"
  ADD CONSTRAINT "Courier_code_check" CHECK ("code" ~ '^[a-z0-9]+(_[a-z0-9]+)*$'),
  ADD CONSTRAINT "Courier_name_check" CHECK (length(btrim("name")) BETWEEN 1 AND 120);
ALTER TABLE "DeliveryOption"
  ADD CONSTRAINT "DeliveryOption_method_check" CHECK ("method" IN ('home', 'agency')),
  ADD CONSTRAINT "DeliveryOption_name_check" CHECK (length(btrim("name")) BETWEEN 1 AND 120),
  ADD CONSTRAINT "DeliveryOption_price_check" CHECK ("priceAmount" BETWEEN 0 AND 9999999999999.99),
  ADD CONSTRAINT "DeliveryOption_currency_check" CHECK ("priceCurrency" IN ('PEN', 'USD', 'COP', 'ARS', 'CLP', 'BRL'));
ALTER TABLE "DeliveryAgency"
  ADD CONSTRAINT "DeliveryAgency_name_check" CHECK (length(btrim("name")) BETWEEN 1 AND 120),
  ADD CONSTRAINT "DeliveryAgency_address_check" CHECK (length(btrim("address")) BETWEEN 1 AND 500),
  ADD CONSTRAINT "DeliveryAgency_code_check" CHECK ("districtCode" ~ '^[0-9]{6}$');
ALTER TABLE "DeliveryOptionAgency"
  ADD CONSTRAINT "DeliveryOptionAgency_method_check" CHECK ("method" = 'agency');

-- 5. RLS en tablas por empresa (mismo patrón que 20261007171258).
ALTER TABLE "DeliveryOption" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DeliveryOption" FORCE ROW LEVEL SECURITY;
CREATE POLICY delivery_option_company_isolation ON "DeliveryOption"
  USING ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);
-- Ídem: delivery_option_agency_company_isolation.

-- 6. Catálogos globales: sin RLS, solo lectura para la app.
REVOKE INSERT, UPDATE, DELETE ON "Courier" FROM core_app;
REVOKE INSERT, UPDATE, DELETE ON "DeliveryAgency" FROM core_app;
-- La migración no inserta datos de catálogo: couriers por seed JSON (§3.3), agencias por SQL (D5).

COMMIT;
```

Notas:
- **Permisos.** `scripts/provision-role.sql` se ejecuta después de cada despliegue de migraciones y hoy concede `SELECT, INSERT, UPDATE, DELETE` sobre **todas** las tablas de `public` (salvo `_prisma_migrations`), además de privilegios por defecto. Eso anularía el `REVOKE` de la migración. Hay que cambiarlo: excluir `Courier` y `DeliveryAgency` del `GRANT` general y concederles solo `SELECT`. El `REVOKE` de la migración se conserva para que el permiso sea correcto también entre la migración y la provisión.
- **Mantenimiento por SQL (D5).** Las agencias las escribe el equipo con un rol con permisos de escritura (no `core_app`), fuera de las migraciones. Reglas para esos scripts: UUID generados en el script, `districtCode` del catálogo de `shared/peru-geography.ts` (el CHECK solo valida formato), deshabilitar en lugar de borrar, y no reutilizar un ID para otra agencia. Conviene guardar los scripts aplicados en el repositorio (por ejemplo `apps/core/prisma/catalog/`) para reproducir el catálogo en otros entornos; los tests crean sus propias filas.
- Pedidos locales con snapshots anteriores (`courier: null`, agencia de texto o `pricing.zoneId`) fallan al leerse con `InvalidStoredDeliveryError`. La migración no los modifica: se documenta `pnpm exec prisma migrate reset` para bases locales. No se borran volúmenes.
- `order-migration.test.mjs` solo reproduce migraciones anteriores a `20261001004253`: no se ve afectado.

### 3.3 Seed del catálogo de couriers

`apps/core/prisma/catalog/couriers.json` es la fuente del catálogo (D14):

```json
[
  { "code": "shalom", "name": "Shalom", "enabled": true },
  { "code": "olva", "name": "Olva Courier", "enabled": true }
]
```

`apps/core/scripts/seed-courier-catalog.ts`:

```ts
const courierCatalogFileSchema = z.array(z.strictObject({
  code: z.string().regex(/^[a-z0-9]+(_[a-z0-9]+)*$/).max(40),
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean(),
})).refine(values => new Set(values.map(value => value.code)).size === values.length);

// Por cada entrada, en una transacción:
// INSERT INTO "Courier" ("id", "code", "name", "enabled") VALUES (gen_random_uuid(), $code, $name, $enabled)
// ON CONFLICT ("code") DO UPDATE SET "name" = EXCLUDED."name", "enabled" = EXCLUDED."enabled";
```

- **Idempotencia por `code`.** El `id` se genera solo al insertar y no cambia en ejecuciones posteriores; `code` es inmutable y nunca se reutiliza. Repetir el seed no crea filas ni cambia IDs.
- **Sin borrados.** Un courier ausente del JSON no se borra (puede estar referenciado por `CompanyCourier`). Para retirarlo, se deja en el JSON con `enabled: false`.
- **Rol y momento.** Se ejecuta con el rol de migración (`core`), no con `core_app`, como parte del servicio `migrate` de `compose.yaml`: `migrate.ts` → `seed-courier-catalog.ts` → `provision-role.sql`. `run-tests.sh` lo ejecuta en el mismo punto. A diferencia de `scripts/seed.ts` (datos demo, deshabilitado en producción), este seed corre en todos los entornos.
- **Fallo.** JSON inválido o error de base de datos terminan el proceso con código distinto de cero y registran `courier_catalog_seed_failed`; el despliegue no continúa.
- **Tests.** Las pruebas usan los couriers del seed buscándolos por `code`, nunca por un UUID fijo.

### 3.4 Repositorios

| Función | Lectura / escritura | Detalle |
| --- | --- | --- |
| `readDeliveryConfiguration(companyId, lock)` | Lee settings, couriers (con `courier` del catálogo), zonas (distritos y opciones con `agencies`) y las agencias del catálogo **asociadas** a alguna opción de la empresa. | `lock: "share" \| "update"` sobre `CompanyDeliverySettings`, como hoy. Cada fila pasa por su parser de dominio; un fallo devuelve `INVALID_STORED_DATA` y registra `delivery_configuration_stored_data_invalid` con el ID de la fila. |
| `writeDeliveryZones(companyId, zones)` | Zonas, distritos, opciones y opción–agencia. | Por zona: `updateMany`/`create`; `deleteMany` + `createMany` de distritos. Por opción: `updateMany` por `(companyId, id)` sin tocar `zoneId`/`method`, o `create`; `deleteMany` + `createMany` de asociaciones. |
| `readAgencies(ids)` | Agencias del catálogo por ID. | Para validar `agencyIds` nuevos al guardar zonas, dentro de la misma transacción. |
| `readAgencyCatalog(courierId)` | Agencias habilitadas de un courier del catálogo, ordenadas por departamento, distrito y nombre. | Sin contexto de empresa. |
| `writeCouriers(companyId, couriers)` | `CompanyCourier`. | `updateMany` de `enabled`; `create` con `courierId`. Un `P2002` en `(companyId, courierId)` → `DELIVERY_SETTINGS_CONFLICT` con `reason: "concurrent_creation"`. |
| `readCourierCatalog()` | `Courier` habilitados (`id`, `code`, `name`), ordenados por nombre. | Sin contexto de empresa. |
| `insertQuotationWithRates(value)` | `Quotation` + `DeliveryRate` con `optionId`. | Solo persiste las tarifas; las agencias elegibles no se guardan. |
| `readRateWithQuotation(companyId, rateId)` | Igual que hoy con `optionId`. | |

No se leen todas las agencias del catálogo al cotizar: solo las asociadas a opciones, que son las únicas que pueden aplicar.

Mapeo a dominio: `Decimal` → `Money` con `parseDeliveryPrice`; `districtCode` con `parsePeruDistrictCode`; los IDs se marcan solo dentro de los parsers. No hay `as` sobre filas sin validar.

## 4. Contratos HTTP

### 4.1 Rutas

| Método y ruta | Request | Response | Cambio |
| --- | --- | --- | --- |
| `GET /api/delivery-settings` | — | `deliverySettingsSchema` | Couriers con `courierId` y `name` del catálogo. |
| `PUT /api/delivery-settings` | `saveDeliverySettingsSchema` | `deliverySettingsSchema` | Couriers por `courierId`; sin `name`. |
| `GET /api/delivery-settings/courier-catalog` | — | `courierCatalogSchema` | **Nueva.** |
| `GET /api/delivery-settings/agency-catalog?courierId=<uuid>` | — | `agencyCatalogSchema` | **Nueva.** Agencias habilitadas de un courier del catálogo que la empresa tiene como `CompanyCourier`. |
| `GET /api/delivery-settings/zones` | — | `deliveryZonesSchema` | Zonas con opciones y detalle de las agencias asociadas. |
| `PUT /api/delivery-settings/zones` | `saveDeliveryZonesSchema` | `deliveryZonesSchema` | Sin `method` global; todas las zonas en una escritura. |
| `POST` de cotización (sin cambio de ruta) | `createQuotationRequestSchema` | `quotationResponseSchema` | Tarifa con `optionId`, `name`, `zoneName` y, en agencia, `agencies`. |
| Rutas de pedido y checkout que reciben `ratedDeliverySelectionSchema` | Selección agency con `agencyId`. | Snapshot nuevo. | |

Todas las escrituras de configuración comparten `expectedVersion` y responden `409 DELIVERY_SETTINGS_CONFLICT` con `currentVersion` si cambió.

### 4.2 `shared/contracts/peru-location.ts` (nuevo)

Mueve aquí el schema hoy privado de `orders.ts` para que cotizaciones y pedidos lo compartan sin importarse entre sí.

```ts
export const peruDistrictCodeSchema = z.string().regex(/^\d{6}$/);
export const peruDeliveryDistrictSchema = z.strictObject({
  country: z.literal("PE"), districtCode: peruDistrictCodeSchema,
  district: z.string().trim().min(1).max(120), province: z.string().trim().min(1).max(120), department: z.string().trim().min(1).max(120),
});
export type PeruDeliveryDistrictContract = z.infer<typeof peruDeliveryDistrictSchema>;
```

### 4.3 `shared/contracts/delivery-settings.ts`

Couriers [C]:

```ts
export const courierCatalogSchema = z.strictObject({
  couriers: z.array(z.strictObject({ id: z.uuid(), code: z.string().min(1).max(40), name: z.string().trim().min(1).max(120) })),
});
const companyCourierSchema = z.strictObject({
  id: z.uuid(), courierId: z.uuid(), name: z.string().trim().min(1).max(120), enabled: z.boolean(),
});
export const courierInputSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("new"), courierId: z.uuid(), enabled: z.boolean() }),
  z.strictObject({ kind: z.literal("existing"), id: z.uuid(), enabled: z.boolean() }),
]);
// deliverySettingsSchema.couriers: z.array(companyCourierSchema); refine añade unicidad de courierId.
```

Catálogo de agencias [A] (solo lectura):

```ts
export const catalogAgencySchema = z.strictObject({
  id: z.uuid(), courierId: z.uuid(), name: z.string().trim().min(1).max(120),
  address: z.string().trim().min(1).max(500), location: peruDeliveryDistrictSchema, enabled: z.boolean(),
});
export const agencyCatalogRequestSchema = z.strictObject({ courierId: z.uuid() });
export const agencyCatalogSchema = z.strictObject({ agencies: z.array(catalogAgencySchema) });
export type CatalogAgencyContract = z.infer<typeof catalogAgencySchema>;
```

`courierId` es el `CourierCatalogId`. La ruta responde `404` si la empresa no tiene ese courier como `CompanyCourier`.

Zonas y opciones [Z]. La opción es una unión por `method`: `agencyIds` no puede aparecer en `home`.

```ts
const optionMethodSchema = z.enum(["home", "agency"]);
const optionFields = { name: z.string().trim().min(1).max(120), enabled: z.boolean(), price: moneySchema };
export const deliveryOptionSchema = z.discriminatedUnion("method", [
  z.strictObject({ id: z.uuid(), method: z.literal("home"), ...optionFields }),
  z.strictObject({ id: z.uuid(), method: z.literal("agency"), ...optionFields, agencyIds: z.array(z.uuid()) }),
]);
export const deliveryZoneSchema = z.strictObject({
  id: z.uuid(), name: z.string().min(1).max(120), enabled: z.boolean(),
  districtCodes: z.array(peruDistrictCodeSchema).min(1), options: z.array(deliveryOptionSchema),
});
export const deliveryZonesSchema = z.strictObject({
  home: z.strictObject({ enabled: z.boolean() }), agency: z.strictObject({ enabled: z.boolean() }),
  version: z.number().int().min(0).max(2147483647), currency: z.enum(currencies), zones: z.array(deliveryZoneSchema),
  agencies: z.array(catalogAgencySchema), // agencias referenciadas por agencyIds, incluidas las deshabilitadas
});

const optionInputFields = { name: z.string(), enabled: z.boolean(), price: moneySchema };
const homeOptionInput = { method: z.literal("home"), ...optionInputFields };
const agencyOptionInput = { method: z.literal("agency"), ...optionInputFields, agencyIds: z.array(z.uuid()) };
export const deliveryOptionInputSchema = z.union([
  z.strictObject({ kind: z.literal("new"), ...homeOptionInput }),
  z.strictObject({ kind: z.literal("new"), ...agencyOptionInput }),
  z.strictObject({ kind: z.literal("existing"), id: z.uuid(), ...homeOptionInput }),
  z.strictObject({ kind: z.literal("existing"), id: z.uuid(), ...agencyOptionInput }),
]);
const zoneInputFields = { name: z.string(), enabled: z.boolean(), districtCodes: z.array(peruDistrictCodeSchema), options: z.array(deliveryOptionInputSchema) };
export const deliveryZoneInputSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("new"), ...zoneInputFields }),
  z.strictObject({ kind: z.literal("existing"), id: z.uuid(), ...zoneInputFields }),
]);
export const saveDeliveryZonesSchema = z.strictObject({
  expectedVersion: z.number().int().min(0).max(2147483646), zones: z.array(deliveryZoneInputSchema),
});
```

`deliveryZonesApiErrorSchema`: se agrega el código `INVALID_DELIVERY_OPTION`; `field` pasa a `["id", "name", "enabled", "districtCodes", "zones", "options", "method", "price", "agencyIds"]`; `index` es el índice de zona y `optionIndex` (nuevo, opcional) el de la opción. Se quita `method` del nivel de zona.

### 4.4 `shared/contracts/quotations.ts`

```ts
const quotedAgencySchema = z.strictObject({
  id: z.uuid(), name: z.string().trim().min(1).max(120), address: z.string().trim().min(1).max(500),
  location: peruDeliveryDistrictSchema, courier: z.strictObject({ id: z.uuid(), name: z.string().trim().min(1).max(120) }),
});
const rateFields = {
  id: z.uuid(), optionId: z.uuid(), name: z.string().trim().min(1).max(120), zoneName: z.string().trim().min(1).max(120),
  price: moneySchema.extend({ amount: z.number().finite().min(0).max(9999999999999.99).multipleOf(0.01) }),
};
export const deliveryRateSchema = z.discriminatedUnion("method", [
  z.strictObject({ ...rateFields, method: z.literal("home") }),
  z.strictObject({ ...rateFields, method: z.literal("agency"), agencies: z.array(quotedAgencySchema).min(1) }),
]);
```

Se elimina `label` literal: la UI muestra `name` (y `zoneName` si hay nombres repetidos). `quotationResponseSchema` no cambia salvo por la tarifa.

### 4.5 `shared/contracts/orders.ts`

```ts
export const ratedDeliverySelectionSchema = z.discriminatedUnion("method", [
  z.strictObject({ method: z.literal("home"), recipient: recipientSchema, rateId: z.uuid(), destination: z.strictObject({
    districtCode: peruDistrictCodeSchema, address: z.string().trim().min(1).max(500), instructions: z.string().trim().max(1000).nullable(),
  }) }),
  z.strictObject({ method: z.literal("agency"), recipient: agencyRecipientSchema, rateId: z.uuid(),
    districtCode: peruDistrictCodeSchema, agencyId: z.uuid() }),
  z.strictObject({ method: z.literal("store"), recipient: recipientSchema }),
]);

const deliveryPricingSchema = z.strictObject({ quotationId: z.uuid(), rateId: z.uuid(), optionId: z.uuid(), settingsVersion: settingsVersionSchema });
const snapshotCourierSchema = z.strictObject({ id: z.uuid(), name: z.string().trim().min(1).max(120) });
const snapshotAgencySchema = z.strictObject({ id: z.uuid(), name: z.string().trim().min(1).max(120),
  address: z.string().trim().min(1).max(500), location: peruDeliveryDistrictSchema });

export const homeDeliverySnapshotSchema = z.strictObject({ method: z.literal("home"), recipient: recipientSchema,
  destination: homeDestinationSchema.extend(peruDeliveryDistrictSchema.shape), pricing: deliveryPricingSchema, recordedBy: deliveryAuthorSchema });
export const agencyDeliverySnapshotSchema = z.strictObject({ method: z.literal("agency"), recipient: agencyRecipientSchema,
  destination: peruDeliveryDistrictSchema, pricing: deliveryPricingSchema, courier: snapshotCourierSchema, agency: snapshotAgencySchema,
  recordedBy: deliveryAuthorSchema });
export const storeDeliverySnapshotSchema = z.strictObject({ method: z.literal("store"), recipient: recipientSchema,
  pickupPoint: pickupPointSchema, settingsVersion: settingsVersionSchema, recordedBy: deliveryAuthorSchema });
export const deliverySnapshotSchema = z.discriminatedUnion("method",
  [homeDeliverySnapshotSchema, agencyDeliverySnapshotSchema, storeDeliverySnapshotSchema]);
```

- `deliverySnapshotSchemas` (arreglo indexado) se elimina; cada variante se exporta con nombre. Como hay una sola variante por método, el snapshot pasa de `z.union` a `z.discriminatedUnion`.
- `destination` es el distrito del comprador (el de la tarifa); `agency.location`, el de la agencia. El rótulo usa `agency.location`.
- Se eliminan `deliverySelectionSchema`, `DeliverySelectionRequest`, `legacySetOrderDeliverySchema`, `legacyCompleteOrderSchema`, `LegacyCompleteOrderRequest`, `legacyDeliverySnapshotSchema` y los alias `setOrderDeliverySchema`/`SetOrderDeliveryRequest`. `completeOrderSchema` se redefine desde `orderSelectionSchema` con `delivery: setRatedOrderDeliverySchema.optional()`.
- `orderAggregateSchema` pierde `checkoutDeliveryRequest`.
- `orderApiErrorSchema.code` pierde `COURIER_UNAVAILABLE` (D8).
- `createOrderSchema` con `handover` (venta POS inmediata) **se conserva**.

### 4.6 `shared/contracts/order-checkout.ts`

```ts
export const publicCheckoutDeliverySchema = z.discriminatedUnion("method", [
  homeDeliverySnapshotSchema.omit({ recordedBy: true }),
  agencyDeliverySnapshotSchema.omit({ recordedBy: true }),
  storeDeliverySnapshotSchema.omit({ recordedBy: true }),
]);
```

Reemplaza el acceso por índice `deliverySnapshotSchemas[0..6]`, que se rompería en silencio al cambiar el arreglo.

## 5. Tipos de dominio y aplicación (Core)

### 5.1 Identidades

```ts
// delivery-settings/domain
export type CourierCatalogId = string & { readonly __brand: "CourierCatalogId" };
export type CourierId = string & { readonly __brand: "CourierId" };            // CompanyCourier.id, existente
export type DeliveryZoneId = string & { readonly __brand: "DeliveryZoneId" };  // existente
export type DeliveryOptionId = string & { readonly __brand: "DeliveryOptionId" };
export type DeliveryAgencyId = string & { readonly __brand: "DeliveryAgencyId" }; // agencia del catálogo
export type DeliveryMethodWithRate = "home" | "agency";                        // reemplaza ZonedDeliveryMethod
type NonEmpty<T> = readonly [T, ...T[]];
```

`domain/type-contracts.ts` (orders) añade asserts de que `DeliveryOptionId`, `DeliveryAgencyId` y `CourierCatalogId` no son asignables entre sí ni desde `string`.

### 5.2 Entidades

```ts
// domain/delivery-settings.ts
export type Courier = Readonly<{ id: CourierId; catalogId: CourierCatalogId; name: string; enabled: boolean; catalogEnabled: boolean }>;
export type CourierInput =
  | Readonly<{ kind: "new"; catalogId: CourierCatalogId; enabled: boolean }>
  | Readonly<{ kind: "existing"; id: CourierId; enabled: boolean }>;
export type CourierCode = string & { readonly __brand: "CourierCode" };
export type CourierCatalogEntry = Readonly<{ id: CourierCatalogId; code: CourierCode; name: string }>;

// domain/delivery-zone.ts
type DeliveryOptionBase = Readonly<{ id: DeliveryOptionId; zoneId: DeliveryZoneId; name: string; enabled: boolean; price: Money }>;
export type HomeDeliveryOption = DeliveryOptionBase & Readonly<{ method: "home" }>;
export type AgencyDeliveryOption = DeliveryOptionBase & Readonly<{ method: "agency"; agencyIds: readonly DeliveryAgencyId[] }>;
export type DeliveryOption = HomeDeliveryOption | AgencyDeliveryOption;
export type DeliveryZone = Readonly<{
  id: DeliveryZoneId; name: string; enabled: boolean;
  districtCodes: NonEmpty<PeruDistrictCode>; options: readonly DeliveryOption[];
}>;

type OptionInputFields = Readonly<{ name: string; enabled: boolean; price: Money }>;
export type DeliveryOptionInput = (
  | Readonly<{ kind: "new" }>
  | Readonly<{ kind: "existing"; id: string }>
) & OptionInputFields & (
  | Readonly<{ method: "home" }>
  | Readonly<{ method: "agency"; agencyIds: readonly string[] }>
);
export type DeliveryZoneInput = (
  | Readonly<{ kind: "new" }>
  | Readonly<{ kind: "existing"; id: string }>
) & Readonly<{ name: string; enabled: boolean; districtCodes: readonly string[]; options: readonly DeliveryOptionInput[] }>;

// domain/delivery-agency.ts (nuevo): catálogo del sistema, sin input de escritura
export type DeliveryAgency = Readonly<{
  id: DeliveryAgencyId; courierId: CourierCatalogId; name: string; address: string; districtCode: PeruDistrictCode;
  enabled: boolean; courierEnabled: boolean;
}>;
```

Los inputs reciben `string` porque vienen del borde HTTP ya con forma validada; los parsers de dominio comprueban catálogo, unicidad y referencias, y producen las marcas.

### 5.3 Funciones de dominio

```ts
export function parseDeliveryZone(value: unknown, currency: Currency): Result<DeliveryZone, DeliveryZoneError>;
export function parseDeliveryAgency(value: unknown): Result<DeliveryAgency, DeliverySettingsReadError>;

export function prepareDeliveryZones(input: readonly DeliveryZoneInput[], context: Readonly<{
  current: readonly DeliveryZone[]; agencies: readonly DeliveryAgency[]; couriers: readonly Courier[]; currency: Currency;
  generateZoneId: () => string; generateOptionId: () => string;
}>): Result<readonly DeliveryZone[], DeliveryZoneError>;

export function prepareCouriers(input: Readonly<{ agencyEnabled: boolean; couriers: readonly CourierInput[] }>, context: Readonly<{
  current: readonly Courier[]; catalog: readonly CourierCatalogEntry[]; generateId: () => CourierId;
}>): Result<readonly Courier[], DeliverySettingsError>;
```

`prepareDeliveryZones` valida, en este orden y con `index`/`optionIndex` en el error: forma; retención de zonas y opciones existentes; IDs únicos en toda la configuración; inmutabilidad de `zoneId` y `method` en opciones existentes; nombre de opción único por zona; precio en la divisa de la empresa; `agencyIds` sin duplicados, existentes en el catálogo (`context.agencies`) y de un courier que la empresa tiene como `CompanyCourier`. Se aceptan agencias deshabilitadas para que una agencia desactivada por SQL no impida volver a guardar; simplemente no aplican.

`parseDeliveryAgency` valida las filas del catálogo (incluido `districtCode` contra `parsePeruDistrictCode`); una fila inválida es `INVALID_STORED_DATA`. `prepareCouriers` valida `catalogId` existente y habilitado en el catálogo para couriers nuevos, y unicidad de `catalogId`.

```ts
export type DeliveryZoneError = Readonly<{
  code: "INVALID_DELIVERY_ZONE" | "INVALID_DELIVERY_OPTION"; message: string;
  field?: "id" | "name" | "enabled" | "districtCodes" | "zones" | "options" | "method" | "price" | "agencyIds";
  index?: number; optionIndex?: number;
}>;
```

### 5.4 Cotización

```ts
export type EligibleAgency = Readonly<{ agency: DeliveryAgency; courier: Courier }>; // courier: CompanyCourier con courier.catalogId === agency.courierId
export type ApplicableDeliveryOption =
  | Readonly<{ zone: DeliveryZone; option: HomeDeliveryOption }>
  | Readonly<{ zone: DeliveryZone; option: AgencyDeliveryOption; agencies: NonEmpty<EligibleAgency> }>;

export function applicableDeliveryOptions(configuration: DeliveryConfiguration, districtCode: PeruDistrictCode): readonly ApplicableDeliveryOption[];

export type DeliveryRate = Readonly<{
  id: DeliveryRateId; companyId: CompanyId; quotationId: QuotationId; price: Money;
  settingsVersion: DeliverySettingsVersion; createdAt: Date;
  method: DeliveryMethodWithRate; optionId: DeliveryOptionId; districtCode: PeruDistrictCode;
}>;
export type QuotedDeliveryRate =
  | Readonly<{ rate: DeliveryRate & Readonly<{ method: "home" }>; name: string; zoneName: string }>
  | Readonly<{ rate: DeliveryRate & Readonly<{ method: "agency" }>; name: string; zoneName: string; agencies: NonEmpty<EligibleAgency> }>;
export type QuotationWithRates = Readonly<{ quotation: Quotation; rates: readonly QuotedDeliveryRate[] }>;
```

`DeliveryRate` es lo que se persiste; `QuotedDeliveryRate` es la respuesta de la operación. El presentador construye la respuesta HTTP desde `QuotedDeliveryRate`, convirtiendo `agency.districtCode` en `location` con el catálogo, y la valida con `quotationResponseSchema` antes de enviarla.

### 5.5 Resolución de la tarifa elegida

```ts
export type ResolveSelectedRateInput =
  | Readonly<{ companyId: CompanyId; rateId: DeliveryRateId; method: "home"; districtCode: PeruDistrictCode }>
  | Readonly<{ companyId: CompanyId; rateId: DeliveryRateId; method: "agency"; districtCode: PeruDistrictCode; agencyId: DeliveryAgencyId }>;

type ResolvedRateBase = Readonly<{
  quotationId: QuotationId; rateId: DeliveryRateId; optionId: DeliveryOptionId; price: Money; settingsVersion: DeliverySettingsVersion;
}>;
export type ResolvedDeliveryRate =
  | ResolvedRateBase & Readonly<{ method: "home" }>
  | ResolvedRateBase & Readonly<{
      method: "agency";
      courier: Readonly<{ id: CourierId; name: string }>;
      agency: Readonly<{ id: DeliveryAgencyId; name: string; address: string; districtCode: PeruDistrictCode }>;
    }>;
export type SelectedRateError =
  | Readonly<{ code: "RATE_UNAVAILABLE"; message: string }>
  | Readonly<{ code: "TOTAL_CHANGED"; message: string; currentPrice: Money }>;

export function validateSelectedDeliveryRate(input: ResolveSelectedRateInput, value: RateWithQuotation | null,
  configuration: DeliveryConfiguration): Result<ResolvedDeliveryRate, SelectedRateError>;
```

La opción se busca entre `applicableDeliveryOptions(configuration, input.districtCode)` por `rate.optionId`. En agencia, `input.agencyId` debe estar entre sus `agencies` elegibles; si no, `RATE_UNAVAILABLE` (D8).

### 5.6 Aplicación

```ts
export type DeliveryConfiguration = Readonly<{
  country: string; currency: Currency; settings: DeliverySettings;
  zones: readonly DeliveryZone[]; agencies: readonly DeliveryAgency[]; // agencias asociadas a opciones
}>;

export type SaveDeliveryZonesInput = Readonly<{ expectedVersion: number; zones: readonly DeliveryZoneInput[] }>;
export type SaveDeliveryZonesDependencies = Readonly<{
  transaction: <T>(companyId: string, work: () => Promise<Result<T, DeliveryZonesError>>) => Promise<Result<T, DeliveryZonesError>>;
  readForUpdate: ReadDeliveryConfiguration;
  saveSettings: (companyId: string, settings: DeliverySettings) => Promise<Result<null, DeliverySettingsError>>;
  readAgencies: (ids: readonly string[]) => Promise<Result<readonly DeliveryAgency[], QuotationStorageError>>;
  saveZones: (companyId: string, zones: readonly DeliveryZone[]) => Promise<Result<null, QuotationStorageError>>;
  generateZoneId: () => string;
  generateOptionId: () => string;
}>;
```

`saveDeliveryZones` y `saveDeliverySettings` siguen el mismo esquema: transacción, `readForUpdate`, comparación de `version`, preparación pura, incremento de `version`, escritura. `saveDeliveryZones` lee con `readAgencies` las agencias de todos los `agencyIds` del input antes de preparar. El catálogo cambia por SQL sin incrementar `version` de ninguna empresa: cotizar y resolver leen siempre su estado actual.

`getAgencyCatalog(courierId, context)` comprueba que la empresa tenga ese courier y devuelve `readAgencyCatalog(courierId)`.

`createQuotation` usa `readConfigurationForShare` (ahora con agencias) y genera un `rateId` por elemento de `applicableDeliveryOptions`. `resolveSelectedDeliveryRate` lee la configuración con bloqueo compartido y pasa `agencyId` desde la selección.

### 5.7 Pedidos

```ts
export type RatedDeliverySelection =
  | Readonly<{ method: "home"; recipient: Recipient; rateId: DeliveryRateId;
      destination: Readonly<{ districtCode: PeruDistrictCode; address: string; instructions: string | null }> }>
  | Readonly<{ method: "agency"; recipient: AgencyRecipient; rateId: DeliveryRateId; districtCode: PeruDistrictCode; agencyId: DeliveryAgencyId }>
  | Readonly<{ method: "store"; recipient: Recipient }>;

export type DeliveryPricing = Readonly<{
  quotationId: QuotationId; rateId: DeliveryRateId; optionId: DeliveryOptionId; settingsVersion: DeliverySettingsVersion;
}>;
export type SnapshotAgency = Readonly<{ id: DeliveryAgencyId; name: string; address: string; location: PeruDeliveryDistrict }>;
export type DeliverySnapshot = Readonly<{ recordedBy: DeliveryAuthor }> & (
  | Readonly<{ method: "home"; recipient: Recipient; destination: HomeDestination & PeruDeliveryDistrict; pricing: DeliveryPricing }>
  | Readonly<{ method: "agency"; recipient: AgencyRecipient; destination: PeruDeliveryDistrict; pricing: DeliveryPricing;
      courier: Readonly<{ id: CourierId; name: string }>; agency: SnapshotAgency }>
  | Readonly<{ method: "store"; recipient: Recipient; pickupPoint: PickupPoint; settingsVersion: DeliverySettingsVersion }>
);
```

- Se eliminan `DeliverySelection`, `parseDeliverySelection`, `legacyDelivery`, la variante `courier: null` y `checkoutDeliveryRequest` de `OrderAggregate`.
- `buildRatedDeliverySnapshot(selection, rate, author)` exige `rate.method === selection.method`, `rate.rateId === selection.rateId` y, en agencia, `rate.agency.id === selection.agencyId`. Construye `destination` y `agency.location` con el mismo helper de catálogo (`peruDeliveryDistrict(code)`), y copia `courier` desde `rate`.
- `settingsVersion` de `store` pasa a obligatorio: ya no hay snapshots sin él.
- El snapshot leído de la base se valida con su parser; un JSON inválido es `InvalidStoredDeliveryError`, nunca un pedido sin entrega.

### 5.8 Mobile

Los tipos de transporte se infieren de los schemas de `shared` (`z.infer`); los borradores locales derivan de ellos con `Extract`, como `CourierDraft` hoy. Nuevos: `DeliveryOptionDraft` (unión por `method`, con `localKey` en `new`) y `ZoneDraft.options`. Las agencias son de solo lectura (`CatalogAgencyContract`). La selección agency del borrador de pedido añade `agencyId`. El store de confirmación pendiente solo acepta `version: 2` con el schema nuevo.

## 6. Errores y mapeo HTTP

| Error de dominio/aplicación | HTTP | Código de contrato |
| --- | --- | --- |
| `INVALID_DELIVERY_ZONE`, `INVALID_DELIVERY_OPTION` | 422 | Igual, con `field`, `index`, `optionIndex`. |
| Courier no asociado a la empresa en `agency-catalog` | 404 | `NOT_FOUND`. |
| `INVALID_DELIVERY_SETTINGS` (catálogo inexistente o deshabilitado, refine D10) | 422 | Igual. |
| `DELIVERY_SETTINGS_CONFLICT` | 409 | Igual, con `currentVersion` y `reason`. |
| `INVALID_STORED_DATA` | 500 | `INTERNAL_ERROR` (detalle solo en logs). |
| `RATE_UNAVAILABLE` (incluye agencia/courier no disponible) | 409 | `RATE_UNAVAILABLE`; web y móvil recotizan. |
| `TOTAL_CHANGED` | 409 | `TOTAL_CHANGED` con `currentPrice`. |

Logs: `delivery_rate_resolution_failed` incluye `optionId` y, si aplica, `agencyId`; `observed.courierId` del pedido se rellena desde `snapshot.courier.id`. Se quita `chargeDeliveryToCustomer: true` del log de `orders/composition.ts`.

## 7. Inventario por capa

### 7.1 Core server: `features/delivery-settings`

| Capa | Archivo | Cambio | Tag |
| --- | --- | --- | --- |
| domain | `delivery-zone.ts` | Tipos de §5.2; `parseDeliveryZone` con opciones; `prepareDeliveryZones` de §5.3. | Z/A |
| domain | `delivery-agency.ts` (nuevo) | `DeliveryAgency`, `parseDeliveryAgency` (solo lectura). | A |
| domain | `delivery-settings.ts` | `Courier` con `catalogId`; `CourierInput` sin `name`; `prepareCouriers` contra el catálogo. | C |
| domain | `quotation.ts` | `DeliveryRate.optionId`; `applicableDeliveryOptions`; `QuotedDeliveryRate`; `buildQuotationWithRates` desde `DeliveryConfiguration`. | Z/A |
| domain | `selected-delivery-rate.ts` | Tipos y validación de §5.5. | Z/A |
| application | `create-quotation.ts` | `DeliveryConfiguration` con agencias. | Z/A |
| application | `delivery-zones.ts` | `SaveDeliveryZonesInput` sin `method`; `generateOptionId`; `readAgencies`. | Z/A |
| application | `agency-catalog.ts` (nuevo) | `getAgencyCatalog`. | A |
| application | `delivery-settings.ts` | Couriers con catálogo; `getCourierCatalog`. | C |
| application | `resolve-selected-delivery-rate.ts` | Input con `agencyId`; configuración completa. | A |
| infrastructure | `delivery-zones-repository.ts` | `readDeliveryConfiguration`, `writeDeliveryZones` de §3.4. | Z/A |
| infrastructure | `agency-catalog-repository.ts` (nuevo) | `readAgencies`, `readAgencyCatalog`. | A |
| infrastructure | `delivery-settings-repository.ts` | `writeCouriers`, `readCourierCatalog`. | C |
| infrastructure | `quotation-repository.ts`, `quotation-api.ts` | `optionId`; respuesta nueva. | Z/A |
| presentation | `api-routes.ts`, `quotation-routes.ts` | Rutas de §4.1; errores de §6; respuesta de tarifa desde `QuotedDeliveryRate`. | Z/C/A |
| composition | `composition.ts`, `index.ts` | Generadores de IDs; exportar `DeliveryOptionId`, `DeliveryAgencyId`, `ResolvedDeliveryRate`. | Z/A |

### 7.2 Core server: `features/orders`

| Archivo | Cambio | Tag |
| --- | --- | --- |
| `domain/order-state-machine.ts` | Tipos de §5.7; quitar guarda `chargeDeliveryToCustomer` (l. 242). | Z/A/L |
| `domain/type-contracts.ts` | Reemplazar assert sobre `DeliverySelection` (l. 28); asserts de §5.1. | L/A |
| `domain/checkout.ts` | `CheckoutDelivery` y `publicDelivery` contra `publicCheckoutDeliverySchema`. | L |
| `application/resolve-delivery-selection.ts` | Pasar `agencyId`. | A |
| `application/set-delivery.ts`, `create-complete-order.ts` | Quitar guardas `chargeDeliveryToCustomer` (l. 25 y 26); unificar `SetDeliveryInput`. | L |
| `infrastructure/order-repository.ts` | Sin `checkoutDeliveryRequest` ni `readRequestedDelivery`. | L |
| `composition.ts` | `observed.courierId` desde el snapshot; log sin `chargeDeliveryToCustomer` (l. 94). | A/L |
| `presentation/api-routes.ts` | Sin `COURIER_UNAVAILABLE`. | A |
| `presentation/order-json.ts` | `toLegacyOrderJson` (respuesta POS `handover`) se conserva. | — |

### 7.3 Core web

| Archivo | Cambio | Tag |
| --- | --- | --- |
| `app/routes/delivery-settings.tsx` | Sección de zonas propia (hoy en las pestañas home/agency, l. 207 y 231); couriers desde el catálogo. | Z/C |
| `app/components/delivery-zones-section.tsx` | Reescribir: distritos y opciones de la zona; en opciones agency, selector de agencias del catálogo por courier (`agency-catalog`) con búsqueda por nombre o distrito. | Z/A |
| `src/features/orders/presentation/rated-delivery-form.tsx` | `rate.name`; selector de agencia; `agencyId` en el payload (l. 64). | Z/A |
| `app/components/checkout-delivery-fields.tsx` | Nombre en lugar de “Opción N” (l. 87); selector de agencia (l. 62); resumen con agencia (l. 78–79). | Z/A/L |
| `app/routes/order-detail.tsx` | Quitar rama `courier === null` (l. 331); courier y agencia. | A/L |
| `app/routes/order-new.tsx` | `completeOrderSchema` redefinido. | L |
| `app/locales.ts` | Claves de opciones y agencias; quitar `deliverySettings.agencyScope` y `assignmentPending`. | Z/A/L |

### 7.4 Mobile

| Archivo | Cambio | Tag |
| --- | --- | --- |
| `delivery-settings/application/delivery-settings.ts`, `quotation.ts` | Tipos de §5.8. | Z/A |
| `delivery-settings/infrastructure/delivery-settings-api.ts` (l. 29–37) | Opciones con precio; request sin `method`; catálogos de couriers y agencias. | Z/C/A |
| `delivery-settings/infrastructure/quotation-api.ts` (l. 23–27) | Conservar `name`, `zoneName`, `agencies`. | Z/A |
| `delivery-settings/presentation/*` (`delivery-zones-section.tsx`, `delivery-settings-screen.tsx` l. 65, `translations.ts`) | Editor de zonas con opciones y selector de agencias del catálogo; couriers del catálogo. | Z/C/A |
| `orders/domain/order-draft.ts` (l. 29–36), `presentation/order-delivery-form.ts` (l. 29) | `agencyId` en agency. | A |
| `orders/presentation/delivery-fields.tsx`, `order-delivery-screen.tsx`, `new-order-screen.tsx` | Nombre de la opción; selector de agencia. | Z/A |
| `orders/infrastructure/order-api.ts` (l. 145–157) | Verificar `agency.id` tras asignar. | A |
| `orders/infrastructure/pending-order-confirmation.ts` | Eliminar `legacyPendingSchema` y `legacyCompleteOrderSchema`; solo `version: 2`. | L |
| `orders/application/order-operations.ts` (l. 116–119) | Sin rama legacy ni `chargeDeliveryToCustomer`; renombrar `reviewLegacyPendingDelivery` a `reviewPendingDelivery` (cubre tarifas vencidas). | L |
| `orders/presentation/new-order-screen.tsx` (l. 79–357) | Quitar `legacyDelivery`, `legacyAttemptHint` y rama `pending && !pending.request`. Un intento sin `agencyId` da `INVALID_PENDING_DATA`: la pantalla debe ofrecer descartarlo. | L |
| `orders/presentation/order-detail-screen.tsx` (l. 334, 355–358), `translations.ts` | Courier y agencia del snapshot; quitar textos legacy. | A/L |

## 8. Pruebas

| Nivel | Qué cubrir |
| --- | --- |
| Dominio (unit) | `prepareDeliveryZones`: retención, inmutables, nombres por zona, `agencyIds` inexistentes, duplicados o en opción home (rechazado por schema). `agencyIds` de un courier que la empresa no tiene; agencia deshabilitada aceptada al guardar. `parseDeliveryAgency`: distrito fuera de catálogo. `prepareCouriers`: catálogo inexistente/deshabilitado, duplicado. `applicableDeliveryOptions`: cada condición de la tabla de invariantes y el orden. `validateSelectedDeliveryRate`: agencia no asociada, deshabilitada, courier deshabilitado, precio cambiado. `buildRatedDeliverySnapshot` con agencia. |
| Contratos | Schemas de §4: `agencyIds` en home rechazado, tarifa agency sin agencias rechazada, snapshot con `courier: null` o agencia de texto rechazado, `publicCheckoutDeliverySchema` sin `recordedBy`. |
| Integración de persistencia | Aislamiento por empresa de opción y asociación; la misma agencia asociada por dos empresas; FK compuesta que impide asociar una opción home (insert directo); seed repetido sin filas nuevas ni IDs cambiados; concurrencia “desactivar agencia vs. asignar” bajo bloqueo; limpieza en orden rate → quotation → opción–agencia → opción → agencia → distrito → zona → courier de empresa. |
| API | Rutas de §4.1, errores de §6, `agency-catalog` con courier ajeno (404) y conflictos de versión entre `PUT /zones` y `PUT /api/delivery-settings`. |
| E2E | Rehacer `agency-delivery.spec.ts`; actualizar `delivery-settings`, `checkout`, `mobile-checkout`, `mobile-order-creation`, `rated-order-creation-action`, `rated-order-delivery-action`, `orders`, `order-fulfillment`, `buyer-payment`, `store-delivery`. |
| Mobile | `delivery-settings*.test.ts(x)`, `quotation-api.test.ts`, `order-operations.test.ts`, `pending-order-confirmation.test.ts`, `order-api.test.ts`, `order-draft.test.ts`, `new-order-screen.test.tsx`, `new-order-screen.integration.tsx`, `order-delivery-screen.test.tsx`, `order-detail-screen.test.tsx`. |

Archivos existentes afectados en Core: `delivery-zone.test.ts`, `quotation.test.ts`, `couriers.test.ts`, `delivery-zones.test.ts`, `create-quotation.test.ts`, `resolve-selected-delivery-rate.test.ts`, `delivery-settings.test.ts`, integraciones de repositorios, `api-routes*.test.ts`, `quotation-routes.test.ts`, `quotation-contracts.test.ts`, `quotation-api.test.ts`, `order-state-machine.test.ts`, `resolve-shipping-cost.test.ts` (l. 40, 47), `resolve-shipping-cost.integration.test.ts` (l. 38–53), `set-delivery.test.ts`, `checkout.test.ts`, `composition.test.ts`, `order-repository.integration.test.ts`, `order-contracts.test.ts` (l. 72), `checkout-contracts.test.ts` (l. 34–40), `api-routes.integration.test.ts`, `order-json.test.ts`; en web, `delivery-zones-section.test.ts`, `checkout-delivery-fields.test.tsx`, `delivery-settings.test.ts`, `checkout.test.ts`, `order-delivery-action.test.ts`, `order-new-action.test.ts`.

Documentación y memoria: actualizar `docs/modalidades-de-entrega-validacion.md` (U06, U13, E09, E10 describen agencia como texto) y las memorias listadas en [§1](#memorias-del-repositorio-afectadas).

## 9. Riesgos

- **Agencias entre cotizar y asignar.** No se persisten en `DeliveryRate`; pueden cambiar. La resolución valida bajo bloqueo y devuelve `RATE_UNAVAILABLE`; la UI recotiza.
- **Opciones de agencia sin agencias.** Desactivar la última agencia o courier deja opciones que no aplican sin error en configuración. La UI de zonas debe advertirlo junto a la opción.
- **Cambios por SQL.** Editar o deshabilitar una agencia del catálogo afecta a la cotización de todas las empresas que la asocian, sin incrementar su `version` ni pasar por el bloqueo de configuración. Una agencia deshabilitada entre resolver y escribir el pedido puede quedar en ese pedido; el snapshot conserva sus datos. Los scripts deben revisarse como cambios de producción.
- **Divisa.** Las opciones guardan `priceCurrency`; si la empresa cambiara de divisa quedarían inválidas al leerse. Igual que hoy con las zonas.
- **Catálogo global.** Deshabilitar un `Courier` del catálogo saca de la cotización a todas sus agencias en todas las empresas (`courierEnabled`).
- **Volumen del catálogo.** Un courier puede tener cientos de agencias: `agency-catalog` se pide por courier y la cotización solo lee las asociadas. Si crece más, añadir filtro por departamento.
- **Bases locales.** Pedidos con snapshots anteriores dejan de leerse hasta resetear la base (§3.2).
