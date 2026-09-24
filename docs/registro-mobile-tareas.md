# Tareas incrementales: registro mobile

## Propósito

Implementar la [arquitectura acordada](registro-mobile-pendientes.md) en cinco entregas completas y comprobables.

**Estado:** T1 y T2 terminadas y verificadas; T3–T5 pendientes. La evidencia figura en cada sección.

Cada tarea incluye código, integración con los consumidores que ya existen, configuración necesaria y pruebas. Puede depender de tareas anteriores terminadas, pero debe compilar y pasar sus criterios de aceptación sin implementar ninguna tarea posterior. Un módulo sin pantalla puede ser una entrega completa si su API funciona y sus pruebas ejercitan el comportamiento real del módulo.

Estas tareas son la unidad de ejecución; el documento de arquitectura contiene las definiciones y los contratos. No crear tareas independientes solo para instalar dependencias, declarar tipos, escribir tests o corregir integraciones rotas por otra tarea: ese trabajo pertenece a la entrega que lo necesita.

## Orden y entregables

| ID | Tarea | Requisito previo | Entregable comprobable |
| --- | --- | --- | --- |
| T1 | Unificar contexto autenticado y contratos de core/web | Código actual | Registro web y API por cookie funcionando con contexto tipado y Zod |
| T2 | Habilitar JWT revocables para la API | T1 | Core emite y valida JWT; conserva cookies y aislamiento tenant |
| T3 | Implementar sesión y transporte autenticado mobile | T2 | Login, restauración, renovación y logout invocables y probados sin pantallas |
| T4 | Implementar registro recuperable y creación de empresa mobile | T3 | Registro y recuperación invocables y probados sin pantallas |
| T5 | Integrar formularios, estado de acceso y navegación mobile | T4 | Flujo de UI conectado a las operaciones terminadas |

La secuencia es `T1 → T2 → T3 → T4 → T5`. No requiere trabajo paralelo. Todas las tareas respetan el tipado estricto, `Result`, validación Zod y ubicación `src/shared/infrastructure/` definidos en arquitectura.

## Reglas de verificación comunes

- Ejecutar las pruebas de la tarea al terminarla; no posponerlas hasta T5.
- Usar pruebas unitarias para dominio/aplicación, base `core_test` para persistencia y HTTP real de core para su integración. Mobile usa HTTP/almacenamiento controlados en sus pruebas locales.
- En mobile, mantener bajo prueba el caso de uso o adaptador real. Sustituir únicamente sus dependencias externas; no sustituir la propia operación que se pretende verificar.
- Incorporar tests y contratos mínimos en la misma tarea que los utiliza. Ninguna prueba puede importar archivos que solo se crearán en una tarea posterior.
- Mantener compilables los consumidores existentes en cada entrega. No aceptar casts, handlers provisionales, métodos sin implementar, tests omitidos ni una suite sin casos descubiertos para simular una tarea completa.
- Los contratos de dependencias se declaran en application antes de conectar sus adaptadores, dentro de la misma tarea. No introducir ciclos entre users y companies.
- Los cambios de esquema usan migraciones generadas por Prisma CLI y revisión de SQL/permisos; no borrar datos para hacer pasar una prueba.
- Conservar los cambios ajenos y documentar comandos ejecutados y resultados. Un bloqueo de entorno debe declararse; no equivale a una prueba aprobada.

Los comandos siguientes se ejecutan desde el directorio indicado. `apps/core/scripts/run-tests.sh` prepara PostgreSQL aislado y permisos antes de integración/regresión web. Requiere Docker y `psql`; la regresión web también requiere Chromium de Playwright. La instalación sigue README: dependencias de shared antes de las apps.

## T1. Unificar contexto autenticado y contratos de core/web

**Objetivo:** entregar la resolución tipada de usuario/empresa y los contratos JSON, utilizables con las sesiones por cookie que ya existen.

**Dependencia:** ninguna tarea nueva; parte del código actual.

### Alcance

