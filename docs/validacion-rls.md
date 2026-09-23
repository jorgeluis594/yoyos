# Validación de RLS en `apps/core`

Las pruebas comprueban el aislamiento por empresa en PostgreSQL 18. La implementación y sus garantías están descritas en [rls-con-prisma.md](rls-con-prisma.md).

## Ejecutar

Necesitas Docker, `psql` y las dependencias del proyecto instaladas. Desde `apps/core`:

```sh
pnpm test:integration
pnpm test:e2e
```

Ambos comandos usan `scripts/run-tests.sh`. El script inicia el servicio `db_test` de `compose.yaml`, espera a que esté listo, aplica las migraciones y configura el rol restringido `core_app`. Usa una base `core_test` separada de la base de desarrollo y se conecta por `127.0.0.1:55433`. El volumen `postgres_test_data` conserva la base entre ejecuciones; las migraciones ya aplicadas no se repiten.

`test:integration` ejecuta las pruebas de `src/shared/infrastructure/*.test.mjs`, incluidas las de RLS y cliente compartido. `test:e2e` ejecuta Playwright contra la aplicación iniciada con esa misma base. No hace falta definir URL de conexión manualmente: el script establece `TEST_ADMIN_DATABASE_URL` y `DATABASE_URL` para los procesos que lanza.

La prueba de RLS crea un esquema temporal para sus tablas auxiliares y limpia los datos que genera. Verifica que `core_app` no pueda omitir RLS, que las consultas requieran contexto de empresa y que los errores reviertan las transacciones agrupadas.
