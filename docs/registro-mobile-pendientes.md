# Registro y autenticación mobile: arquitectura y pendientes

## Objetivo y alcance

Permitir registro público, inicio y cierre de sesión desde mobile con las mismas cuentas y empresas de core. Web seguirá usando cookies de sesión de Better Auth; mobile usará JWT para las rutas de negocio `/api`.

**Estado:** decisiones de comportamiento, organización de casos de uso, contratos principales y cobertura de verificación acordadas. T1–T4 están implementadas y verificadas; la integración de pantallas mobile sigue pendiente. Este documento define la arquitectura que implementarán las tareas; los detalles técnicos propuestos se validarán contra las versiones y entornos reales.

Incluye recuperar registros con empresa pendiente y compartir usuario y empresa entre middleware y rutas privadas. La comprobación de integridad de la app, OAuth y recuperación de contraseña quedan fuera de esta etapa propuesta.

**Acceso inmediato confirmado:** el usuario puede continuar tras registrarse sin verificar su correo, porque todavía no existe integración de envío de emails. No exigir `emailVerified` para iniciar sesión, emitir JWT, crear empresa o acceder a rutas privadas. El acceso a negocio sigue requiriendo una empresa. No marcar el correo como verificado sin haberlo comprobado ni añadir envíos de correo en esta etapa.

## Estado actual comprobado

- Core registra usuarios con email y contraseña mediante Better Auth y Prisma.
- `resolveCurrentUser` valida la sesión y consulta `{ id, name, companyId }` en la base de datos.
- `POST /api/company` autentica por su cuenta. Crea y vincula la empresa en una transacción; devuelve la empresa existente ante reintentos y resuelve carreras entre solicitudes.
- El middleware general de `/api` exige usuario y empresa, y ejecuta las rutas siguientes dentro de `withTenantIsolation(companyId, next)`. No expone los datos del usuario o empresa al handler.
- La web tiene otro middleware en `private-layout.tsx`: valida sesión, obtiene el país de la empresa dentro del contexto tenant y publica el usuario mediante `privateUserContext` de React Router.
- Mobile aún muestra el scaffold. Su operación `generateCompany` construye datos en memoria; no registra empresas en core.

## Decisiones de arquitectura

### 1. Dos credenciales, una identidad

| Consumidor | Credencial | Validación |
| --- | --- | --- |
| Web y sus llamadas a `/api` | Cookie de Better Auth | Sesión vigente en core |
| Mobile, rutas de negocio `/api` | `Authorization: Bearer <JWT>` | Firma, claims y sesión asociada vigentes |
| Mobile, `/api/auth/*` | Sesión gestionada por el cliente de Better Auth | Better Auth; permite emitir nuevos JWT y cerrar sesión |