- Incorporar Zod como dependencia runtime donde se importe y actualizar los lockfiles correspondientes.
- Crear schemas compartidos de acceso actual, creación de empresa y errores propios; inferir DTO con `z.infer` y validar coherencia de IDs y país.
- Definir `AccessUser`, `UserAccess`, `ReadyAccess`, `loadUserAccess`, `requireCompany` y las capacidades mínimas de persistencia.
- Adaptar `createCompanyForUser` a entrada explícita y `Result`, incluyendo todos sus consumidores actuales y tests. Conservar transacción, rollback y recuperación de carreras.
- Cargar el contexto una vez por petición autenticada por cookie; publicar locals tipados y mantener el aislamiento tenant.
- Incorporar `GET /api/me` y adaptar `POST /api/company` para usar el contexto y Zod. Las rutas de onboarding admiten empresa pendiente; las de negocio exigen empresa.
- Adaptar el contexto SSR y sus lectores, eliminando la lectura duplicada de país. Mantener redirecciones de registro/login y país.
- Validar con Zod los JSON del flujo web tocado, conservando los adaptadores y límites de aplicación acordados.
- Incorporar las pruebas compartidas, unitarias, de integración y regresión web necesarias, así como su configuración de auth de pruebas.

**Archivos principales:** `shared/contracts/registration.*`; core `features/users/`, `features/companies/`, `src/shared/infrastructure/current-user.ts`, middleware y `src/app.ts`; `app/private-user-context.ts`, middleware/rutas web y formulario/adaptador de autenticación. Tests junto a sus responsables y adaptación de `tenant-isolation.test.mjs`.

### Fuera de alcance

- Emisión o verificación JWT, tabla de claves y plugin Expo.
- Clientes, casos de uso, provider o pantallas nuevas de mobile.
- Cambios en entidades o rutas ajenas al registro y contexto de acceso.
- Reescribir el sistema de sesiones o contraseñas de Better Auth.

### Criterios de aceptación

- [x] Sin sesión, `/api/me` y `/api/company` responden `401`; un fallo de persistencia no se presenta como falta de sesión.
- [x] Con sesión y sin empresa, `/api/me` devuelve `company_required` y `/api/company` permite completar el alta. El acceso a negocio devuelve `409`.
- [x] Con empresa, `/api/me` devuelve `ready` con IDs coherentes y `Cache-Control: no-store`; las rutas privadas reciben `ReadyAccess` dentro del tenant correcto.
- [x] Los handlers reutilizan usuario/empresa del contexto. Las comprobaciones transaccionales de creación siguen consultando el vínculo cuando sea necesario.
- [x] Entrada JSON inválida se rechaza antes del caso de uso; campos extra no permiten elegir otro usuario o tenant. DTO de salida y errores propios cumplen sus schemas.
- [x] Crear una empresa devuelve `201`; repetir la operación devuelve `200` y el mismo ID. Solicitudes concurrentes no crean empresas huérfanas ni vínculos duplicados.
- [x] Un contexto de empresa pendiente no se puede asignar a `ReadyAccess` en las comprobaciones de tipos.
- [x] Registro web, login, recuperación de empresa, país y logout conservan su comportamiento.
- [x] Core y mobile pasan typecheck con los contratos compartidos; mobile continúa siendo ejecutable con su scaffold actual.

### Pruebas para cerrar la tarea

1. Schemas compartidos: variantes válidas, IDs incoherentes, país/UUID inválidos, datos incompletos y campos extra.
2. Casos de uso: usuario ausente, empresa pendiente/lista, datos almacenados inválidos y errores de persistencia.
3. Integración: cookies, contexto, autorización, concurrencia, rollback y aislamiento entre empresas en `core_test`.
4. Regresión web existente, con `BETTER_AUTH_URL` y secreto exclusivos del servidor de pruebas.

