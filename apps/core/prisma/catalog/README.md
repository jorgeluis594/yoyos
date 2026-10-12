# Catálogos del sistema

- `couriers.json`: fuente del catálogo de couriers. `scripts/seed-courier-catalog.ts` lo carga (upsert por `code`) después de las migraciones y antes de `provision-role.sql`. Un courier se retira dejándolo con `"enabled": false`, nunca borrándolo; `code` es inmutable.
- Scripts SQL de agencias (`*.sql`): las agencias se mantienen por SQL directo con un rol con permisos de escritura (no `core_app`), fuera de las migraciones. Guarda aquí los scripts aplicados para reproducir el catálogo en otros entornos. Reglas:
  - Genera los UUID en el script y no reutilices un ID para otra agencia.
  - `districtCode` debe existir en `shared/peru-geography.ts` (el CHECK solo valida el formato).
  - Deshabilita (`enabled = false`) en lugar de borrar.
  - Los tests crean sus propias filas; no dependen de estos scripts.
