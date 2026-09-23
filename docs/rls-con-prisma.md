# RLS por Company con Prisma

**Estado:** contexto asíncrono, `withinCompanyContext` y transacciones cortas implementados; las políticas RLS productivas y la integración de entradas siguen pendientes. La relación usuario–Company y los flujos de selección y creación de compañías siguen pendientes de definición.

## Objetivo

Aislar los datos de cada Company mediante PostgreSQL Row Level Security (RLS), respetando las convenciones de [arquitectura](architecture.md), [persistencia](persistence.md) y [programación](programming-style.md).

Establecer una compañía para una petición no agrupa todas sus escrituras en una sola transacción. Cada operación de persistencia confirma sus cambios de forma independiente, excepto cuando el caso de uso agrupa explícitamente varias operaciones con `withinTransaction`.

## Definiciones del aislamiento por tenant

El aislamiento se implementa mediante los siguientes contratos:

- **Contexto:** `withCompanyContext(companyId, callback)` publica una compañía previamente autorizada mediante `AsyncLocalStorage.run`. Los contextos anidados pueden cambiar de compañía fuera de una transacción activa; al regresar al callback exterior se conserva su compañía. Los flujos concurrentes mantienen contextos independientes.
- **Conexión y transacción:** `withinCompanyContext(callback)` exige contexto y abre una transacción interactiva por llamada, incluidas las lecturas. Configura `app.company_id` mediante `set_config(..., true)` y entrega el mismo cliente transaccional al callback para consultas de modelo o SQL directo. Si hay una transacción activa de esa compañía, reutiliza su cliente sin repetir la configuración.
- **Inserción:** el repositorio obtiene `companyId` del contexto autorizado y lo asigna a cada fila, incluidas las escrituras múltiples y anidadas. El cliente no elige ese valor mediante el payload. PostgreSQL verifica mediante `WITH CHECK` que la fila pertenece a la compañía activa.
- **Lectura y eliminación:** cada tabla tenant aplica `USING` sobre su propio `companyId`. La condición restringe búsquedas por ID, listados, relaciones, conteos, agregaciones y eliminaciones a las filas de la compañía activa.
- **Actualización:** `USING` restringe las filas modificables y `WITH CHECK` valida su estado resultante. El repositorio excluye `companyId` de los campos editables, y RLS rechaza trasladar una fila a otra compañía bajo el rol de aplicación.
- **Atomicidad:** cada operación independiente confirma antes de retornar éxito. `withinTransaction` agrupa operaciones que requieren commit o rollback conjunto; la compañía permanece fija durante ese bloque y un intento de cambiarla falla antes de ejecutar SQL.
- **Migraciones:** cada tabla tenant declara `companyId UUID NOT NULL` y su propia política RLS en el SQL versionado de Prisma. La condición se evalúa sobre la fila, sin consultar la jerarquía de padres.

Prisma administra las conexiones del pool y PostgreSQL limita la configuración del tenant a la transacción. La asignación de `companyId` corresponde a los repositorios; las políticas validan las filas. Este diseño no requiere triggers de tenant ni hooks sobre el pool. El coste de abrir transacciones por operación y los criterios para medirlo se detallan en la sección de rendimiento.

## Situación del repositorio

- `apps/core/src/shared/infrastructure/prisma.ts` configura el cliente compartido de Prisma 7 y su adaptador PostgreSQL.
- En los cambios revisados de `add-company`, Company tiene `id` UUID y `name`; existen su migración y tipo de dominio. Todavía no hay relación de pertenencia con usuarios.
- `add-login` incorpora autenticación y consulta de sesión desde loaders de React Router. La resolución de Company debe servir tanto a la API como a las entradas web.
- Aplicación y dominio permanecen independientes de Express, Prisma y `AsyncLocalStorage`. La composición proporciona las dependencias concretas.

## Contexto de compañía: withCompanyContext

`withCompanyContext(companyId, callback)` establece la compañía previamente autorizada mediante `AsyncLocalStorage` durante el callback y su cadena asíncrona. No abre una transacción, no reserva una conexión y no ejecuta `SET` en PostgreSQL.

