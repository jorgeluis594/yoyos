# Revisión de aislamiento de tenants con `withCompanyContext`

Fecha: 23 de septiembre de 2026.

## Dictamen

La implementación cumple parcialmente. Protege las consultas normales a `Company` contra filtros de tenant omitidos, pero permite usos incorrectos de consultas diferidas, presenta un falso positivo en las pruebas y tiene límites de seguridad que deben considerarse antes de exponer funcionalidades de negocio.

La autorización usuario–empresa todavía está pendiente. El aislamiento completo requiere tanto autorizar la empresa seleccionada como restringir el acceso a sus datos.

Esta revisión no modificó la implementación. Los hallazgos describen el estado del código al momento del análisis; las recomendaciones todavía no están implementadas.

## Alcance y validación

Se revisaron:

- [`withCompanyContext`, `withinTransaction`, `prisma` y `authPrisma`](../apps/core/src/shared/infrastructure/prisma.ts).
- [Esquema de datos](../apps/core/prisma/schema.prisma) y [migración RLS](../apps/core/prisma/migrations/20260923150000_company_rls/migration.sql).
- [Permisos del rol de aplicación](../apps/core/scripts/provision-role.sql) y [configuración de despliegue](../compose.yaml).
- [Integración HTTP](../apps/core/src/app.ts), llamadas al helper y [pruebas existentes](../apps/core/src/shared/infrastructure/company-database.test.mjs).
- [Contrato documentado de aislamiento](rls-con-prisma.md).

Se ejecutó la suite existente con Prisma 7.10.0 en una base PostgreSQL 18 desechable. El ejecutor reportó cinco pruebas satisfactorias, contando la prueba contenedora y sus cuatro subpruebas. También se ejecutaron comprobaciones adicionales para los hallazgos descritos aquí. La base desechable se eliminó al terminar.

No se verificó una base de producción ni se realizó una prueba de carga concurrente. Las comprobaciones adicionales se ejecutaron durante la revisión y no se incorporaron a la suite del repositorio.

## Funcionamiento actual

`withCompanyContext(companyId, callback)` guarda la empresa en `AsyncLocalStorage`. No abre una transacción ni valida la pertenencia del usuario a la empresa.

El cliente `prisma` exige contexto para cada operación. Fuera de una transacción agrupada, abre una transacción corta, configura `app.company_id` mediante `set_config(..., true)`, ejecuta la consulta y confirma antes de devolver el resultado.

`withinTransaction` agrupa operaciones en una misma conexión y configura la empresa una sola vez. Un `Result` fallido, una excepción o un intento de cambiar de empresa durante el bloque provocan rollback. Los fallos de operaciones anidadas marcan la transacción para abortar aunque el callback exterior intente continuar.

PostgreSQL aplica una política RLS a `Company` que compara su `id` con `app.company_id`. Las tablas de autenticación son globales.

## Hallazgos

### 1. Una consulta diferida puede ejecutarse fuera del contexto declarado

**Clasificación:** uso incorrecto confirmado de consultas diferidas, con impacto potencial en lecturas y escrituras; no es una mezcla automática de contextos causada por `AsyncLocalStorage`.

**Ubicación:** `withCompanyContext` en [`prisma.ts`](../apps/core/src/shared/infrastructure/prisma.ts).

El helper devuelve directamente el resultado de `companies.run(companyId, callback)`. Una consulta Prisma devuelve una `PrismaPromise` diferida: devolverla desde el callback no implica ejecutarla dentro del contexto.

Se reprodujeron estos casos:

```ts
// Falla con “Company context is required” al esperarse fuera del contexto.
await withCompanyContext(companyA, () => prisma.company.findMany());

// La consulta creada dentro de A termina leyendo B.
const query = withCompanyContext(companyA, () => prisma.company.findMany());
await withCompanyContext(companyB, async () => await query);
```

El segundo caso puede dirigir una operación a una empresa distinta de la que pretendía el código que creó la consulta. No demuestra por sí solo un acceso HTTP no autorizado: requiere que el código traslade la consulta entre contextos.

La transacción obtiene el `companyId` de `AsyncLocalStorage` al ejecutar la consulta. En el segundo caso obtiene B porque ese es el contexto activo. El mismo problema puede ocurrir sin retornar nada, guardando la consulta en una variable exterior.

**Recomendación:** ejecutar y esperar las consultas dentro del callback correspondiente, sin trasladar consultas pendientes entre contextos. El callback no necesita devolver datos:

```ts
await withCompanyContext(companyA, async () => {
  await prisma.company.findMany();
});
```