**Comandos:** desde `apps/core`, `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, `pnpm exec tsx --test ../../shared/contracts/registration.test.mjs`, `sh scripts/run-tests.sh integration` y `sh scripts/run-tests.sh e2e`; desde `apps/mobile`, `pnpm typecheck`.

**Verificación T1 (2026-09-23):** desde `apps/core`, `pnpm lint` y `pnpm typecheck` pasaron; `pnpm test:unit` descubrió 9/9 casos; los contratos compartidos pasaron 2/2. `CORE_TEST_PORT=55435 sh scripts/run-tests.sh integration` pasó 2/2 y `CORE_TEST_PORT=55435 sh scripts/run-tests.sh e2e` pasó 7/7 con `BETTER_AUTH_URL` y secreto de pruebas exclusivos. Desde `apps/mobile`, `pnpm typecheck` pasó. El puerto predeterminado 55433 estaba ocupado por otra base de pruebas, por lo que los scripts admiten `CORE_TEST_PORT`.

**Por qué se cierra por sí sola:** los consumidores actuales web/API ya utilizan el contexto y los contratos. No requiere tokens ni código mobile nuevo para demostrar el resultado.

## T2. Habilitar JWT revocables para la API

**Objetivo:** entregar autenticación por JWT completa en core, desde emisión hasta rechazo después de revocación.

**Dependencia:** T1 terminada.

### Alcance

- Incorporar dependencias de core para plugin Expo y verificación JWT, con versiones compatibles y dependencias directas cuando se importen.
- Añadir el modelo de claves requerido por el plugin, generar/revisar la migración y actualizar permisos y comprobación de no propiedad de `core_app`.
- Configurar Better Auth para sesión renovable de 30 días, actualización cada 24 horas, JWT de 15 minutos y acceso sin verificación de correo.
- Configurar emisor, audiencia `yoyos-core-api`, orígenes permitidos y payload mínimo con `sub`/`sid`.
- Implementar verificación criptográfica, parseo Zod de claims y comprobación de sesión vigente perteneciente al usuario en cada petición.
- Extender el middleware de T1 para aceptar JWT o cookie con prioridad explícita de `Authorization`.
- Reutilizar el contexto y las rutas de T1 para ambos mecanismos, sin otra carga de usuario/empresa en handlers.
- Probar registro/login, obtención de JWT y uso de la API directamente desde tests HTTP de core; todavía no se necesita cliente mobile.

**Archivos principales:** core `prisma/schema.prisma`, migración generada, `scripts/provision-role.sql`, `src/shared/infrastructure/auth.ts`, verificador y middleware; configuración de pruebas y `.env.example` cuando corresponda.

### Fuera de alcance

- Cliente o pantallas mobile.
- Refresh tokens independientes, OAuth, correo, recuperación de contraseña o integridad de la app.
- Despliegue, publicación o migración de una base de producción.
- Cambiar RLS o reemplazar la fuente autoritativa de `companyId`.

### Criterios de aceptación

- [x] La migración aplica en la base destinada a desarrollo/pruebas sin resetear datos; `core_app` puede operar las claves sin obtener propiedad, privilegios administrativos o bypass de RLS.
- [x] Una sesión válida obtiene JWT con los claims acordados, incluso con `emailVerified: false`. La credencial de sesión y las claves privadas no aparecen en el JWT ni en DTO de negocio.
- [x] El mismo `/api/me` y `/api/company` funcionan con cookie o JWT y producen los mismos contratos de acceso.
- [x] JWT vencido, manipulado, de algoritmo/emisor/audiencia inválidos o con `sid` ajeno se rechaza con `401`.
- [x] Si existe `Authorization` inválido, no se acepta una cookie válida como fallback.
- [x] Una revocación confirmada hace que la siguiente petición con el JWT anterior falle, aunque el JWT no haya vencido.
- [x] Un error al consultar sesión o claves se distingue de credenciales inválidas y mantiene diagnóstico interno sin secretos.
- [x] La sesión extiende su vencimiento mediante el flujo Better Auth cuando corresponde; validar JWT por sí solo no pretende renovar la cookie.
- [x] Las pruebas de cookies, empresas, aislamiento y regresión web de T1 siguen pasando.

### Pruebas para cerrar la tarea

1. Unitarias del mapeo de claims/errores y selección de credencial.
2. Integración HTTP con Better Auth y base real de pruebas: alta/login → emisión de JWT → acceso → revocación → rechazo.
3. Expiración y renovación de sesión con tiempo/fechas controladas en el entorno de prueba, sin esperar días ni modificar las políticas de producción para probarlas.
4. Permisos de la nueva tabla y regresión web.

**Comandos:** desde `apps/core`, `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, `sh scripts/run-tests.sh integration` y `sh scripts/run-tests.sh e2e`. Generación/aplicación de migración según la skill del repo; no crear SQL con timestamps manuales.

