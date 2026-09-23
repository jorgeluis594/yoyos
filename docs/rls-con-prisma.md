# Aislamiento Company con Prisma y PostgreSQL

`User.companyId` referencia una `Company` y puede ser `null` mientras la cuenta termina el registro. Las tablas de autenticación son globales y no tienen RLS. Un resolvedor compartido valida la sesión de Better Auth y lee `User.companyId` con `authPrisma`. El middleware de rutas tenant bajo `/api` usa ese ID, nunca uno enviado por el cliente: devuelve `401` sin sesión y `409` si falta empresa. Los loaders y actions protegidos deben usar el mismo resolvedor y envolver sus consultas tenant en `withCompanyContext(companyId, callback)`.

`POST /api/company` queda fuera del middleware tenant. Una cuenta autenticada sin empresa envía `{ "name": "Nombre" }`; el servidor recorta espacios, exige entre 1 y 120 caracteres, genera el UUID y crea la empresa junto con la asociación al usuario en una transacción con `app.company_id` configurado. Devuelve `{ companyId }` con `201`. Si ya está asociada, responde `200` con el ID existente. Si falla la asociación, la empresa creada se revierte y se puede reintentar desde `/register` sin crear otra cuenta. `/api/auth/*` también queda fuera del middleware.

`withCompanyContext` guarda la empresa ya autorizada en `AsyncLocalStorage` y no abre una transacción.

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

El cliente `authPrisma` permite solo `User`, `Session`, `Account` y `Verification`. No exige contexto Company y conserva las transacciones nativas que usa Better Auth. Rechaza SQL directo y modelos tenant. El cliente tenant `prisma` rechaza los modelos de autenticación.

La migración `20260923150000_company_rls` activa `ENABLE` y `FORCE ROW LEVEL SECURITY` para `Company`. Su política `USING` y `WITH CHECK` compara `id` con `NULLIF(current_setting('app.company_id', true), '')::uuid`. Sin contexto no se ven ni escriben filas. El rol `core_app` tiene solo permisos DML sobre las tablas de aplicación, sin `TRUNCATE`, propiedad de tablas, superusuario ni `BYPASSRLS`. El servicio `migrate` usa las credenciales de migración; `web` usa exclusivamente el rol restringido.

Para validar en una base PostgreSQL 18 desechable y vacía, con `psql` instalado, define `RLS_TEST_ADMIN_URL` y `RLS_TEST_DATABASE_URL` (el segundo con usuario `core_app`) y ejecuta `pnpm test:rls` desde `apps/core`. La prueba aplica las migraciones reales, provisiona el rol, verifica políticas y permisos, y falla si faltan las variables. No uses una base con datos: la prueba exige que `Company` no exista.

Toda persistencia debe esperarse dentro de su contexto. Una tarea diferida no forma parte automáticamente de una transacción ya terminada.