El middleware autentica, valida el identificador y comprueba el acceso antes de establecer el contexto. Un identificador recibido por URL, cabecera o cuerpo no demuestra autorización.

Ejemplo conceptual, posterior a la autorización:

```ts
withCompanyContext(authorizedCompanyId, () => next());
```

`next()` debe ejecutarse dentro del callback. El contexto sigue disponible tras los `await` de handlers, casos de uso y repositorios que continúan ese flujo. Las peticiones concurrentes mantienen contextos independientes.

No funciona establecer el contexto, salir del callback y llamar después a `next()`. Tampoco se transmite automáticamente a otra petición, proceso, worker o mensaje de una cola: cada entrada establece nuevamente su contexto autorizado.

El manejo de errores sigue siendo responsabilidad de la entrada HTTP. `AsyncLocalStorage` no espera por sí mismo a que termine la respuesta ni convierte `next()` en una promesa.

Se permite anidar contextos de compañías previamente autorizadas cuando no hay una transacción activa. Cada callback usa su propio contexto; al terminar o lanzar un error, el flujo exterior conserva su compañía. Se implementa con `AsyncLocalStorage.run`, sin mutar el contexto exterior. Las tareas asíncronas creadas dentro del callback conservan su contexto; todo trabajo de persistencia debe esperarse.

```ts
await withCompanyContext(companyA.id, async () => {
  await saveProduct(productA); // Se inserta en A.
  await withCompanyContext(companyB.id, async () => {
    await saveProduct(productB); // Se inserta en B.
    await listProducts(); // Solo B.
  });
  await listProducts(); // Solo A.
});
```

El helper no autoriza el cambio por sí mismo. Cambiar de compañía dentro de `withinTransaction` se rechaza antes de ejecutar SQL.

## Atomicidad explícita: withinTransaction

`withinTransaction(callback)` es la capacidad para agrupar operaciones atómicas. La aplicación recibe esta función como dependencia, sin importar Prisma ni tipos del cliente transaccional.

Su implementación en infraestructura:

1. Exige un contexto autorizado de Company antes de ejecutar consultas.
2. Si ya existe una transacción activa para esa compañía, la reutiliza.
3. Si no existe, abre una transacción interactiva desde el cliente base.
4. Establece `app.company_id` dentro de esa transacción.
5. Publica `{ companyId, tx }` en un contexto asíncrono limitado al callback transaccional.
6. Ejecuta el callback y confirma únicamente cuando el bloque termina correctamente y el commit tiene éxito.
7. Ante un resultado fallido o excepción, revierte y comunica el fallo.

La compañía es inmutable durante la transacción. Intentar establecer otra compañía en ese alcance debe fallar. Las llamadas anidadas reutilizan el mismo bloque atómico: no crean transacciones independientes ni savepoints.

El contexto transaccional tiene un alcance propio. No se muta el contexto compartido de la petición para colocar `tx`; así dos operaciones concurrentes fuera de `withinTransaction` no comparten accidentalmente una transacción.

## Persistencia con RLS

Los repositorios tenant llaman a `withinCompanyContext((prisma) => ...)` desde infraestructura y usan el cliente recibido para operaciones de modelo y SQL directo. `getCompanyId()` entrega el identificador autorizado para asignarlo explícitamente al insertar.

```ts
return withinCompanyContext((prisma) =>
  prisma.product.create({ data: { ...input, companyId: getCompanyId() } }),
);
```

| Contexto al invocarlo | Comportamiento |
| --- | --- |
| Falta Company | Falla antes de ejecutar consultas. |
| Company presente, sin transacción activa | Abre una transacción corta, configura RLS, ejecuta el callback y confirma. |
| Company presente, con transacción activa | Ejecuta mediante el mismo `tx`; la confirmación corresponde al bloque exterior. |

El cliente transaccional se entrega solo al callback. Los repositorios usan ese cliente para todas sus consultas tenant, incluido SQL directo; el cliente base se reserva para autenticación y para abrir transacciones.