**Verificación T2 (2026-09-23):** migración `20260924034857_add_jwks` generada por Prisma y aplicada en `core_test` sin reset; la prueba HTTP comprueba permisos de `core_app`, emisión, claims, cookies/JWT, empresa pendiente/lista, rechazo y revocación. `pnpm lint`, `pnpm typecheck` y `pnpm test:unit` pasaron (10/10); `CORE_TEST_PORT=55435 sh scripts/run-tests.sh integration` pasó (3/3) y `CORE_TEST_PORT=55435 sh scripts/run-tests.sh e2e` pasó (7/7). Puerto 55435 usado porque 55433 estaba ocupado.

**Por qué se cierra por sí sola:** los tests HTTP producen y consumen credenciales reales de core. No necesitan ninguna tarea de mobile para verificar el soporte JWT.

## T3. Implementar sesión y transporte autenticado mobile

**Objetivo:** entregar operaciones de login, restauración y logout utilizables desde código, con transporte autenticado y renovación comprobados.

**Dependencia:** T2 terminada; utiliza los contratos compartidos de T1.

### Alcance

- Instalar las dependencias mobile necesarias para Better Auth/Expo, SecureStore, Network y schemas, verificando compatibilidad con SDK 57 y actualizando lockfiles.
- Añadir `EXPO_PUBLIC_CORE_URL` validada, con `http://localhost:3000` en el ejemplo de desarrollo; configurar scheme y excepciones HTTP solo de desarrollo.
- Crear clientes compartidos en `src/shared/infrastructure/`; JWT en memoria y sesión persistente en almacenamiento seguro.
- Definir en esta tarea los tipos locales de acceso, errores y capacidades que requieren login/restauración/logout. No esperar que una tarea futura declare sus dependencias.
- Implementar adaptadores reales de auth y `/api/me`, validación Zod y traducción de errores.
- Implementar `signIn`, `restoreSession` y `signOut` con sus dependencias tipadas; conectar una composición invocable desde pruebas y reutilizable después por la UI.
- Centralizar renovación compartida, reintento acotado tras `401`, consulta de sesión para extender vencimiento y cancelación lógica por generación de sesión.
- Completar logout con intento de revocación acotado a 5 segundos, limpieza local incluso sin conexión y tratamiento explícito del fallo al borrar almacenamiento.
- Impedir que respuestas o escrituras tardías del SDK restauren credenciales después de logout o cambio de cuenta.

**Archivos principales:** mobile `src/shared/infrastructure/`, `src/shared/application/transport-error.ts`, `features/users/application/` para acceso y sesión, `features/users/infrastructure/auth-adapter.ts` y `access-api.ts`; configuración y tests locales.

### Fuera de alcance

- Registro de nuevas cuentas y creación remota de empresa desde mobile.
- Provider de UI, navegación y pantallas.
- Guardar JWT en almacenamiento persistente o crear un refresh token propio.
- Servicios de renovación en segundo plano y conexión a un dispositivo como requisito de aceptación.

### Criterios de aceptación

