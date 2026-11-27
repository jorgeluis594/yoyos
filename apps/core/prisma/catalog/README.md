# Catálogos del sistema

Couriers y agencias son datos del sistema, iguales para todas las empresas. La app solo los lee (`core_app` no puede escribirlos).

- `couriers.json`: catálogo de couriers. Upsert por `code`, que es inmutable. Un courier se retira con `"enabled": false`, nunca borrándolo.
- `agencies.csv`: catálogo de agencias. Columnas `id,courier,external_id,name,address,district_code,enabled`:
  - `id`: UUID de la agencia en Yoyos. Se genera una sola vez al agregar la fila y nunca cambia ni se reutiliza; la carga hace upsert por este valor.
  - `courier`: `code` de `couriers.json`.
  - `external_id`: identificador del courier (en Shalom, `ter_id`). Solo sirve para actualizar el CSV; no se guarda en la base.
  - `district_code`: ubigeo de 6 dígitos que exista en `shared/peru-geography.ts`.
  - Las filas nunca se borran: una agencia que cierra queda con `enabled` en `false`, porque opciones y pedidos la siguen referenciando.

## Cargar

`pnpm catalog:load` (`scripts/load-catalog.ts`) valida los dos archivos y, en una sola transacción, hace upsert de couriers y agencias. Si un archivo es inválido lista todas las filas con problema y no cambia nada; repetirlo no cambia nada. Las agencias de la base que no están en el CSV no se tocan y se reportan en `catalog_agencies_not_in_file`.

No corre en los despliegues: se ejecuta a mano después de desplegar un CSV nuevo, con el rol de migraciones (`core`):

```sh
# Local
docker compose exec web sh -c 'DATABASE_URL=postgresql://core:core@db:5432/core pnpm catalog:load'

# Producción (contenedores web y db del proyecto en Coolify)
PW=$(docker exec <db> printenv POSTGRES_PASSWORD)
docker exec -e DATABASE_URL="postgresql://core:$PW@db:5432/core" <web> pnpm catalog:load
```

En local y en los tests, `scripts/seed-courier-catalog.ts` sigue cargando solo `couriers.json` al levantar la base; los tests crean sus propias agencias y no dependen de `agencies.csv`.

## Actualizar las agencias de Shalom

Shalom no publica una API. Su web (shalom.com.pe/agencias) lee la lista de `POST https://newwebservices.shalomcontrol.com/api/v1/web/agencias/listar` con cuerpo `{}`; es un endpoint interno que puede cambiar sin aviso.

- Se cargan las agencias con `destino = 1` (reciben envíos para recojo) y `ter_internacional = 0`.
- `external_id` = `ter_id`, `name` = `lugar_over` sin el sufijo ` CO`, `address` = `direccion`, `district_code` = `ubi_id` con ceros a la izquierda. Espacios normalizados.
- Al actualizar: las agencias que ya están conservan su `id` (se buscan por `external_id`), las nuevas reciben un UUID nuevo y las que ya no vienen pasan a `enabled=false`. Revisa el diff antes del commit.