Cada llamada a `withinCompanyContext` fuera de `withinTransaction` confirma por separado. Las consultas dentro de un mismo callback comparten la transacción corta. Para agrupar operaciones de varios repositorios, el caso de uso utiliza `withinTransaction`.

Lecturas, conteos, búsquedas por ID, escrituras y eliminaciones tenant pasan por esta función. No hay fallback silencioso al cliente global cuando falta contexto.

El cliente base se conserva para abrir transacciones y para accesos explícitos que funcionan antes de seleccionar Company, como autenticación. No se expone como alternativa genérica para saltar el aislamiento de los repositorios tenant.

## Flujo completo

```text
Middleware o entrada web
  → autenticar y autorizar Company
  → withCompanyContext(companyId)
    → handler / loader
      → caso de uso con dependencias inyectadas
        → repositorio
          → withinCompanyContext(prisma => consulta)
            → transacción corta + configuración RLS + consulta

Caso de uso que necesita atomicidad entre operaciones
  → withinTransaction
    → transacción + configuración RLS + contexto tx
      → repositorio A → withinCompanyContext reutiliza tx
      → repositorio B → withinCompanyContext reutiliza tx
    → commit o rollback conjunto
```

La compañía puede resolverse en el middleware y la transacción abrirse después, tras varios `await`, siempre que ambos pertenezcan a la misma cadena asíncrona. El middleware no mantiene una transacción abierta durante toda la petición.

Las entradas de React Router reutilizan la misma capacidad de autorización y establecimiento de contexto. Montar el middleware solo en `/api` no protege automáticamente loaders y actions.

## Semántica de confirmación y rollback

### Operaciones independientes

Ejemplo conceptual con funciones que devuelven `Result`:

```ts
const product = await saveProduct(input.product);
if (!product.success) return product;

return saveCustomer(input.customer);
```

Dentro de un contexto Company, pero fuera de `withinTransaction`, `saveProduct` confirma su operación antes de retornar éxito. Si luego falla `saveCustomer`, el producto permanece guardado. Lo mismo aplica si falla una llamada externa o la construcción posterior de la respuesta.

### Operaciones agrupadas explícitamente

```ts
return withinTransaction(async () => {
  const product = await saveProduct(input.product);
  if (!product.success) return product;

  return saveCustomer(input.customer);
});
```

Ambos repositorios comparten `tx`. Si falla cualquiera, se revierten las escrituras del bloque completo. El éxito de un repositorio dentro de este bloque es provisional hasta el commit exterior.

### Errores y transacciones anidadas

- Retornar `Result` fallido no provoca rollback automáticamente en Prisma. El adaptador transaccional convierte ese resultado en una señal interna de aborto y recupera el fallo de aplicación fuera de la transacción.
- Un fallo de un bloque transaccional anidado impide que el exterior confirme, incluso si un llamador ignora el resultado. La implementación conserva un estado de aborto para el bloque compartido o un mecanismo equivalente.
- Un error técnico propagado desde el callback de `withinCompanyContext` marca el bloque como abortado aunque el llamador capture la excepción. Un repositorio que convierta un fallo de negocio a `Result` debe propagarlo desde el callback de `withinTransaction`; un `Result` fallido ignorado no se detecta automáticamente.
- Un fallo de commit, conexión o timeout nunca devuelve un resultado exitoso calculado antes de confirmar. Una pérdida de conexión durante el commit puede dejar su resultado incierto; no se presume rollback ni se reintentan escrituras automáticamente.
- Los errores de aplicación siguen `shared/result.ts`. Los detalles técnicos se conservan para diagnóstico sin exponerlos al cliente.
- Todo trabajo transaccional se espera antes de salir del callback. No se lanzan tareas en segundo plano que sigan usando `tx` después de su cierre.
- El rollback de PostgreSQL no revierte llamadas externas. No se incluyen cobros, mensajes ni otras integraciones lentas dentro de la transacción como si fueran efectos reversibles.

## Configuración de PostgreSQL

Dentro de la misma transacción que ejecuta las consultas:

```ts
await tx.$queryRaw`
  SELECT set_config('app.company_id', ${companyId}, true)
`;
```