No habrá tablas de cuentas separadas ni un segundo sistema de contraseñas. El plugin JWT emite tokens adicionales a la sesión de Better Auth; no la reemplaza. El cliente Expo puede conservar esa sesión con su integración de almacenamiento seguro. Véanse [JWT](https://better-auth.com/docs/plugins/jwt) e [integración Expo](https://better-auth.com/docs/integrations/expo).

La selección de credencial en `/api` será determinista: si existe `Authorization`, debe contener un JWT Bearer válido. Una cabecera inválida devuelve `401`, aunque también exista una cookie válida. Solo cuando no hay `Authorization` se consulta la cookie. El middleware web SSR sigue autenticando por cookie.

### 2. Contexto autenticado por petición

Sí se inyectarán `user` y `company` para evitar consultas repetidas desde las rutas. El contexto será la unión discriminada `UserAccess` definida en los contratos de abajo: `company_required` o `ready`. Ambos estados incluyen usuario; solo `ready` incluye empresa. Los objetos se exponen como datos de solo lectura.

En Express se publicará como `res.locals.auth`, tipando los locals de los handlers. Es un mecanismo nativo con duración de una petición; no requiere un contenedor de inyección ni variables globales. En SSR se conservará el mecanismo de contexto de React Router y se ampliará el contexto privado existente para ofrecer esos mismos datos. [Referencia de Express](https://expressjs.com/en/5x/api.html#res.locals).

La resolución seguirá este orden:

1. Validar la credencial y obtener la identidad del usuario.
2. Consultar el usuario actual en core. `companyId` siempre sale de este registro, nunca del body, headers personalizados o claims del cliente.
3. Si tiene empresa, entrar en `withTenantIsolation(user.companyId, ...)`, cargar una vez `{ id, name, country }` mediante el repositorio de empresas y ejecutar dentro de ese ámbito el resto de la petición.
4. Publicar el contexto. Si no tiene empresa, publicar `company: null`; las rutas de onboarding lo admiten.
5. Antes de las rutas de negocio, exigir empresa y exponer un contrato privado donde `company` y `user.companyId` ya no sean nulos. Rechazar con `409` al usuario pendiente.

El handler toma `user` y `company` del contexto y pasa únicamente los datos necesarios al caso de uso. Los casos de uso no reciben `Request`, `Response`, `res.locals` ni contexto de React Router. El mecanismo actual de aislamiento tenant conserva su responsabilidad sobre las consultas a la base de datos.

Esto evita volver a resolver identidad y empresa dentro de una misma petición; no elimina las consultas iniciales ni las consultas de negocio. El contexto es una instantánea, no una caché entre peticiones. Una operación que modifica datos devuelve su resultado actualizado; las comprobaciones transaccionales necesarias siguen consultando la base de datos. En particular, `createCompanyForUser` conserva sus controles de concurrencia.

Si `companyId` existe pero la empresa no puede cargarse o su país es inválido, se bloquea el acceso y se registra el fallo como error del servidor. No se trata como una cuenta pendiente ni se crea otra empresa.

### 3. Orden del middleware y contratos HTTP

**Orden aprobado:** Better Auth gestiona `/api/auth/*` antes del middleware privado. Las demás rutas `/api` autentican y cargan `UserAccess`; `/me` y `/company` admiten empresa pendiente. Las rutas de negocio pasan además por `requireCompany`, reciben `ReadyAccess` y se ejecutan dentro del aislamiento tenant.

```text
/api/auth/* → handler de Better Auth
/api        → JSON → autenticación cookie/JWT → contexto user/company
               ├─ GET /me
               ├─ POST /company
               └─ exigir company → rutas privadas de negocio
```

`/api/auth/*` debe continuar antes del middleware privado: registro, login y claves públicas tienen reglas propias. `GET /api/me` y `POST /api/company` necesitan autenticación, pero deben funcionar sin empresa.

| Ruta | Resultado |
| --- | --- |
| `GET /api/me` (nueva) | `200 CurrentAccessDto` con discriminante `status`, usuario y empresa; `401` sin credencial válida |
| `POST /api/company` (existente) | Body `{ name, country }`; `201 { companyId }` si crea, `200 { companyId }` si ya estaba vinculada; `400` por datos inválidos |
| Rutas privadas de negocio | `401` sin identidad válida; `409` si falta empresa; ejecución bajo aislamiento tenant |

`GET /api/me` devuelve una proyección explícita del contexto con `Cache-Control: no-store`; no serializa sesiones, tokens ni objetos internos de Better Auth. Los errores de rutas propias conservarán `error: string` y añadirán `code` estable para mobile, según el contrato tipado de abajo; los consumidores web actuales pueden ignorar el nuevo campo. Fallos de base de datos o infraestructura producen errores de servidor, no falsos `401`.

### 4. Emisión, renovación y cierre de sesión

**Requisito confirmado:** mantener la sesión abierta mientras el usuario siga usando la app, renovando el acceso sin pedir la contraseña de nuevo. Se ha aprobado reutilizar la sesión de Better Auth como credencial de renovación para conseguir ese comportamiento.

**Mecanismo aprobado:** reutilizar la credencial persistente de sesión de Better Auth para obtener nuevos JWT. Cumple la función de credencial de renovación, pero no es un refresh token OAuth ni implica rotación de tokens con detección de reutilización. El plugin JWT no proporciona por sí solo un flujo OAuth de `access_token`/`refresh_token`. No se añadirá un flujo de refresh tokens independiente.

Better Auth permite vencimiento deslizante mediante `session.expiresIn` y `session.updateAge`: al usar una sesión después del intervalo de actualización, extiende su vencimiento. Plazo confirmado: ventana renovable de 30 días, sin un vencimiento absoluto adicional por antigüedad mientras haya uso. Detalle técnico propuesto: actualizar el vencimiento como máximo una vez cada 24 horas. Esto define una ventana renovable; no un contador exacto de 30 días desde cada interacción. Véase [gestión de sesiones](https://better-auth.com/docs/concepts/session-management).

Detalles operativos propuestos para el mecanismo aprobado:

- Habilitar los plugins Expo y JWT en core y sus clientes correspondientes en mobile. Usar `expo-secure-store` para persistir la sesión; mantener el JWT de acceso solo en memoria.
- Obtener el JWT mediante el cliente Better Auth (`/api/auth/token`). Añadir la tabla de claves que requiere el plugin al esquema Prisma mediante una migración generada y revisada.
- Fijar una duración de JWT de 15 minutos, un emisor canónico de core y una audiencia explícita para su API. Limitar el payload a identidad y vínculo de sesión: `sub`, `sid`, `iss`, `aud`, `iat`, `exp`. `sid` representa el ID de sesión, nunca su token secreto. No incorporar empresa ni datos personales al payload.
- **Revocación aprobada:** core verifica firma, algoritmo permitido, emisor, audiencia, expiración y forma de los claims con un verificador mantenido compatible con JWKS. En cada petición consulta que `sid` corresponde a una sesión vigente del usuario `sub`. No usar una caché de vigencia entre peticiones que retrase la revocación. Una vez confirmada la revocación en el servidor, las peticiones siguientes con sus JWT se rechazan aunque no hayan vencido; no se garantiza cancelar operaciones que ya fueron autenticadas y están en ejecución. Esta comprobación adicional pertenece a nuestra API, no es revocación automática del plugin JWT. El cierre sin conexión permanece local.
- Usar las claves públicas de core desde una ubicación fija y confiable; nunca elegir el emisor o la URL de claves a partir de un token no validado. Reutilizar el verificador y su caché de claves, conservando soporte para rotación. Las claves privadas permanecen en core.
- Al abrir o reanudar la app y antes de renovar el JWT, consultar la sesión en el servidor mediante el cliente Better Auth, permitiendo actualizar su vencimiento y persistir las cookies devueltas. Después obtener un JWT cuando no exista o esté próximo a vencer. Antes de una llamada, renovar si quedan menos de 60 segundos; compartir una renovación en curso entre solicitudes simultáneas. Leer `Session` desde el middleware JWT no renueva por sí solo la sesión ni su cookie.
- Renovar como consecuencia del uso de la app en primer plano que requiere acceso al servidor. No mantener la sesión viva con tareas periódicas en segundo plano ni tratar una sesión local cacheada como prueba de vigencia. Si la app permanece desconectada hasta vencer la credencial de renovación, será necesario iniciar sesión otra vez.
- Ante `401`, intentar una sola renovación y, si funciona, repetir una sola vez la solicitud rechazada antes de ejecutar negocio. No reintentar automáticamente mutaciones ante timeout o `5xx`. No crear otro endpoint de refresh ni una segunda credencial persistente.
- Una sesión vencida o revocada lleva al login y limpia el acceso local. Un fallo de conexión mantiene la sesión guardada y ofrece reintentar; no equivale a logout.
- **Cierre de sesión aprobado:** permitir salir del dispositivo incluso sin conexión. Eliminar JWT, sesión de Better Auth del almacenamiento seguro y datos privados en memoria; volver al login. Borrar solo el JWT no basta porque la sesión persistida permitiría emitir otro. Con conexión, intentar revocar la sesión en Better Auth antes de eliminar la credencial local; un fallo de red no bloquea la salida local. Si la revocación no se confirma, no afirmar que la sesión remota fue invalidada: puede seguir vigente hasta su vencimiento o revocación posterior. No conservar credenciales para reintentar en segundo plano. El chequeo de `sid` rechaza JWT asociados a sesiones efectivamente revocadas.
- Al iniciar el cierre, impedir nuevas renovaciones y descartar resultados de solicitudes en curso para que no restauren credenciales ni datos privados después de salir.

Los detalles del plugin JWT —emisión, claims configurables y almacenamiento de claves— se basan en su [documentación oficial](https://better-auth.com/docs/plugins/jwt). La validación de compatibilidad con las versiones instaladas forma parte de la implementación.

### 5. Flujo mobile y recuperación

1. El formulario pide nombre, correo, contraseña, nombre de empresa y país. El país se selecciona explícitamente de `shared/country.ts`; nombre de empresa recortado de 1 a 120 caracteres. La contraseña respeta las restricciones de Better Auth y no se transforma ni persiste en la app.
2. Registrar con Better Auth y conservar la sesión mediante su cliente. Obtener el JWT.
3. Consultar `GET /api/me`. Si falta empresa, enviar `{ name, country }` a `POST /api/company`; el servidor genera el ID.
4. Tras crear empresa, consultar de nuevo `/api/me` para obtener el contexto actualizado y entrar a la app.
5. **Recuperación aprobada:** si falla la creación de empresa, conservar el estado autenticado y mostrar el paso pendiente. Reintentar solo la creación, sin registrar otra cuenta. Durante esa pantalla se conservan nombre y país en memoria; al volver a abrir la app con empresa pendiente, pedir nuevamente nombre de empresa y país. No persistir un borrador local de esos campos.
6. Login y restauración de sesión también consultan `/api/me`: `company: null` conduce al onboarding y una empresa válida a la app.

Si se pierde la respuesta del registro, primero intentar recuperar la sesión. Si no puede recuperarse, ofrecer login con las credenciales elegidas; no repetir el registro automáticamente. Si se pierde la respuesta de creación de empresa, consultar `/api/me` o reintentar el endpoint idempotente existente.

Estados de presentación: comprobando sesión, sin sesión, autenticado con empresa pendiente, listo y error recuperable. No mostrar pantallas privadas durante la comprobación inicial. Los errores de correo duplicado, credenciales incorrectas, validación y red deben ser comprensibles; los códigos del servidor se traducen en presentación. Los formularios tendrán etiquetas accesibles y bloquearán envíos duplicados.

## Contratos y casos de uso propuestos

Esta sección concreta las decisiones de arquitectura acordadas. Los contratos de core/web correspondientes a T1 ya están implementados; los de JWT y mobile siguen previstos. Aplica [programming-style.md](programming-style.md): datos planos, `strict`, dependencias explícitas y `Result<T, E>` para operaciones que pueden fallar. Reutilizar `ok` y `err` de `@shared/functional`.

### A. Propiedad de los datos y límites

| Dato | Dueño y representación | Exposición |
| --- | --- | --- |
| `User` | Entidad existente en core `features/users/domain/user.ts` | Proyectar solo `id`, `name`, `companyId` para el contexto |
| `Company` | Entidad existente en cada app: `id`, `name`, `country: Country` | Proyección explícita de esos tres campos |
| Credenciales, `Session`, `Account`, `Verification` | Better Auth y su adaptador Prisma | No exportar modelos Prisma, hashes ni tokens de sesión a DTO de negocio |
| Claves JWT | Plugin JWT y almacenamiento de core | Solo claves públicas por JWKS; la clave privada nunca llega a mobile |
| JWT de acceso | Transporte mobile, solo en memoria | No forma parte del estado de pantallas ni del usuario de dominio |
| Sesión persistente | Cliente Better Auth y SecureStore | Accesible solo al adaptador de autenticación |
| Formulario de registro | Presentación mobile | Contraseña solo durante el envío; borrador de empresa solo en memoria |

Los IDs de usuario y sesión son strings opacos no vacíos; no se presupone que sean UUID. El ID de empresa sí debe validar el UUID utilizado por la base de datos. Mantener `string` en las entidades actuales; un alias de string no garantiza identidad ni validez. La relación `user.companyId === company.id` se valida al construir el contexto y al recibir el DTO, porque TypeScript no demuestra igualdad entre dos valores string.

La única ampliación de persistencia prevista es el modelo de claves del plugin JWT: `id`, `publicKey`, `privateKey`, `createdAt` y `expiresAt` opcional, con los tipos y mapeos exigidos por la versión instalada. Conservar la protección de clave privada del plugin. `Session.expiresAt` sigue siendo la autoridad para la ventana de sesión; no duplicarla en una tabla mobile. Las fechas permanecen como `Date` en persistencia y no se incluyen en el DTO de acceso.

No ampliar `User` con JWT, estado de formulario o flags de navegación. No usar `Account.refreshToken` para renovar los JWT propios de esta app. No agregar tablas de usuarios mobile, borradores, refresh tokens o estados de onboarding: `User.companyId` ya representa el registro pendiente.

### B. Contexto de aplicación y DTO compartido

**Contexto aprobado:** `AccessUser` proyecta `id` y `name`; `UserAccess` agrega el vínculo de empresa y distingue `company_required` de `ready`; `ReadyAccess` restringe el acceso privado a la variante con empresa. También está aprobado mantener los contratos HTTP de `/api/me` y `/api/company` en `shared/contracts/registration.ts`, sin modelos Prisma ni credenciales y con validación de respuestas en mobile. El catálogo de códigos siguiente concreta el manejo de errores acordado; su mapeo a Better Auth debe verificarse con la versión instalada.

En core, `features/users/application/user-access.ts` define la proyección local usando las entidades de dominio. `Company` se obtiene por el export público de su feature:

```ts
// Imports de dominio omitidos aquí: User y Company son las entidades existentes.
type AccessUser = Readonly<Pick<User, "id" | "name">>;

type UserAccess =
  | Readonly<{
      status: "company_required";
      user: AccessUser & Readonly<{ companyId: null }>;
      company: null;
    }>
  | Readonly<{
      status: "ready";
      user: AccessUser & Readonly<{ companyId: string }>;
      company: Readonly<Company>;
    }>;

type ReadyAccess = Extract<UserAccess, { status: "ready" }>;
```

El resultado de autenticación no se representa mediante propiedades opcionales: usuario inexistente es `null`; empresa pendiente es una variante válida; fallo de consulta es `Result` fallido. El contexto no contiene la credencial usada para obtenerlo.

**Zod aprobado para comunicación JSON:** los esquemas HTTP compartidos vivirán en `shared/contracts/registration.ts`; sus tipos se inferirán con `z.infer`. Core, mobile y web usarán los mismos esquemas para los contratos propios. No mantener un tipo DTO manual paralelo al esquema. Las entidades de dominio siguen perteneciendo a su app y los contratos no importan modelos Prisma.

```ts
import { z } from "zod";
import { countries } from "@shared/country";

const countrySchema = z.enum(countries);
const accessUserFields = {
  id: z.string().min(1),
  name: z.string(),
};

const companyDtoSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  country: countrySchema,
}).readonly();

const currentAccessDtoSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("company_required"),
    user: z.object({ ...accessUserFields, companyId: z.null() }).readonly(),
    company: z.null(),
  }),
  z.object({
    status: z.literal("ready"),
    user: z.object({ ...accessUserFields, companyId: z.uuid() }).readonly(),
    company: companyDtoSchema,
  }),
]).refine(
  (value) => value.status !== "ready" || value.user.companyId === value.company.id,
  { message: "Company must match the user link", path: ["company", "id"] },
).readonly();

// Forma de transporte; la operación aplica trim y la regla de 1–120 caracteres.
const createCompanyRequestSchema = z.object({
  name: z.string(),
  country: countrySchema,
}).readonly();

const createCompanyResponseSchema = z.object({
  companyId: z.uuid(),
}).readonly();

const apiErrorCodeSchema = z.enum([
  "UNAUTHENTICATED", "COMPANY_REQUIRED", "INVALID_COMPANY", "NOT_FOUND",
  "SERVICE_UNAVAILABLE", "INTERNAL_ERROR",
]);
const apiErrorResponseSchema = z.object({
  error: z.string(),
  code: apiErrorCodeSchema,
}).readonly();

type CompanyDto = z.infer<typeof companyDtoSchema>;
type CurrentAccessDto = z.infer<typeof currentAccessDtoSchema>;
type CreateCompanyRequest = z.infer<typeof createCompanyRequestSchema>;
type CreateCompanyResponse = z.infer<typeof createCompanyResponseSchema>;
type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;
type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;
```

Exportar los esquemas y tipos que consuman ambas apps. Los objetos parseados descartan propiedades no declaradas: un `companyId` o `userId` extra no llega al caso de uso. Se preserva así el comportamiento actual de ignorar el tenant enviado por el cliente. No usar coerción implícita para aceptar tipos JSON incorrectos. Los tipos internos como `UserAccess`, dependencias y errores de aplicación conservan sus contratos propios; no necesitan schemas si no cruzan un límite externo.

El esquema es la fuente del tipo de transporte. El resultado de `safeParse` se traduce a `Result` del repo; no propagar `ZodError` a la capa de aplicación. Referencias: [parseo e inferencia](https://zod.dev/basics), [esquemas y uniones](https://zod.dev/api).

Mobile tendrá su propio `UserAccess` con la misma unión de estados y proyecciones de usuario y `Company`, definido en `features/users/application/user-access.ts`. Su adaptador transforma `CurrentAccessDto` validado al modelo local. No importa tipos desde `apps/core`. Los campos de estos DTO son JSON; no contienen `Date`, funciones, `undefined`, clases ni objetos SDK.

Las respuestas HTTP no se envuelven en `Result`: mantienen los contratos de `/api/company` y `/api/me`. `Result` es el contrato interno de aplicación y adaptadores. El registro/login de Better Auth conserva su protocolo propio; mobile lo traduce en su adaptador.

### C. Casos de uso de core

**Separación de responsabilidades aprobada:** autenticación en infraestructura/Better Auth; `loadUserAccess` en users; `requireCompany` como regla pura; `createCompanyForUser` en companies. El contexto distingue `company_required` y `ready`, las operaciones fallables usan `Result<T, E>` y `/api/me` reutiliza el contexto cargado. Las firmas siguientes concretan esa distribución y se verifican durante la implementación.

La adquisición de identidad por cookie/JWT es infraestructura de seguridad compartida. Registro, validación de contraseña, login, emisión de JWT y revocación permanecen en Better Auth: no crear casos de uso propios que solo reenvíen esos métodos ni endpoints de registro duplicados.

| Operación propia | Entrada | Salida | Responsabilidad |
| --- | --- | --- | --- |
| `loadUserAccess` — users | `{ userId: string }` validado por autenticación | `Promise<Result<UserAccess \| null, AccessLoadError>>` | Leer proyección de usuario y, si corresponde, empresa; construir la variante correcta |
| `requireCompany` — regla de acceso | `UserAccess` | `Result<ReadyAccess, CompanyRequiredError>` | Refinar el tipo antes de negocio; no realiza consultas |
| `createCompanyForUser` — companies, existente | `{ userId, name, country }` | `Promise<Result<CreateCompanyOutcome, CreateCompanyError>>` | Validar y normalizar nombre, comprobar país, crear/vincular atómicamente o devolver vínculo existente |

`GET /api/me` serializa el contexto ya cargado. No necesita otro caso de uso que vuelva a buscar usuario y empresa. `POST /api/company` usa `context.user.id`; no recibe un `userId` del body. No usar el snapshot de contexto como sustituto de la comprobación transaccional del vínculo.

Contratos mínimos de aplicación:

```ts
type AccessLoadError = Readonly<{
  code: "PERSISTENCE_UNAVAILABLE" | "INVALID_STORED_DATA" | "UNEXPECTED_ERROR";
  message: string;
}>;
type CompanyRequiredError = Readonly<{
  code: "COMPANY_REQUIRED";
  message: string;
}>;

type LoadUserAccessDependencies = Readonly<{
  findUser: (userId: string) => Promise<Result<
    Readonly<Pick<User, "id" | "name" | "companyId">> | null, AccessLoadError
  >>;
  findCompany: (companyId: string) => Promise<Result<Readonly<Company> | null, AccessLoadError>>;
}>;

type CreateCompanyInput = Readonly<{
  userId: string;
  name: string;
  country: Country;
}>;
type CreateCompanyOutcome = Readonly<{ companyId: string; created: boolean }>;
type CreateCompanyError = Readonly<{
  code: "INVALID_COMPANY" | "USER_NOT_FOUND" | "PERSISTENCE_UNAVAILABLE"
    | "INVALID_STORED_DATA" | "UNEXPECTED_ERROR";
  message: string;
}>;

type CompanyLink =
  | Readonly<{ status: "user_missing" }>
  | Readonly<{ status: "unlinked" }>
  | Readonly<{ status: "linked"; companyId: string }>;

type CompanyRegistrationRepository = Readonly<{
  findLink: (userId: string) => Promise<Result<CompanyLink, CreateCompanyError>>;
  createAndLink: (input: CreateCompanyInput) => Promise<Result<
    Readonly<{ status: "created"; companyId: string }>
      | Readonly<{ status: "link_changed" }>,
    CreateCompanyError
  >>;
}>;
```

`Result` y `Country` se importan de los módulos shared existentes. Estos contratos pertenecen a los casos de uso; no habrá una interfaz genérica de repositorio. Cada adaptador expone solo los errores que realmente puede producir, como subconjunto del error del caso de uso.

`loadUserAccess` devuelve `ok(null)` solo si el usuario ya no existe. Si existe `companyId` pero no la empresa, o país almacenado inválido, devuelve `INVALID_STORED_DATA`. La composición suministra `findCompany` con `withTenantIsolation(companyId, ...)` alrededor de la lectura; después el middleware mantiene ese mismo tenant alrededor de los handlers. Así la carga inicial y las consultas de negocio respetan RLS sin usar un join global que lo eluda. El usuario y la empresa se cargan una vez por petición.

`createCompanyForUser` mantiene la estrategia actual: vínculo existente → `created: false`; creación y vinculación en una transacción → `created: true`; carrera perdida → rollback de la nueva empresa y lectura del vínculo ganador. `link_changed` representa ese conflicto recuperable. Tras releer, usuario eliminado produce `USER_NOT_FOUND`; vínculo aún ausente produce `INVALID_STORED_DATA`. No convertir errores de base de datos en éxito ni dejar empresas huérfanas.

Este cambio adapta el caso de uso existente a `Result` y a una entrada explícita. Hay que actualizar el handler y los tests que hoy esperan retorno directo o excepción. No migrar por esta tarea repositorios ajenos al registro.

### D. Autenticación, contexto HTTP y SSR

Dentro de infraestructura, la validación de credenciales produce un principal mínimo. Solo el adaptador verificador lo construye tras validar cookie o JWT y vigencia de sesión; una forma TypeScript no demuestra autenticación.

```ts
type AuthenticatedPrincipal = Readonly<{ userId: string; sessionId: string }>;
type VerifiedJwtClaims = Readonly<{
  sub: string;
  sid: string;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
}>;
type AuthenticationError = Readonly<{
  code: "UNAUTHENTICATED" | "AUTH_SERVICE_UNAVAILABLE" | "UNEXPECTED_ERROR";
  message: string;
}>;
```

`iat` y `exp` se expresan en segundos Unix, finitos y válidos; no mezclar con milisegundos. Los claims se aceptan solo después de la verificación criptográfica y del contrato de emisor/audiencia. El adaptador recibe `Headers` en su límite técnico y devuelve `Promise<Result<AuthenticatedPrincipal, AuthenticationError>>`; el caso de uso de users recibe únicamente el `userId` validado. `AUTH_SERVICE_UNAVAILABLE` se mapea a `503 SERVICE_UNAVAILABLE`, nunca a credenciales inválidas.

El middleware llama una vez a `loadUserAccess`, publica su resultado y resuelve fallos antes de ejecutar la ruta. En Express se usarán locals distintos para handlers de onboarding y negocio:

```ts
type AuthenticatedLocals = { auth: UserAccess };
type PrivateLocals = { auth: ReadyAccess };
```

La composición registra primero autenticación, luego onboarding y después `requireCompany` y los handlers privados. Los handlers se tipan con los locals correspondientes. No asumir que TypeScript verifica el orden de middleware: una prueba de integración debe demostrar que ningún handler privado se ejecuta sin el guard. No usar `as ReadyAccess` o `!` para saltarse la comprobación.

En React Router el contexto privado pasa a contener `ReadyAccess`, sin derivar su contrato de `ReturnType<typeof resolveCurrentUser>`. El middleware SSR conserva cookies y redirecciones. Para el país usa `access.company.country`, evitando la segunda lectura actual de `getCountry`. Login y registro usan la misma resolución con posibilidad de `company_required`; no requieren empresa para mostrar onboarding.

| Resultado interno | HTTP en API propia | Acción mobile |
| --- | --- | --- |
| Credencial inválida, sesión revocada, usuario inexistente | `401 UNAUTHENTICATED` | Una renovación como máximo; login si sesión inválida |
| `COMPANY_REQUIRED` | `409 COMPANY_REQUIRED` | Recuperar acceso y mostrar onboarding |
| `INVALID_COMPANY` | `400 INVALID_COMPANY` | Corregir campos |
| `USER_NOT_FOUND` durante creación | `401 UNAUTHENTICATED` | Volver a autenticar |
| `PERSISTENCE_UNAVAILABLE` | `503 SERVICE_UNAVAILABLE` | Error recuperable, sin borrar sesión |
| `INVALID_STORED_DATA` o `UNEXPECTED_ERROR` | `500 INTERNAL_ERROR` | Mensaje genérico y diagnóstico interno |
| Ruta inexistente | `404 NOT_FOUND` | Tratar como fallo de contrato si era un endpoint esperado |

Los mensajes públicos no exponen excepciones, consultas, JWT ni credenciales. El código estable decide el comportamiento; nunca analizar texto de mensajes. Los códigos de Better Auth se traducen por separado, sin cambiar sus respuestas.

### E. Casos de uso de mobile

**Distribución aprobada:** users coordina `register`, `signIn`, `restoreSession`, `completeCompany` y `signOut`; companies expone `createCompany`. `register` reutiliza `completeCompany`, que utiliza `createCompany`. Los casos reciben dependencias explícitas y devuelven `Result`; presentación gestiona UI/navegación e infraestructura gestiona almacenamiento seguro y renovación JWT. Los tipos siguientes concretan esos contratos; las particularidades del SDK se resuelven en los adaptadores.

`users` coordina la intención de registro completo. Recibe la capacidad de creación de empresa desde el export público de `companies`; ninguna feature importa archivos internos de la otra. `companies` solo conoce su API y sus tipos, por lo que no aparece un ciclo.

```ts
type SignInInput = Readonly<{ email: string; password: string }>;
type RegisterAccountInput = SignInInput & Readonly<{ name: string }>;
type CompanyDraft = Readonly<{ name: string; country: Country }>;
type RegisterInput = Readonly<{
  account: RegisterAccountInput;
  company: CompanyDraft;
}>;

// Errores técnicos reutilizados: mobile src/shared/application/transport-error.ts.
type TransportError = Readonly<{
  code: "UNAUTHENTICATED" | "COMPANY_REQUIRED" | "NETWORK_ERROR"
    | "RATE_LIMITED" | "SERVER_ERROR" | "INVALID_RESPONSE" | "OPERATION_CANCELLED";
  message: string;
}>;
type StorageError = Readonly<{ code: "SECURE_STORAGE_ERROR"; message: string }>;
type AccessError = TransportError | StorageError;

// Cada feature declara y exporta sus errores de negocio.
type AccountError = AccessError | Readonly<{
  code: "INVALID_INPUT" | "EMAIL_IN_USE" | "INVALID_CREDENTIALS";
  message: string;
}>;
type CompanyRequestError = AccessError | Readonly<{
  code: "INVALID_COMPANY";
  message: string;
}>;

// Unión para presentación del flujo, propiedad de users.
type MobileError = AccountError | CompanyRequestError;

type RegistrationError = Readonly<{
  code: "REGISTRATION_INTERRUPTED";
  message: string;
}> & (
  | Readonly<{ step: "account"; recovery: "check_session_or_edit_account"; cause: AccountError }>
  | Readonly<{ step: "access"; recovery: "restore_session"; cause: AccessError }>
  | Readonly<{ step: "company"; recovery: "reload_access_then_complete_company"; cause: CompanyRequestError }>
  | Readonly<{ step: "reload"; recovery: "reload_access"; cause: AccessError }>
);

type SignInError = Readonly<{
  code: "SIGN_IN_INTERRUPTED";
  message: string;
}> & (
  | Readonly<{ step: "credentials"; cause: AccountError }>
  | Readonly<{ step: "access"; cause: AccessError }>
);

type CompleteCompanyError = Readonly<{
  code: "COMPANY_SETUP_INTERRUPTED";
  message: string;
}> & (
  | Readonly<{ step: "create"; cause: CompanyRequestError }>
  | Readonly<{ step: "reload"; cause: AccessError }>
);

type LogoutOutcome = Readonly<{
  remoteRevocation: "confirmed" | "unconfirmed";
}>;
```

**Fallos parciales aprobados:** las operaciones devuelven `Result<T, E>` y el registro representa interrupciones con `code`, `message`, `step`, `recovery` y `cause` tipados. Esto permite comprobar el acceso y retomar el paso pendiente sin repetir el alta de cuenta. El tipo de error contiene suficiente información para retomar después de un éxito parcial. `message` cumple `AppError`; presentación elige textos localizados según `code`, `step` y `cause.code`. No registrar `RegisterInput` ni conservarlo como contexto de un error.

| Caso de uso | Firma de negocio (dependencias explícitas adicionales) | Comportamiento |
| --- | --- | --- |
| `register` — users | `RegisterInput → Promise<Result<ReadyAccess, RegistrationError>>` | Registrar cuenta, resolver acceso, crear empresa si falta y recargar acceso; éxito solo cuando está listo |
| `signIn` — users | `SignInInput → Promise<Result<UserAccess, SignInError>>` | Autenticar y consultar acceso; empresa pendiente es éxito válido |
| `restoreSession` — users | `() → Promise<Result<UserAccess \| null, AccessError>>` | Validar sesión persistida, preparar acceso JWT y cargar `/me`; ausencia/expiración confirmada es `ok(null)` |
| `completeCompany` — users | `CompanyDraft → Promise<Result<ReadyAccess, CompleteCompanyError>>` | Invocar creación de companies y recargar `/me`; usado por registro y recuperación |
| `createCompany` — companies | `CompanyDraft → Promise<Result<CreateCompanyResponse, CompanyRequestError>>` | Validar datos y llamar al adaptador del endpoint idempotente; no generar ID local |
| `signOut` — users | `() → Promise<Result<LogoutOutcome, StorageError>>` | Invalidar operaciones en curso, intentar revocación, limpiar almacenamiento y estado local; salida local aun sin red |

`MobileError` reúne errores para presentación; los contratos de operaciones usan `AccountError`, `AccessError`, `CompanyRequestError` o `StorageError` según corresponda. `CompanyDraft` y `CompanyRequestError` pertenecen a companies y users los importa por su export público; companies nunca importa `MobileError` ni código de users. Los errores técnicos compartidos no contienen reglas ni mensajes de UI. `OPERATION_CANCELLED` indica un resultado descartado por logout/cambio de cuenta y no se muestra como error de credenciales.

**Dependencias aprobadas:** suministrar funciones tipadas con las capacidades mínimas que requiere cada caso de uso. La composición conecta los adaptadores reales; los casos de uso no importan Better Auth, `fetch` ni SecureStore. Las pruebas suministran funciones controladas. Declarar los contratos junto al caso de uso o agruparlos en un archivo cuando se compartan:

```ts
type MobileAuth = Readonly<{
  registerAccount: (input: RegisterAccountInput) => Promise<Result<void, AccountError>>;
  signIn: (input: SignInInput) => Promise<Result<void, AccountError>>;
  restoreSession: () => Promise<Result<"active" | "absent", AccessError>>;
  revokeSession: () => Promise<Result<void, AccessError>>;
  clearLocalSession: () => Promise<Result<void, StorageError>>;
}>;

type AccessReader = () => Promise<Result<UserAccess, AccessError>>;
type CreateCompany = (input: CompanyDraft) => Promise<Result<CreateCompanyResponse, CompanyRequestError>>;

type RegisterDependencies = Readonly<{
  registerAccount: MobileAuth["registerAccount"];
  readAccess: AccessReader;
  completeCompany: (input: CompanyDraft) => Promise<Result<ReadyAccess, CompleteCompanyError>>;
}>;
type SignInDependencies = Readonly<{
  signIn: MobileAuth["signIn"];
  readAccess: AccessReader;
}>;
type RestoreSessionDependencies = Readonly<{
  restoreSession: MobileAuth["restoreSession"];
  readAccess: AccessReader;
}>;
type CompleteCompanyDependencies = Readonly<{
  createCompany: CreateCompany;
  readAccess: AccessReader;
}>;
type SignOutDependencies = Readonly<{
  invalidatePendingOperations: () => void;
  revokeSession: MobileAuth["revokeSession"];
  clearLocalSession: MobileAuth["clearLocalSession"];
  clearPrivateState: () => void;
}>;
```

Las firmas reciben `input` y `dependencies` como argumentos; restauración y logout reciben solo `dependencies`. Las capacidades de invalidación y limpieza de memoria son síncronas y totales; la limpieza persistente es fallible. El adaptador de companies implementa `CreateCompany` con su cliente HTTP configurado; el caso de uso recibe esa capacidad con un nombre como `sendCompany`, evitando recursión accidental con su propio nombre.

`register` valida todos los campos antes del primer efecto. Tras el alta, `readAccess` devuelve `ready` si ya existe empresa o delega en `completeCompany`. Si este último falla, mapea `create` a `step: company` y `reload` a `step: reload`; nunca reejecuta el alta para recuperar una empresa pendiente. Un timeout de alta deja resultado incierto: recuperar sesión o pedir login, sin afirmar que no se creó la cuenta.

`signIn` recibe solo `MobileAuth.signIn` y `readAccess`; `restoreSession`, solo la restauración del adaptador y `readAccess`; `completeCompany`, solo `createCompany` y `readAccess`. No inyectar el objeto completo de dependencias en todos los casos. Si `/me` sigue devolviendo empresa pendiente después de una creación exitosa, fallar en `reload` con `INVALID_RESPONSE`; no inventar una empresa ni entrar a la app.

`signOut` necesita capacidades explícitas para invalidar operaciones y limpiar datos privados además del adaptador auth. Confirmar primero la limpieza local antes de devolver éxito. Si SecureStore falla al borrar, devolver `SECURE_STORAGE_ERROR`, bloquear restauración automática en el proceso actual y ofrecer reintentar limpieza; no afirmar que las credenciales persistidas desaparecieron. Una revocación fallida no evita intentar esa limpieza. El intento remoto tendrá un timeout de 5 segundos; al vencer, cancelar ese intento y completar la limpieza local, sin esperar indefinidamente una respuesta. La cancelación local no demuestra que el servidor haya procesado o descartado la revocación.

### F. Estado mobile y transporte

**Modelo aprobado:** un provider mantiene `AccessState` con `checking`, `signed_out`, las variantes `company_required`/`ready` de `UserAccess`, y `unavailable` con error recuperable. El estado de acceso y el estado de envío del formulario son distintos. Un fallo de conexión al restaurar no borra la sesión. El provider de acceso usa una unión:

```ts
type AccessState =
  | Readonly<{ status: "checking" }>
  | Readonly<{ status: "signed_out" }>
  | UserAccess
  | Readonly<{ status: "unavailable"; error: MobileError }>;
```

`unavailable` tras fallo de restauración permite reintentar y no muestra datos privados ni borra una sesión por un error de red. Un fallo de envío de empresa mantiene `company_required` y muestra el error del formulario. Navegación deriva del discriminante; evitar combinaciones de booleanos como `isLoggedIn`, `hasCompany` e `isLoading` que puedan contradecirse.

**Coordinación de renovación aprobada:** el cliente HTTP centraliza el JWT y su renovación; las solicitudes simultáneas esperan una única renovación en curso. Ante `401`, permite como máximo una renovación y una repetición por solicitud, sin bucles. Al cerrar sesión descarta renovaciones pendientes para impedir que restauren credenciales. No son casos de uso de negocio `getToken`, `refreshToken` o `fetchWithAuth`. Mantener un único JWT y una promesa de renovación en curso por instancia de sesión; al cerrar sesión o cambiar de usuario, invalidar la generación actual y descartar respuestas antiguas, incluidas escrituras tardías del cliente auth al almacenamiento. Probar este comportamiento con el cliente real, no solo con una promesa simulada.

Un JWT decodificado localmente solo permite planificar renovación con `exp`; no prueba identidad ni pertenencia a empresa. El servidor valida la firma y el cliente obtiene identidad de `/me`. No enviar la sesión persistente a rutas de negocio; se usa únicamente con los endpoints de Better Auth.

### G. Validación y garantías de tipos

**Distribución aprobada y requisito transversal:** toda comunicación JSON entre backend, mobile y frontend utiliza Zod. Las entradas se parsean antes de invocar el caso de uso; las respuestas se validan en el adaptador antes de entregarlas a la aplicación. La emisión de JSON propio también pasa por el esquema de respuesta. La regla se aplica al nuevo flujo y a las rutas web tocadas por esta integración; no implica modificar módulos ajenos en esta entrega.

```text
JSON recibido → unknown → schema.safeParse → datos tipados → caso de uso
caso de uso → proyección DTO → schema.safeParse → JSON de respuesta
respuesta remota → unknown → schema.safeParse → resultado tipado para aplicación
```

Un JSON sintácticamente inválido se rechaza en el límite HTTP; un JSON con forma inválida se rechaza por Zod. Ambos fallos de entrada se traducen al error `400` correspondiente sin ejecutar negocio. Una salida propia que no cumple el esquema es un fallo interno (`500`), nunca un error del cliente. Una respuesta remota inválida produce `INVALID_RESPONSE`, sin convertirla en sesión ausente. Validar también las respuestas de error; HTML, body vacío o JSON incompatible de un proxy no se interpretan como un DTO válido.

La integración con Better Auth conserva sus endpoints y validación de seguridad nativos. Añadir esquemas Zod en los adaptadores propios de mobile/web para las entradas y los datos JSON consumidos del SDK, incluidos errores, sesión y respuesta de token. No tomar la anotación TypeScript del SDK como validación runtime ni reimplementar sus endpoints. Si hay rutas frontend con entrada externa antes de un caso de uso, aplican la misma regla.


- Activar los contratos con los `strict: true` existentes; no introducir `any`, casts de `response.json()` ni non-null assertions para satisfacer firmas.
- HTTP, almacenamiento y claims empiezan como `unknown`. Los parsers usan Zod `safeParse` y traducen el resultado a `Result`; validar forma, strings, UUID de empresa, país, variantes y coherencia entre IDs. Los objetos técnicos se proyectan a campos permitidos.
- El selector de país del formulario puede contener `""`; `CompanyDraft.country` solo existe después de validar `Country`. El body no puede establecer `companyId`, `userId`, `created`, `status` ni `emailVerified`.
- Reutilizar `Country` e `isCountry`. Aplicar normalización del nombre de empresa en dominio/aplicación y validar 1–120 caracteres en core aunque mobile ya lo haya validado. El adaptador de persistencia recibe el valor normalizado.
- Better Auth conserva la política autoritativa de email/contraseña. Mobile refleja esa política para feedback; nunca modifica la contraseña. El tipo de formulario no se trata como dato validado por tener anotaciones TypeScript.
- Errores técnicos se traducen en el adaptador y se registran internamente sin secretos. Ausencia válida es `ok(null)`; ninguna excepción de base de datos/red se transforma en ausencia.
- Usar `satisfies` al componer adaptadores y handlers cuando ayude a comprobar contratos sin forzar tipos. La exhaustividad de variantes debe comprobarse con `never` en el mapeo central de estado/error que lo requiera.

### H. Estructura concreta prevista

```text
shared/contracts/registration.ts          # Schemas Zod y tipos inferidos de request/response
apps/core/src/
  shared/infrastructure/
    auth.ts                              # Configuración Better Auth
    current-user.ts                      # Adaptación de credenciales y resolución compartida
    api-auth-middleware.ts               # Publica locals y exige empresa
  features/users/
    application/user-access.ts           # Unión, errores y guard requireCompany
    application/load-user-access.ts      # Caso de uso y capacidades requeridas
    infrastructure/user-repository.ts    # Proyección del usuario actual
    index.ts                             # Exports consumidos por composición
  features/companies/
    application/create-company-for-user.ts  # Adaptar caso existente a Result
    infrastructure/company-repository.ts # Lectura tenant y creación/vínculo
    index.ts                             # Tipos/capacidades públicos necesarios
apps/mobile/src/
  shared/application/transport-error.ts  # Fallos técnicos usados por users y companies
  shared/infrastructure/
    auth-client.ts                       # Cliente y almacenamiento seguro
    api-client.ts                        # Transporte, JWT y renovación
  features/users/
    application/user-access.ts           # Estado de acceso local
    application/contracts.ts             # Inputs, errores y capacidades compartidas por casos
    application/register.ts
    application/sign-in.ts
    application/restore-session.ts
    application/complete-company.ts
    application/sign-out.ts
    infrastructure/auth-adapter.ts       # Traduce Better Auth a contratos propios
    infrastructure/access-api.ts         # GET /me, parseo Zod y mapeo
    presentation/                        # Provider, pantallas, formularios y traducción de errores
    index.ts
  features/companies/
    application/create-company.ts        # CompanyDraft, error y operación remota distinta de generateCompany
    infrastructure/company-api.ts        # POST /company y validación de respuesta
    index.ts
  app/                                   # Rutas y composición de dependencias
```

Los tests viven junto a la responsabilidad que verifican. La estructura no requiere carpetas vacías, una clase por operación ni un framework de inyección. Core y mobile ubican clientes y configuración técnica compartida en `src/shared/infrastructure/`. Los adaptadores específicos permanecen en `features/<feature>/infrastructure/`. Esta ubicación común fue confirmada al revisar la estructura de mobile. Los archivos route delegan UI y la composición suministra operaciones ya configuradas.

### I. Comprobaciones de los contratos

**Cobertura aprobada:** pruebas de casos de uso para éxito, errores y recuperación parcial; integración para cookies, JWT, revocación, Zod y aislamiento entre empresas; pruebas de sesión mobile para renovación simultánea, reapertura y logout sin conexión; regresión del registro web. La cobertura ejecutada de T1–T4 figura en [registro-mobile-tareas.md](registro-mobile-tareas.md); la presentación mobile sigue pendiente.

| Nivel | Evidencia requerida |
| --- | --- |
| Tipos | Un contexto pendiente no puede suministrarse a un handler/caso que requiere `ReadyAccess`; variantes y códigos se manejan exhaustivamente |
| Parsers Zod | Rechazar empresa nula en `ready`, IDs incoherentes, país desconocido y respuesta incompleta; no aceptar un cast como validación |
| Core aplicación | Usuario ausente frente a fallo de consulta; empresa pendiente; empresa vinculada inválida; creación repetida y conflicto recuperable |
| Core integración | Cookie/JWT, orden de middleware, una carga de identidad por petición, concurrencia de creación, RLS y aislamiento entre peticiones |
| Mobile aplicación | Cada interrupción del registro indica la recuperación correcta; un fallo posterior al alta no vuelve a registrar usuario |
| Mobile sesión | Renovación simultánea, expiración por inactividad, error de red, limpieza fallida, logout sin conexión y descarte de resultados tardíos |
| Regresión web | Conservar registro, creación de empresa, login y logout del flujo web existente |

Una comprobación de lecturas repetidas se limita al contexto compartido, cuyo objetivo explícito es evitar duplicados; no fijar SQL ni número de consultas internas de Better Auth. No repetir todos los casos de dominio como pruebas de pantalla.

## Responsabilidades y archivos previstos

Seguir [architecture.md](architecture.md), usando las ubicaciones reales de `apps/core`.

| Área | Cambio previsto |
| --- | --- |
| Core `src/shared/infrastructure/auth.ts` | Configurar integración Expo y emisión JWT |
| Core `src/shared/infrastructure/current-user.ts` y middleware de API | Reutilizar resolución de usuario, añadir validación JWT y composición del contexto por petición |
| Core feature `companies` | Exponer lectura de la empresa actual dentro del tenant; conservar creación y vinculación transaccional |
| Core `src/app.ts` | Ordenar middleware, montar `/api/me` y consumir contexto en `/api/company` |
| Core middleware/contexto privado web | Compartir resolución de datos y publicar usuario y empresa, manteniendo autenticación por cookie y redirecciones por país |
| Core Prisma | Incorporar almacenamiento de claves del plugin JWT |
| Mobile `src/shared/infrastructure/` | Cliente Better Auth, almacenamiento seguro y transporte HTTP con JWT y renovación |
| Mobile feature `users` | Casos de uso de registro, login, restauración y logout; pantallas y estados de autenticación |
| Mobile feature `companies` | Adaptador y operación para crear la empresa en core; no usar `generateCompany` como persistencia |
| Mobile `src/app` | Composición, providers y rutas que delegan a las pantallas de features |

Crear solo los archivos requeridos; dependencias entre features mediante exports públicos o capacidades suministradas. Los tipos compartidos no importan Prisma ni código de la otra app.

## Configuración y seguridad

- Mobile usa una URL pública HTTPS accesible desde el dispositivo, configurada por entorno. No contiene secretos de Better Auth, claves de firma ni credenciales de base de datos.
- Configurar URL canónica, orígenes permitidos y scheme de mobile en Better Auth. Las excepciones locales se limitan a desarrollo. No desactivar controles de origen o CSRF de la web.
- El alcance de esta entrega es mobile nativo y la web existente de core. Expo web necesitaría su propia configuración de cookies y CORS si se publica en otro origen.
- Verificar las dependencias requeridas por la integración Expo y su compatibilidad con SDK 57; la guía consultada de Better Auth describe SDK 55. Leer la documentación versionada de Expo antes de implementar código mobile.
- No registrar contraseñas, cookies ni JWT en logs. Mantener la protección contra abuso de los endpoints públicos de autenticación y comprobar su comportamiento en el despliegue.
- No sustituir RLS por validaciones del cliente. Las rutas siguen consultando datos dentro de `withTenantIsolation`.

## Tareas de implementación

Las [tareas de implementación](registro-mobile-tareas.md) definen las entregas incrementales, el alcance, las exclusiones y los criterios de aceptación. T1–T4 están terminadas; T5 sigue pendiente.

Las decisiones revisadas quedan cerradas para esta etapa. La URL de desarrollo confirmada es `http://localhost:3000`. T3 verificó Better Auth, su plugin Expo, Zod y Expo SDK 57 con las dependencias instaladas y su comprobación de compatibilidad. Conservar los valores operativos propuestos de este documento como base de implementación; cualquier incompatibilidad que cambie el comportamiento acordado debe quedar explícita.

T1 implementa contexto y contratos de core/web; T2 implementa JWT revocables para core; T3 implementa login, restauración, renovación y logout mobile; T4 implementa registro recuperable y creación de empresa mobile. Las cuatro tienen pruebas ejecutadas. Las casillas siguientes representan trabajo pendiente de implementación y verificación, no decisiones de comportamiento pendientes.

## Pendientes y criterios de aceptación

- [x] Configurar Better Auth/Expo, JWT y migración de claves.
- [x] Declarar Zod como dependencia runtime donde se importen schemas, con una versión compatible común; crear los contratos compartidos e inferir sus tipos.
- [ ] Validar con Zod JSON de entrada/salida en core y los adaptadores mobile/web del flujo; comprobar que una entrada inválida no ejecuta el caso de uso.
- [x] Implementar autenticación dual y contexto tipado por petición; cargar usuario y empresa una vez para su consumo por handlers.
- [x] Añadir `/api/me` y permitir onboarding sin empresa antes del guard de negocio.
- [ ] Implementar cliente mobile, almacenamiento seguro, renovación y navegación por estado.
- [ ] Implementar registro, login, creación pendiente y logout.
- [x] Verificar que una cuenta con `emailVerified: false` puede iniciar sesión, obtener JWT, crear empresa y acceder a negocio una vez vinculada, sin enviar correos.
- [x] Verificar cookies web y JWT mobile contra las mismas rutas; JWT inválido con cookie válida también debe devolver `401`.
- [ ] Probar tokens vencidos, firma/emisor/audiencia incorrectos, sesión revocada, usuario inexistente y fallos de infraestructura.
- [ ] Probar acceso de dos empresas en peticiones concurrentes: ni contexto ni datos se mezclan; tenant suministrado por cliente no altera el acceso.
- [ ] Probar reintentos y concurrencia al crear empresa, restauración después de reiniciar y pérdida de respuesta después del alta. Al reabrir con empresa pendiente, pedir nombre y país sin volver a registrar la cuenta.
- [x] Confirmar el mecanismo de renovación: sesión persistente de Better Auth para obtener nuevos JWT.
- [x] Confirmar la ventana de inactividad: 30 días, renovable con el uso de la app.
- [ ] Probar que el uso prolongado renueva tanto JWT como sesión persistida y supera el vencimiento inicial sin pedir login; comprobar expiración tras inactividad y ausencia de renovaciones en segundo plano.
- [ ] Probar renovación simultánea sin bucles y logout seguido de intento de reutilizar el JWT tras revocación confirmada.
- [ ] Probar logout sin conexión o con fallo de revocación: almacenamiento y memoria limpios, navegación al login y ninguna renovación en curso restaura el acceso.
- [x] Verificar que handlers reutilizan el contexto y que las rutas privadas nunca reciben empresa nula; mantener las comprobaciones transaccionales de negocio.
- [x] Ejecutar regresión del flujo web existente.

Las pruebas seguirán [testing-conventions.md](testing-conventions.md): lógica y estados en su capa e integración para credenciales/RLS/persistencia.

## Referencias del proyecto

- [Configuración de Better Auth](../apps/core/src/shared/infrastructure/auth.ts)
- [Registro web](../apps/core/app/components/auth-form.tsx)
- [API y middleware actual](../apps/core/src/app.ts)
- [Resolución de usuario](../apps/core/src/shared/infrastructure/current-user.ts)
- [Middleware privado web](../apps/core/app/routes/private-layout.tsx)
- [Contexto privado web](../apps/core/app/private-user-context.ts)
- [Creación de empresa](../apps/core/src/features/companies/application/create-company-for-user.ts)
- [Aislamiento tenant](../apps/core/src/shared/infrastructure/persistance.ts)
- [Entrada de mobile](../apps/mobile/src/app/_layout.tsx)