- [ ] `signIn` utiliza el adaptador real y devuelve `UserAccess` listo o pendiente de empresa; contraseña incorrecta produce el error tipado correspondiente.
- [ ] `restoreSession` devuelve acceso válido o `ok(null)` ante ausencia/expiración confirmada. Fallo de red o JSON incompatible no borra la sesión ni se convierte en ausencia.
- [ ] Varias solicitudes simultáneas comparten una renovación y utilizan su resultado; no hay ciclos infinitos ni tormenta de renovaciones por respuestas tardías.
- [ ] Cada solicitud repite como máximo una vez tras `401`; no se reintentan mutaciones por timeout o `5xx`.
- [ ] La renovación consulta la sesión por Better Auth y persiste sus actualizaciones antes de continuar con acceso renovado.
- [ ] Logout sin conexión elimina sesión local, JWT y datos privados en memoria; la revocación remota queda distinguida como no confirmada.
- [ ] Logout invalida operaciones antiguas: ninguna respuesta ni escritura tardía vuelve a habilitar acceso o mezcla datos de cuentas distintas.
- [ ] Si falla la eliminación en SecureStore, se devuelve `SECURE_STORAGE_ERROR`, no éxito; la restauración automática queda bloqueada en ese proceso hasta resolverlo.
- [ ] Tokens y credenciales no se entregan a los casos de uso/pantallas ni se escriben en logs.
- [ ] Los módulos importan y se componen sin depender de archivos de registro o UI que todavía no existen. La navegación actual del scaffold se conserva.

### Pruebas para cerrar la tarea

1. Jest para casos de uso con capacidades controladas, verificando sus salidas y efectos relevantes.
2. Pruebas de adaptadores y cliente HTTP reales con HTTP, reloj y almacenamiento controlados: retorno del SDK, JSON válido/inválido, cookies persistidas, JWT, renovación y errores.
3. Pruebas de carreras: logout durante renovación, respuesta de otra cuenta y escritura tardía del SDK. Controlar las promesas para reproducir el orden sin sleeps arbitrarios.
4. Comprobación de composición que conecte operaciones con adaptadores reales sobre esos límites controlados, sin sustituir la operación bajo prueba.

**Comandos:** desde `apps/mobile`, `pnpm lint`, `pnpm typecheck` y `pnpm test`. Confirmar resolución de los paquetes compartidos en la configuración existente; cualquier ajuste imprescindible forma parte de esta tarea.

**Por qué se cierra por sí sola:** login, restauración y logout tienen API de aplicación y pruebas completas. Una pantalla futura solo consumirá esas operaciones; no aporta piezas necesarias para validarlas.

## T4. Implementar registro recuperable y creación de empresa mobile

**Objetivo:** entregar el registro completo y su recuperación como operaciones de aplicación probadas, reutilizando la sesión y transporte terminados.

**Dependencia:** T3 terminada.

### Alcance

- Completar el adaptador de auth con alta de cuenta y validación Zod de los datos consumidos del SDK.
- Implementar `companies.createCompany` y su adaptador HTTP, incluyendo `CompanyDraft`, errores y export público mínimo.
- Implementar `users.register` y `users.completeCompany`, entradas y errores discriminados de recuperación.
- Validar todos los campos antes de iniciar efectos. Usar nombre/país conforme al contrato; core genera el ID de empresa.
- Componer el flujo cuenta → acceso → empresa si falta → recarga de acceso. Recuperar usando las operaciones de T3 sin duplicar infraestructura.
- Distinguir interrupciones en cuenta, acceso, empresa y recarga; tratar resultados inciertos de red sin repetir automáticamente el alta.
- Probar las operaciones conectadas a los adaptadores de T3/T4 sobre HTTP controlado, además de las reglas con dependencias suministradas.

**Archivos principales:** mobile `features/users/application/register.ts`, `complete-company.ts` y contratos; `users/infrastructure/auth-adapter.ts`; `features/companies/application/create-company.ts`, `infrastructure/company-api.ts`, exports y tests.

### Fuera de alcance