El tercer argumento limita el valor a la transacción. El middleware no ejecuta un `SET` sobre una conexión arbitraria del pool ni configura el tenant a nivel de sesión.

Ejemplo para una futura tabla `Order` con `companyId` UUID:

```sql
ALTER TABLE "Order" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Order" FORCE ROW LEVEL SECURITY;

CREATE POLICY order_by_company ON "Order"
  USING (
    "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid
  )
  WITH CHECK (
    "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid
  );
```

`USING` restringe las filas existentes; `WITH CHECK` controla el tenant de las filas insertadas o actualizadas. Sin contexto, esta política no concede acceso. Cada tabla tenant necesita su política; proteger Company no protege automáticamente sus tablas relacionadas.

El rol de ejecución no debe ser superusuario ni tener `BYPASSRLS`. Se separan los permisos de migración de los de ejecución. `FORCE ROW LEVEL SECURITY` somete al propietario a las políticas, pero no neutraliza superusuarios ni `BYPASSRLS`.

Los repositorios suministran `companyId` desde el contexto autorizado al insertar; la política no completa ese campo. En Company, la política de acceso al registro activo compararía `id`, no un campo `companyId` inexistente.

Cada tabla tenant, incluidas las hijas indirectas, tiene su propio `companyId UUID NOT NULL`. La política compara ese campo con el parámetro activo sin recorrer padres ni consultar otras tablas. El aislamiento por fila no exige claves foráneas compuestas ni una jerarquía de relaciones. La integridad de referencias entre compañías es una garantía distinta que debe definirse cuando una relación de negocio la requiera; una FK simple no garantiza que ambos registros pertenezcan a la misma compañía.

### Comportamiento por operación

| Operación | Implementación y garantía |
| --- | --- |
| Insertar | El repositorio obtiene `companyId` del contexto autorizado y lo incluye en cada fila, también en inserciones múltiples o anidadas. No toma el tenant del payload. `WITH CHECK` rechaza una fila atribuida a otra compañía. |
| Obtener | `USING` filtra por la compañía activa en búsquedas por ID, listados, relaciones, conteos y agregaciones. Cada tabla consultada necesita su propia política. |
| Actualizar | `USING` limita las filas existentes que pueden modificarse; `WITH CHECK` comprueba el resultado. El repositorio no admite cambiar `companyId` como dato editable. Una fila de otra compañía no se modifica. |
| Eliminar | `USING` limita las filas eliminables a la compañía activa. |

La ausencia de contexto falla en `withinCompanyContext`. Bajo el rol restringido, una consulta directa sin contexto no ve filas y sus inserciones no superan la política. Las escrituras masivas y los upserts también deben respetar las condiciones de cada operación.

La referencia `pg_rls` usa una columna por fila y un parámetro de PostgreSQL, y automatiza políticas y triggers desde las migraciones. Su trigger de inserción sobrescribe el tenant recibido y otro bloquea su actualización. Aquí se mantiene la asignación explícita desde el repositorio y el parámetro local a la transacción; el helper de cambio de contexto no requiere triggers.

## Directivas de migración pendientes

Como parte de la implementación se debe crear `docs/migrations.md`, con directivas para autores y revisores de migraciones. Debe cubrir:

- Clasificar las tablas tenant y las globales; cada tabla tenant declara `companyId` obligatorio y su política propia.
- Mantener campos, índices y relaciones en el schema de Prisma, y las políticas RLS en el SQL versionado de sus migraciones.
- Documentar la asignación de `companyId` desde los repositorios, el uso de contexto transaccional y el SQL explícito que debe incluirse en cada migración para habilitar y forzar RLS y crear su política.
- Generar con `prisma migrate dev --create-only`, revisar y completar el SQL antes de aplicarlo; desplegar mediante `prisma migrate deploy` y no editar migraciones aplicadas.
- Publicar la creación de tablas y su protección RLS de forma atómica, con `ENABLE`, `FORCE`, `USING` y `WITH CHECK`. Separar roles de migración y ejecución; no conceder `TRUNCATE` al rol de aplicación.
- Diseñar índices según los filtros y órdenes reales por compañía, y unicidad por tenant cuando sea una regla de negocio. Evitar índices redundantes.
- Para tablas con datos, definir el origen del tenant, completar y validar los datos antes de imponer `NOT NULL` y activar la protección; coordinar el despliegue con los repositorios que configuran el contexto.
- Verificar que el historial completo se reproduce en una base vacía y en la shadow database, y probar aislamiento con PostgreSQL real y el rol restringido.

