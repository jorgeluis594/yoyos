# Aislamiento Company con Prisma y PostgreSQL

`withCompanyContext(companyId, callback)` guarda una Company previamente autorizada en `AsyncLocalStorage`. No abre una transacción. La autorización y selección de Company deben ocurrir antes de llamar al helper; aún no existe una relación usuario–Company ni endpoints para seleccionarla.

Los repositorios usan `prisma` directamente. Cada consulta de modelo o SQL directo exige contexto Company, abre una transacción corta, configura `app.company_id` con `set_config(..., true)` y confirma antes de devolver el resultado. Esto incluye `$queryRaw`, `$executeRaw`, las variantes `Unsafe` y `Prisma.sql`; siempre se conservan sus parámetros. Las consultas independientes confirman independientemente.

```ts
await withCompanyContext(companyId, async () => {
  await prisma.company.update({ where: { id: companyId }, data: { name: "Nueva" } });
  return withinTransaction(async () => {
    await guardarPedido();
    await guardarDetalle();
    return ok(null);
  });
});
```

`withinTransaction` agrupa operaciones en la misma conexión, con una sola configuración Company. Retorna un `Result` fallido después del rollback; propaga excepciones y errores de commit. Un `Result` fallido de una llamada anidada o un error técnico capturado marca todo el bloque para rollback. Cambiar de Company dentro del bloque falla y también lo marca para rollback. `prisma.$transaction` está bloqueado: usa `withinTransaction` para operaciones tenant.

El cliente `authPrisma` permite solo `User`, `Session`, `Account` y `Verification`. No exige contexto Company y conserva las transacciones nativas que usa Better Auth. Rechaza SQL directo y modelos tenant. Las tablas de autenticación son globales.

La migración `20260923150000_company_rls` activa `ENABLE` y `FORCE ROW LEVEL SECURITY` para `Company`. Su política `USING` y `WITH CHECK` compara `id` con `NULLIF(current_setting('app.company_id', true), '')::uuid`. Sin contexto no se ven ni escriben filas. El rol `core_app` tiene solo permisos DML sobre las tablas de aplicación, sin `TRUNCATE`, propiedad de tablas, superusuario ni `BYPASSRLS`. El servicio `migrate` usa las credenciales de migración; `web` usa exclusivamente el rol restringido.

Para validar en una base PostgreSQL 18 desechable y vacía, con `psql` instalado, define `RLS_TEST_ADMIN_URL` y `RLS_TEST_DATABASE_URL` (el segundo con usuario `core_app`) y ejecuta `pnpm test:rls` desde `apps/core`. La prueba aplica las migraciones reales, provisiona el rol, verifica políticas y permisos, y falla si faltan las variables. No uses una base con datos: la prueba exige que `Company` no exista.

Toda persistencia debe esperarse dentro de su contexto. Una tarea diferida no forma parte automáticamente de una transacción ya terminada.