- Pantallas, provider y navegación.
- Cambiar la atomicidad o los endpoints de core ya entregados.
- Usar `generateCompany` como persistencia remota, generar IDs locales de empresa o guardar borradores de empresa.
- Correo de verificación, invitaciones, múltiples empresas o registro offline.

### Criterios de aceptación

- [ ] Entrada inválida impide crear la cuenta y enviar solicitudes de empresa; las capacidades no reciben objetos JSON sin validar.
- [ ] Registro exitoso devuelve `ReadyAccess` después de vincular empresa y recargar `/me`.
- [ ] Si la cuenta ya tiene empresa al resolver acceso, el flujo utiliza esa empresa y no intenta crear otra.
- [ ] Si el alta funciona y falla la empresa, se devuelve `REGISTRATION_INTERRUPTED` con `step`, `recovery` y `cause` correspondientes; el acceso persistido sigue disponible.
- [ ] Recuperar desde empresa pendiente invoca `completeCompany`, no el alta de cuenta otra vez.
- [ ] Si se pierde una respuesta, el flujo permite consultar el estado actual antes de decidir la recuperación; no declara que una escritura falló solo por un timeout.
- [ ] Si la creación devuelve éxito pero la recarga falla, la recuperación es recargar acceso. Si la recarga devuelve un estado incoherente, se informa `INVALID_RESPONSE` y no se inventa un acceso listo.
- [ ] `createCompany` acepta el contrato existente para `200` y `201`, valida su respuesta e ignora cualquier ID no autoritativo del formulario.
- [ ] Types, errores y dependencias no crean imports circulares; companies no importa internals de users.
- [ ] Los tests de login, restauración, renovación y logout de T3 siguen pasando.

### Pruebas para cerrar la tarea

1. Matriz de casos de uso: éxito, validación previa, email duplicado, fallo de alta, fallo de acceso, fallo de empresa y fallo de recarga.
2. Recuperación por empresa existente, empresa pendiente y resultado incierto, comprobando que no se repite el alta.
3. Adaptadores reales con respuestas controladas según los schemas de core, incluidos errores de formato y protocolo.

**Comandos:** desde `apps/mobile`, `pnpm lint`, `pnpm typecheck` y `pnpm test`. Si cambia un contrato compartido, también ejecutar sus pruebas y el typecheck de core en esta misma tarea; no diferir compatibilidad a T5.

**Por qué se cierra por sí sola:** el registro y la recuperación pueden ejecutarse y verificarse directamente por sus funciones compuestas. La UI no decide su secuencia de negocio.

## T5. Integrar formularios, estado de acceso y navegación mobile

**Objetivo:** conectar las operaciones completas a la app, con formularios accesibles y navegación basada en el estado de acceso.

**Dependencia:** T4 terminada; consume sesión de T3 y contratos de T1.

### Alcance

- Implementar provider con `AccessState`: comprobación, sin sesión, empresa pendiente, listo y error recuperable.
- Conectar la composición existente a las pantallas de login, registro y empresa pendiente, dentro de `features/users/presentation/`.
- Adaptar `src/app/_layout.tsx` y rutas para delegar UI a las features y reservar navegación privada a estado `ready`.
- Reutilizar `Field`, `Input` y las primitivas/estilos disponibles, con etiquetas accesibles, validación y bloqueo de envíos duplicados.
- Mantener errores/envío del formulario separados del estado global de acceso. Traducir códigos y pasos a acciones y mensajes de UI.
- Solicitar país explícitamente; conservar borrador de empresa solo en memoria y volver a pedir nombre/país tras reabrir con empresa pendiente.
- Conectar logout, limpieza de datos y estados de fallo sin exponer credenciales en el provider o las pantallas.
- Actualizar README y pendientes documentales para reflejar solo funcionalidades realmente terminadas.

**Archivos principales:** mobile `features/users/presentation/`, `src/app/` y pruebas de presentación/provider; README y documentos del registro.

### Fuera de alcance

- Reimplementar el registro o la renovación dentro de hooks/pantallas.
- Rediseño de la app completa o features privadas nuevas.
- Publicación, despliegue, configuración de tiendas o infraestructura E2E mobile.
- Convertir la comprobación final en una tarea futura separada.