## Rendimiento

Este es un análisis del diseño, no un benchmark. Las políticas productivas aún no están implementadas y no hay mediciones de carga que permitan asignarles una latencia o capacidad concretas.

Cambiar el contexto en `AsyncLocalStorage` no consulta PostgreSQL ni reserva conexiones. El coste esperado más relevante para operaciones pequeñas es abrir una transacción interactiva, ejecutar `set_config`, consultar y confirmar. Frente a una consulta en autocommit hay intercambios adicionales con la base; su impacto crece con la latencia de red y con el número de operaciones independientes por petición. Una transacción toma una conexión del pool existente, no crea una conexión física por definición.

La conexión permanece ocupada hasta terminar la transacción. Se deben mantener transacciones cortas y excluir llamadas externas. La concurrencia sin límite puede agotar el pool y producir esperas. Dentro de una misma transacción Prisma ejecuta las consultas sobre una conexión; `Promise.all` no las paraleliza en PostgreSQL. El contexto por sí solo no obliga a compartir conexión ni serializa operaciones independientes.

La política compara el UUID de la fila con el tenant activo. No realiza consultas a padres. El rendimiento de listados y conteos depende de los índices y de cuántas filas pertenecen al tenant: por ejemplo, un listado por fecha puede beneficiarse de un índice por `(companyId, createdAt)`. No se presupone que todo acceso necesite ese índice ni que RLS fuerce un recorrido completo; se comprueba el plan real bajo el rol de ejecución.

Evitar N+1 y escrituras de una fila por llamada cuando la operación admite consultas o inserciones por lotes. En una transacción ya activa, `withinCompanyContext` reutiliza `tx` y no repite `set_config`. No agrupar escrituras independientes en `withinTransaction` solo para reducir costes: eso cambia su semántica de rollback.

Antes de optimizar, medir latencias p50/p95, espera por conexión y capacidad bajo concurrencia representativa. Comparar consultas con filtro explícito por compañía contra su equivalente con RLS, con los mismos datos y resultados, y separar el coste de la política del coste del wrapper transaccional. Revisar `EXPLAIN (ANALYZE, BUFFERS)` en un entorno de pruebas para listados, conteos y actualizaciones, incluyendo tenants de tamaños distintos. Las mediciones deben conservar las pruebas de aislamiento al reutilizar conexiones.

## Ubicación y dependencias

| Responsabilidad | Ubicación |
| --- | --- |
| Identidad y adaptación HTTP/web | Middleware y entradas de presentación. |
| Pertenencia y autorización | Capacidades de aplicación y reglas del dominio correspondiente. |
| Contexto asíncrono, `withinCompanyContext` y wrapper transaccional | `apps/core/src/shared/infrastructure/`. |
| Consultas concretas | `features/<feature>/infrastructure/`. |
| Contrato de atomicidad | Dependencia de aplicación, pequeña y sin tipos Prisma. |
| Conexión de adaptadores y casos de uso | Composición de la aplicación o registro de features. |
| Políticas RLS y restricciones | Migraciones SQL de Prisma. |

No se crean repositorios genéricos ni un framework de inyección. El dominio no conoce el contexto asíncrono. La aplicación recibe el contexto de negocio que necesita como datos explícitos y la capacidad transaccional por composición; el acceso implícito a `tx` queda encapsulado en infraestructura.

## Referencia de animo-sales

La referencia revisada es `src/lib/prisma.ts` de `PECO-Devs/animo-sales`, commit `1c4b35b8c241c0cf4621c72ec094b580bad63c0b`. Su `withinTransaction` publica `tx` mediante `AsyncLocalStorage`, y los repositorios lo recuperan a través de `prisma()`.