**Validación pendiente:** incorporar pruebas que cubran el uso correcto sin retorno de datos y documenten el comportamiento de una consulta trasladada entre contextos. Impedir cualquier traslado requeriría una garantía adicional; quitar el retorno del helper no la proporciona.

### 2. La autorización usuario–empresa está pendiente

**Clasificación:** requisito de seguridad pendiente antes de integrar endpoints tenant.

**Ubicación:** [`schema.prisma`](../apps/core/prisma/schema.prisma), [`app.ts`](../apps/core/src/app.ts) y `withCompanyContext`.

El helper acepta cualquier `companyId`. No comprueba que el usuario pertenezca a esa empresa. El esquema no contiene una relación usuario–empresa y no se encontraron llamadas al helper desde endpoints de negocio.

Separar autorización y persistencia es válido, pero RLS confía en el ID seleccionado por la aplicación. No valida por sí mismo la pertenencia del usuario.

**Recomendación:** autenticar al usuario, verificar su acceso a la empresa solicitada y solo entonces abrir el contexto. Un ID recibido por URL, cabecera o cuerpo no constituye prueba de autorización.

No se encontró un endpoint tenant actualmente explotable. El riesgo aparece si se integra el helper usando directamente un identificador proporcionado por el cliente sin verificar acceso.

### 3. SQL arbitrario puede cambiar el tenant activo

**Clasificación:** límite confirmado del modelo de seguridad; no se encontró una inyección SQL existente.

**Ubicación:** reutilización de la transacción en `execute` y configuración inicial en `withinTransaction`.

Se reprodujo la siguiente secuencia usando el rol restringido `core_app`:

1. Abrir contexto A y entrar en `withinTransaction`.
2. Ejecutar `SELECT set_config('app.company_id', B, true)` mediante `$queryRaw`.
3. Ejecutar `prisma.company.findMany()`.
4. Obtener filas de B mientras `getCompanyId()` continúa devolviendo A.

La variable se configura una sola vez al abrir la transacción agrupada. El rol de aplicación puede modificarla después; el contexto de JavaScript y el de PostgreSQL pueden divergir.

**Implicación:** este diseño protege contra filtros de tenant omitidos, pero no contiene una inyección que permita ejecutar SQL arbitrario ni el uso malicioso de las credenciales de aplicación.

**Recomendación:** mantener las consultas parametrizadas y evitar construir SQL con entradas no confiables. Si el requisito incluye resistir SQL arbitrario ejecutado con el rol de aplicación, hace falta una frontera adicional de identidad tenant que ese mismo rol no pueda modificar. Bloquear una llamada concreta a `set_config` en JavaScript no equivale a establecer esa frontera.

### 4. El cliente tenant permite acceder a autenticación global

**Clasificación:** riesgo de acceso accidental fuera del ámbito tenant.

**Ubicación:** extensiones `prisma` y `authPrisma`.

Se confirmó que `prisma.user.findMany()` dentro del contexto A devuelve usuarios globales. El cliente tenant admite todos los modelos y las tablas de autenticación no tienen aislamiento Company.

`authPrisma` restringe sus operaciones a `User`, `Session`, `Account` y `Verification`, pero la restricción inversa no existe en `prisma`.

La autenticación global es una decisión documentada. La consecuencia es que disponer de contexto Company no convierte todas las consultas en consultas aisladas por empresa.

**Recomendación:** impedir el acceso accidental a los modelos de autenticación desde el cliente tenant y mantener su uso explícito mediante `authPrisma`. Una restricción de modelos en la aplicación no impide acceder a esas tablas mediante SQL arbitrario con los permisos actuales.

### 5. La prueba de fallo de commit acepta un error anterior al commit

**Clasificación:** falso positivo confirmado en una comprobación específica.

**Ubicación:** subprueba `does not report success on commit failure and clears local setting` en [`company-database.test.mjs`](../apps/core/src/shared/infrastructure/company-database.test.mjs).

La comprobación actual es:

```ts
await assert.rejects(
  withCompanyContext(companyA, () => insert("commit-fails", 999)),
);
```

Se confirmó que rechaza con `Company context is required` antes de ejecutar SQL, debido al retorno de una consulta diferida. Como acepta cualquier rechazo, pasa sin comprobar el fallo de commit que pretende validar.

**Recomendación:** esperar la consulta dentro del contexto y comprobar el error específico de la restricción diferida que debe fallar al confirmar. Las otras pruebas de rollback y fallos agrupados verifican rutas diferentes y no quedan invalidadas por este hallazgo.

### 6. El trabajo diferido puede persistir después de un rollback