### Criterios de aceptación

- [ ] Durante restauración no se muestran pantallas ni datos privados. Una ausencia confirmada muestra login/registro; un fallo de red ofrece reintento sin borrar la sesión.
- [ ] `company_required` muestra únicamente el paso de empresa; `ready` habilita la app privada. Cambios de estado actualizan la navegación y evitan volver a una pantalla privada tras logout.
- [ ] Registro solicita nombre, correo, contraseña, empresa y país. Empresa pendiente solicita solo nombre de empresa/país y no vuelve a pedir alta de cuenta.
- [ ] Los campos tienen etiquetas accesibles, el país no está preseleccionado y enviar repetidamente no duplica la operación.
- [ ] Un fallo parcial muestra la recuperación correspondiente; la pantalla invoca los casos de uso ya probados y no reconstruye el flujo de negocio.
- [ ] Al recrear provider/formulario con sesión de empresa pendiente se piden nombre y país otra vez; ningún borrador persistido aparece como fuente de esos campos.
- [ ] Logout sin conexión vuelve al acceso público después de limpieza local; si el borrado seguro falla, no se anuncia éxito y se ofrece reintentar la limpieza.
- [ ] Ni provider ni pantallas guardan JWT, cookies o contraseñas fuera del estado mínimo del formulario que las necesita.
- [ ] Las pruebas de T3/T4 y las nuevas pruebas de UI pasan sin depender de un servidor core o dispositivo real.
- [ ] Documentación y comandos reflejan el código final; las verificaciones afectadas de core/shared siguen exitosas y no hay pendientes de integración necesarios para usar las operaciones.

### Pruebas para cerrar la tarea

1. Provider y navegación con operaciones controladas: todos los estados, reintento, reapertura y logout durante solicitudes pendientes.
2. Formularios con Testing Library existente: campos inválidos, envío único, país, errores y recuperación sin duplicar cuenta.
3. Comprobación de composición: pantallas/providers reciben las operaciones reales configuradas, con los límites externos controlados; no solo una pantalla aislada que siempre recibe éxito.
4. Regresión de pruebas de aplicación/transporte de T3/T4. Revisar la evidencia vigente de core/shared; repetir sus suites si esta tarea cambia esos componentes o contratos.

**Comandos:** desde `apps/mobile`, `pnpm lint`, `pnpm typecheck` y `pnpm test`; desde core, verificaciones de contratos/regresión que correspondan a cambios reales de esta tarea. No marcar pruebas sin ejecutar como aprobadas.

**Por qué se cierra por sí sola:** integra exclusivamente capacidades ya terminadas y entrega el flujo de UI completo. Incluye su verificación y documentación, sin una tarea posterior de conexión o reparación.

## Cobertura de implementación

| Área | Tarea que la entrega |
| --- | --- |
| Preparación de herramientas/dependencias | Cada tarea incorpora solo lo que necesita; T1 registra la referencia inicial |
| Contratos, contexto y empresa core | T1 |
| Migración, permisos, emisión y verificación JWT | T2 |
| Middleware y endpoints | T1 para cookies/contexto; T2 amplía a JWT |
| Compatibilidad web | T1 y regresión en T2 |
| Clientes, adaptadores y sesión mobile | T3 |
| Registro y empresa mobile | T4 |
| Provider, formularios y rutas | T5 |
| Verificación final | Criterios de cierre de cada tarea; T5 comprueba la integración final de UI |

## Definición de tarea terminada

Una tarea se completa cuando su entregable funciona con el código actual más sus predecesoras, cumple todos sus criterios de aceptación, tiene pruebas descubiertas y ejecutadas con resultado exitoso, mantiene compatibles a sus consumidores existentes y deja registrados los cambios y verificaciones. Una limitación que impide verificar un criterio mantiene ese criterio pendiente; no se traslada silenciosamente a la siguiente tarea.