Se conserva esa idea de propagación, con estas diferencias necesarias:

- Contexto Company separado de la transacción y RLS configurado al abrirla.
- Tipo transaccional correcto, sin presentarlo como un `PrismaClient` completo mediante `as any`.
- Ningún resultado exitoso si falla el commit.
- Fallos transaccionales anidados y errores técnicos capturados que impiden confirmar el bloque exterior.
- Transacciones cortas; no se copia el timeout de 60 segundos para acomodar integraciones externas.
- Acceso tenant sin fallback al cliente global.

## Verificación requerida al implementar

Usar PostgreSQL real y el rol de ejecución para comprobar RLS y rollback. Los mocks no demuestran aislamiento.

1. Company A no puede leer, contar, modificar ni eliminar filas de B; tampoco insertar una fila atribuida a B ni cambiar hacia B la compañía de una fila.
2. La falta de contexto falla en `withinCompanyContext`; una consulta directa sin contexto tampoco accede a filas tenant bajo el rol restringido.
3. El contexto sobrevive a varios `await` desde middleware hasta caso de uso; dos peticiones concurrentes no intercambian compañía.
4. Dos operaciones concurrentes fuera de `withinTransaction` tienen transacciones independientes.
5. Una operación confirmada permanece si falla otra posterior fuera de `withinTransaction`.
6. Dentro de `withinTransaction`, el fallo de la segunda operación revierte la primera; cubrir `Result` fallido, excepción y fallo anidado ignorado.
7. Un error al confirmar no retorna éxito.
8. Las operaciones anidadas reutilizan el alcance activo y rechazan cambiar de Company.
9. Una conexión reutilizada después de commit o rollback no conserva el tenant anterior; probar también con un pool de una conexión.
10. API y entradas SSR aplican la misma autorización y aislamiento.
11. Un contexto anidado A → B → A recupera A al terminar B, tanto en éxito como en error; los flujos concurrentes permanecen aislados.
12. Inserciones múltiples, escrituras anidadas y upserts respetan el tenant; el historial de migraciones protege todas las tablas declaradas tenant.

## Decisiones pendientes

- Si un usuario pertenece a una o varias compañías y cuál es el modelo de pertenencia.
- Cómo se selecciona y transporta la compañía activa, siempre validada en el servidor.
- Cómo se crean compañías y se listan las accesibles antes de tener una compañía activa, sin introducir un bypass genérico.
- Qué tablas son tenant y cuáles pertenecen al plano de identidad/autenticación.

Estas decisiones no cambian la separación acordada entre contexto y transacciones, pero deben resolverse antes de completar las políticas y el flujo de autorización.

## Referencias

- [Contexto asíncrono en Node.js](https://nodejs.org/api/async_context.html).
- [Índices multicolumna en PostgreSQL](https://www.postgresql.org/docs/18/indexes-multicolumn.html).
- [Políticas de pg_rls](https://github.com/Dandush03/pg_rls/blob/master/lib/pg_rls/active_record/connection_adapters/postgre_sql/rls_policies.rb).
- [Funciones de pg_rls](https://github.com/Dandush03/pg_rls/blob/master/lib/pg_rls/active_record/connection_adapters/postgre_sql/rls_functions.rb).
- [RLS en PostgreSQL](https://www.postgresql.org/docs/18/ddl-rowsecurity.html).
- [Configuración transaccional con set_config](https://www.postgresql.org/docs/18/functions-admin.html).
- [Transacciones en Prisma 7](https://github.com/prisma/web/blob/main/apps/docs/content/docs/orm/v7/prisma-client/queries/transactions.mdx).
- [Wrapper transaccional de animo-sales](https://github.com/PECO-Devs/animo-sales/blob/1c4b35b8c241c0cf4621c72ec094b580bad63c0b/src/lib/prisma.ts).
- [Caso de uso con capacidad transaccional inyectada](https://github.com/PECO-Devs/animo-sales/blob/1c4b35b8c241c0cf4621c72ec094b580bad63c0b/src/purchase-order/use-cases/receive-purchase-order.ts).