**Clasificación:** límite de uso documentado, reproducido durante la revisión.

Una tarea asíncrona creada dentro de `withinTransaction`, pero no esperada por su callback, puede continuar cuando la transacción ya terminó. En ese momento `active` es `false`, por lo que una nueva consulta abre una transacción independiente.

Se reprodujo una escritura que se confirmó después de que el bloque original devolviera un `Result` fallido y realizara rollback.

**Recomendación:** esperar toda persistencia que deba formar parte de la operación atómica. No lanzar tareas de persistencia sin esperarlas dentro del bloque. Si se requiere rechazar todo uso posterior de un contexto transaccional terminado, esa garantía debe definirse y comprobarse explícitamente.

## Rendimiento

### Costo por consulta

El costo principal observado está en la transacción por operación independiente. Una lectura de modelo produjo esta secuencia SQL:

```text
BEGIN
SELECT set_config('app.company_id', $1, true)
SELECT ... FROM "Company" ...
COMMIT
```

Son cuatro sentencias para una lectura que normalmente requeriría una. El costo adicional de comunicación con PostgreSQL será más relevante cuando aumente la latencia de red.

### Medición exploratoria

Se ejecutaron 100 consultas secuenciales `SELECT 1` por modalidad contra PostgreSQL 18 local:

| Modalidad | Consultas solicitadas | Sentencias SQL observadas | Tiempo total observado |
| --- | ---: | ---: | ---: |
| Prisma directo | 100 | 100 | 107 ms |
| Cliente tenant, operaciones independientes | 100 | 400 | 234 ms |
| Cliente tenant, un `withinTransaction` | 100 | 103 | 51 ms |

Estos tiempos corresponden a una ejecución exploratoria, sin carga concurrente ni control estadístico de calentamiento y orden. No establecen una relación de rendimiento general ni predicen latencias de producción. El conteo de sentencias sí confirma el trabajo adicional de cada modalidad.

### Transacciones agrupadas

`withinTransaction` amortiza el costo de configurar el tenant y abrir y cerrar transacciones, pero ocupa una conexión durante todo el callback.

Recomendaciones:

- Agrupar operaciones relacionadas cuando requieran atomicidad o cuando una medición justifique hacerlo.
- Evitar llamadas HTTP y otras esperas externas dentro de la transacción.
- Medir latencia y espera por conexiones con una carga representativa antes de cambiar el tamaño del pool o agrupar solicitudes completas.
- Considerar los límites de duración: el código no configura `maxWait` ni `timeout`. Prisma 7 documenta valores predeterminados de 2 segundos de espera y 5 segundos de ejecución para transacciones interactivas.

Referencia: [transacciones de Prisma 7](https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions).

## Garantías que están bien implementadas

- La migración activa `ENABLE ROW LEVEL SECURITY` y `FORCE ROW LEVEL SECURITY` sobre `Company`.
- La política usa `USING` para visibilidad y `WITH CHECK` para validar las filas escritas.
- La configuración normal de `app.company_id` es local a la transacción.
- El rol de aplicación provisionado no es superusuario, no tiene `BYPASSRLS`, no es propietario de las tablas y no recibe permiso de `TRUNCATE`.
- Las operaciones normales del cliente tenant exigen contexto.
- Los casos probados de concurrencia y contextos anidados mantienen aislamiento cuando las consultas se esperan dentro del contexto correcto.
- Las transacciones agrupadas revierten cambios ante fallos anidados y ante intentos de cambiar de empresa.
- La configuración Compose separa las credenciales de migración de las credenciales de ejecución de la aplicación.

Estas medidas son coherentes con las garantías y excepciones de [RLS en PostgreSQL 18](https://www.postgresql.org/docs/18/ddl-rowsecurity.html). Su efectividad depende de que el despliegue real use el rol restringido y aplique las migraciones.

Actualmente `Company` es la única tabla de negocio tenant. El helper no instala políticas automáticamente: cualquier tabla tenant nueva necesitará su propia política, permisos y validación de aislamiento.

## Prioridad recomendada

1. Aplicar el contrato de ejecutar y esperar consultas dentro del contexto correspondiente, y agregar pruebas para el uso correcto y los límites de las consultas diferidas.
2. Corregir la comprobación de fallo de commit para que verifique el error esperado.
3. Implementar autorización usuario–empresa antes de exponer endpoints tenant.
4. Restringir los modelos globales accesibles desde el cliente tenant.
5. Mantener explícitos los límites frente a SQL arbitrario y trabajo asíncrono no esperado.
6. Medir carga concurrente y latencia de red antes de optimizar transacciones o conexiones.
