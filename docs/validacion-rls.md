# Validación de RLS en `apps/core`

Las pruebas comprueban el aislamiento por empresa en PostgreSQL 18. La implementación y sus garantías están descritas en [rls-con-prisma.md](rls-con-prisma.md).

## Ejecutar

Necesitas Docker, `psql` y las dependencias del proyecto instaladas. Desde `apps/core`:

```sh
sh scripts/run-tests.sh integration
sh scripts/run-tests.sh e2e
```

El script inicia el servicio `db_test` de `compose.yaml`, espera a que esté listo, aplica las migraciones y configura el rol restringido `core_app`. Usa una base `core_test` separada de la base de desarrollo y se conecta por `127.0.0.1:55433`. El volumen `postgres_test_data` conserva la base entre ejecuciones; las migraciones ya aplicadas no se repiten.

El shell establece solo `DATABASE_URL` para la aplicación y después llama a `pnpm test:integration` o `pnpm test:e2e`. Usa una conexión administrativa local para preparar la base; la prueba RLS deriva esa conexión de `DATABASE_URL` con las credenciales `core:core` definidas en `compose.yaml`. El primer comando ejecuta las pruebas de `src/shared/infrastructure/*.test.mjs`, incluidas las de RLS y cliente compartido; el segundo ejecuta Playwright contra la aplicación iniciada con esa misma base. Los comandos `pnpm test:*` solo ejecutan pruebas: si los usas directamente, la base debe estar preparada y solo necesitas proporcionar `DATABASE_URL`, con el rol restringido `core_app`.

La prueba de RLS crea un esquema temporal para sus tablas auxiliares y limpia los datos que genera. Verifica que `core_app` no pueda omitir RLS, que las consultas requieran contexto de empresa y que los errores reviertan las transacciones agrupadas.
