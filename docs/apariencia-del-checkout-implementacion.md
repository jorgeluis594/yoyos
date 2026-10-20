# Apariencia del checkout · Diseño técnico

Complementa la [definición de producto](apariencia-del-checkout.md). Fecha: 9 de octubre de 2026; actualizado el 10 de octubre de 2026 para usar colores predefinidos en lugar de un color HEX libre, y el 19 de octubre de 2026 con fondos con tono propio y una paleta completa por color ([§15](#15-ajuste-fondos-con-tono-y-paleta-por-color)).

**Estado:** primera versión construida (T0–T5). Ajuste del 19 de octubre de 2026: diseño cerrado, pendiente de implementación (T6–T7, ver [Estado](#estado)).

Se entrega en **un solo lanzamiento**: el editor, la apariencia pública y la retirada de la página `/pago/:orderId` salen juntos. Se construye con las tareas de [apariencia-del-checkout-tareas.md](apariencia-del-checkout-tareas.md), pensadas para trabajarse en paralelo.

## 1. Decisiones de producto

| Tema | Decisión |
| --- | --- |
| Entrega | Un solo lanzamiento con todo el alcance de la especificación. |
| Límite del logo | El mismo del sistema de imágenes: hasta 10 MB. No se crea una validación específica para logos. |
| Logos animados | No se detectan; se muestran como cualquier imagen. |
| Vista previa · Pago | Muestra los medios de pago reales del negocio (billetera y banco). Si no tiene ninguno, usa ejemplos rotulados. Pedido, comprador e importes son siempre ficticios. |
| Página `/pago/:orderId` | Se conserva solo para pedidos sin checkout. Con checkout habilitado, el checkout muestra el pago después de confirmar y es la superficie pública del comprador. |
| Enlaces `/pago/:orderId` ya compartidos | Con checkout habilitado redirigen (301) a `/checkout/:companyId/:orderId`; sin checkout muestran la página de pago. Si el pedido no existe, se muestra el error genérico. |
| Rutas | En inglés, como todas las existentes. |
| Color de marca | Se elige de un catálogo cerrado de nueve colores. Cada color fija sus tonos de claro y oscuro; no hay HEX libre, cálculo de tonos ni aviso de ajuste. |
| Catálogo de colores | Vive en el código del dominio. Agregar o cambiar un color es un cambio de código revisado, no una configuración. |
| Logos subidos y descartados | Quedan almacenados sin uso. En esta versión no se limpian. |
| Concurrencia | Prevalece el último guardado completado. Sin versión ni bloqueo optimista. |

## 2. Superficies afectadas

| Superficie | Cambio |
| --- | --- |
| `/checkout/:companyId/:orderId` | Cabecera con logo y nombre. Aplica color y fondo en todos los estados del pedido. |
| `/pago/:orderId` | Redirige al checkout si está habilitado; sin checkout conserva la página de pago. |
| Detalle del pedido (`order-detail.tsx`) | El enlace de pago abre directamente el checkout del pedido. |
| `settings/checkout-appearance` | Nuevo editor, según el mock aprobado `a4` (vista previa protagonista con colores predefinidos). |
| `settings/checkout-appearance/preview` | Página interna que se carga dentro del iframe de la vista previa. |
| Navegación privada | Nueva entrada «Apariencia del checkout» bajo Medios de cobro. |

La app móvil no cambia: sigue compartiendo el enlace de checkout.

## 3. Arquitectura

La funcionalidad se implementa como una feature nueva, `checkout-appearance`, que sigue las capas de [architecture.md](architecture.md). Las rutas existentes la consumen; las demás features no dependen de ella.

### 3.1 Mapa de módulos

```text
apps/core/prisma/
  schema.prisma                                      CompanyCheckoutAppearance + enums CheckoutBrandColor y CheckoutBackground
  migrations/20261010042649_add_company_checkout_appearance/
apps/core/src/features/checkout-appearance/
  domain/
    checkout-appearance.ts                           Tipos, valores predeterminados y validación del modelo
    checkout-colors.ts                               Catálogo de colores y checkoutPalette (puro)
  application/checkout-appearance.ts                 Casos de uso con dependencias explícitas
  infrastructure/checkout-appearance-repository.ts   Adaptador Prisma
  presentation/
    checkout-theme.tsx                               <CheckoutTheme>: variables CSS de la marca
    checkout-brand-header.tsx                        Logo + nombre con fallback
    brand-color-dialog.tsx                           Diálogo «Elige el color de tu marca»
    checkout-appearance-schemas.ts                   Esquemas Zod de las fronteras JSON internas de core
    preview-fixtures.ts                              Pedido ficticio para la vista previa
    preview-protocol.ts                              Envío y recepción de postMessage validados
  composition.ts                                     Ensambla las dependencias reales
  index.ts                                           API pública de la feature
apps/core/app/
  private-access.ts                                  Middleware de acceso privado, extraído de private-layout.tsx
  routes/checkout-appearance-settings.tsx            Editor (dentro del layout privado)
  routes/checkout-appearance-preview.tsx             Contenido del iframe (autenticado, sin layout privado)
  routes/checkout.tsx                                Aplica tema y cabecera
  routes/buyer-payment.tsx                           Queda solo como redirección
```

### 3.2 Vista de componentes

```mermaid
flowchart LR
  subgraph Navegador
    ED[Editor<br/>settings/checkout-appearance]
    PV[iframe de vista previa<br/>settings/checkout-appearance/preview]
    CO[Checkout del comprador<br/>checkout/:companyId/:orderId]
  end
  subgraph "apps/core · rutas (React Router)"
    RE[Loader y action del editor]
    RP[Loader de la vista previa]
    RC[Loader del checkout]
    RR[Loader de /pago: redirección]
  end
  subgraph "Feature checkout-appearance"
    FA[composition: fachada checkoutAppearance]
    UC[application: casos de uso]
    DO[domain: modelo y catálogo de colores]
    RepoA[infrastructure: repositorio]
    TH[presentation: CheckoutTheme y cabecera]
  end
  ORD[Feature orders]
  PAY[Feature companies: medios de cobro]
  IMG[shared/images]
  DB[(PostgreSQL con RLS)]
  R2[(Almacenamiento de imágenes)]

  ED -- postMessage --> PV
  ED -- "POST /api/images" --> IMG
  RE --> FA
  RP --> FA
  RC --> ORD
  RC --> FA
  RR --> ORD
  FA --> UC --> DO
  FA --> RepoA --> DB
  FA --> IMG --> R2
  FA --> PAY
  CO --> TH
  PV --> TH
  TH --> DO
```

- **Rutas:** son el único punto donde se combinan `orders` y `checkout-appearance`. `orders` no conoce la apariencia y `checkout-appearance` no conoce los pedidos. El loader del checkout autoriza con `orders` y después pide la apariencia.
- **Fachada:** `checkoutAppearance` (en `composition.ts`) es la única entrada desde fuera de la feature, junto con los componentes de `presentation` y las funciones puras exportadas en `index.ts`.
- **Dependencias de otras features:** `shared/images` (validar el logo y resolver su URL) y `companies` (medios de cobro para la vista previa), siempre a través de sus `index.ts`.

### 3.3 Capas y responsabilidades

| Capa | Archivos | Responsabilidad | Puede importar | No puede importar |
| --- | --- | --- | --- | --- |
| Dominio | `domain/*` | Modelo, invariantes, valores predeterminados y catálogo de colores | `@shared/result`, `@shared/functional`, Zod (validación propia), `design-tokens.json` | Prisma, React, esquemas de presentación, otras features |
| Aplicación | `application/*` | Casos de uso; coordina validación, verificación del logo y persistencia | Dominio | Prisma, React Router, adaptadores concretos |
| Infraestructura | `infrastructure/*` | Leer y escribir la fila; traducir fallos técnicos a `Result` | Dominio, Prisma, logger | React, rutas |
| Composición | `composition.ts` | Conectar adaptadores; establecer el contexto de empresa en la lectura pública; registrar eventos | Todas las capas de la feature, `index.ts` de otras features | — |
| Presentación | `presentation/*` | Componentes de tema, cabecera y vista previa; protocolo de mensajes | Dominio (funciones puras), Zod | Infraestructura, composición |
| Rutas | `app/routes/*` | HTTP: autorizar, validar con Zod, llamar a la fachada y renderizar | Fachada, presentación (componentes y esquemas) | Repositorios directamente |

Por su tamaño, los casos de uso viven en un solo `application/checkout-appearance.ts` y sus dependencias se declaran en línea, sin `ports/`, como permite [architecture.md](architecture.md).

### 3.4 Fronteras y transformación de datos

Cada frontera valida su entrada; el tipo se fortalece hacia dentro y se reduce hacia fuera.

```mermaid
flowchart LR
  A[Fila Prisma] -- parseCheckoutAppearance --> B[CheckoutAppearance<br/>CheckoutBrandColor, ImageId]
  F[JSON del editor] -- parseCheckoutAppearance<br/>en el caso de uso --> B
  B -- getPublicCheckoutAppearance<br/>+ URL del logo --> C[PublicAppearance]
  C -- publicCheckoutAppearanceSchema --> D[Datos del loader]
  D --> E[CheckoutTheme]
  E -- checkoutPalette --> G[CheckoutTokens<br/>variables CSS]
```

| Frontera | Entrada | Validación | Salida |
| --- | --- | --- | --- |
| Base → proceso | Fila de `CompanyCheckoutAppearance` | `parseCheckoutAppearance` en el repositorio; si falla, `INVALID_STORED_DATA` | `CheckoutAppearance` |
| Editor → servidor | JSON de la action | La ruta lo pasa como `unknown`; `parseCheckoutAppearance` lo valida en el caso de uso | `CheckoutAppearance` |
| Servidor → comprador | `PublicAppearance` | `publicCheckoutAppearanceSchema.parse` antes de responder | JSON solo con datos visuales |
| Editor → iframe | `postMessage` | Origen + `checkoutPreviewMessageSchema.safeParse` | Estado de la vista previa |
| Dominio → CSS | `CheckoutPalette` | Los valores salen del catálogo del código, nunca de datos del vendedor | Variables CSS |

### 3.5 Flujos

**Comprador abre el checkout**

```mermaid
sequenceDiagram
  actor B as Comprador
  participant L as Loader checkout.tsx
  participant O as orders
  participant A as checkoutAppearance
  participant DB as PostgreSQL
  B->>L: GET /checkout/:companyId/:orderId
  L->>O: getCheckout(access)
  O->>DB: pedido (RLS de la empresa)
  alt acceso inválido
    L-->>B: 404 genérico, sin marca
  else acceso válido
    L->>O: getCheckoutDeliverySettings / getBuyerPaymentView
    L->>A: getPublic(companyId)
    A->>DB: apariencia (withTenantIsolation)
    A-->>L: PublicAppearance o null
    L-->>B: HTML con <style> de la marca (SSR)
  end
```

**Vendedor guarda la apariencia**

```mermaid
sequenceDiagram
  actor S as Vendedor
  participant E as Editor
  participant I as POST /api/images
  participant R as Action del editor
  participant A as checkoutAppearance.save
  participant DB as PostgreSQL
  S->>E: elige logo
  E->>I: multipart (archivo)
  I-->>E: { id, url } (aún no publicado)
  S->>E: Guardar cambios
  E->>R: JSON { logoImageId, brandColor, background }
  R->>A: save(companyId de la sesión, userId, valor)
  A->>DB: verifica imagen pública de la empresa
  A->>DB: upsert de la fila completa
  A-->>R: CheckoutAppearance
  R-->>E: { success, appearance }
  E->>E: published = appearance
```

**Vista previa en vivo**

```mermaid
sequenceDiagram
  participant E as Editor
  participant P as iframe de vista previa
  E->>P: carga settings/checkout-appearance/preview
  P->>P: loader: nombre, medios de cobro, datos ficticios
  P-->>E: checkout-appearance:ready
  loop cada cambio del borrador, modo o estado
    E->>P: checkout-appearance:update
    P->>P: valida origen y esquema; toma la paleta del catálogo; aplica .dark
  end
```

**Enlace antiguo `/pago/:orderId`**

```mermaid
sequenceDiagram
  actor B as Comprador
  participant L as Loader buyer-payment.tsx
  participant O as orders.resolveBuyerAccess
  B->>L: GET /pago/:orderId
  L->>O: resolveBuyerAccess(orderId)
  alt pedido encontrado
    L-->>B: 301 → /checkout/:companyId/:orderId
  else no encontrado o ID inválido
    L-->>B: 404 genérico
  end
```

### 3.6 Contexto de empresa y transacciones

`withTenantIsolation(companyId, …)` no abre una transacción: fija la empresa en el contexto asíncrono, y cada consulta aplica `app.company_id`, que es lo que evalúa RLS. Además, impide cambiar de empresa dentro de una transacción ya abierta.

| Operación | Contexto de empresa | Atomicidad |
| --- | --- | --- |
| Loader y action del editor | Middleware privado: `withTenantIsolation(access.company.id)` | El `upsert` es una sola sentencia; no hace falta `withinTransaction` |
| Lectura pública | `checkoutAppearance.getPublic` envuelve en `withTenantIsolation(companyId)`, después de autorizar el pedido | Una consulta de lectura |
| Vista previa | Middleware privado | Consultas de lectura independientes |

La lectura pública es independiente de la del pedido. Si un vendedor guarda justo entre ambas, el comprador ve la apariencia nueva con el pedido leído un instante antes. Es aceptable porque la apariencia no afecta importes ni estados.

### 3.7 Renderizado y tema

- **Servidor:** el checkout se renderiza en el servidor con el `<style>` de la marca dentro del HTML. No hay destello de la apariencia de Yoyos antes de aplicar la marca.
- **Hidratación:** `checkoutPalette` es una consulta al catálogo, así que servidor y navegador producen el mismo CSS y no hay diferencias al hidratar.
- **Modo oscuro:** el script actual de `root.tsx` aplica `.dark` antes de pintar. El `<style>` ya trae las dos variantes (`[data-checkout-theme="…"]` y `.dark [data-checkout-theme="…"]`), por lo que el cambio de modo no requiere JavaScript adicional.
- **Catálogo en el navegador:** el editor lo usa para las muestras del diálogo y del inspector, y el iframe para aplicar el borrador. El costo en el paquete es una tabla de nueve colores.
- **Persistencia:** se guarda el identificador del color y el fondo, no los tonos. Un ajuste de tonos en el catálogo se aplica a todas las empresas que usan ese color sin migrar datos.

### 3.8 Decisiones de arquitectura

| Decisión | Alternativas descartadas | Motivo |
| --- | --- | --- |
| Feature nueva `checkout-appearance` | Dentro de `companies` u `orders` | Tiene modelo, reglas y pruebas propios; `orders` no debe depender de la apariencia |
| Tabla dedicada con columnas tipadas | JSON en `CompanyPaymentSettings` o una columna JSON nueva | La base valida los enums y la propiedad del logo (FK compuesta); no hay JSON que validar al leer |
| Catálogo cerrado de colores con tonos fijos | HEX libre con tonos derivados (OKLCH) | Contraste verificado de antemano para cada color; sin algoritmo de ajuste ni avisos; la UI solo ofrece opciones válidas |
| Guardar el identificador del color | Guardar sus HEX o los tokens | Una sola fuente de verdad; ajustar un color del catálogo no requiere migrar datos |
| Variables CSS con alcance `[data-checkout-theme]` | Reescribir el tema global o añadir clases por color | El checkout ya usa los tokens; el panel privado queda aislado |
| Vista previa en iframe | Container queries; renderizar dentro del editor | El iframe tiene su propio viewport y activa los breakpoints reales sin reescribir el checkout |
| Apariencia en un campo propio del loader | Agregarla a `publicCheckoutSchema` | Las respuestas de la action de confirmación no la necesitan y el contrato del pedido no cambia |
| Lectura pública tolerante a fallos (`null`) | Propagar el error | Una falla visual no debe impedir confirmar ni pagar |
| Sin versión ni bloqueo optimista | `version` como en `CompanyDeliverySettings` | Es una configuración visual completa: prevalece el último guardado y no hay datos que fusionar |
| Middleware privado extraído a `app/private-access.ts` | Duplicarlo en la ruta de la vista previa | Una sola implementación de la autorización |

## 4. Persistencia

### 4.1 Esquema Prisma

```prisma
enum CheckoutBrandColor {
  yoyos
  forest
  petrol
  ocean
  plum
  raspberry
  terracotta
  mustard
  graphite
}

enum CheckoutBackground {
  soft
  medium
  brand_tint
}

model CompanyCheckoutAppearance {
  companyId    String @id @default(dbgenerated("(NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid")) @db.Uuid
  company      Company @relation(fields: [companyId], references: [id], onDelete: Cascade)
  logoImageId  String? @db.Uuid
  logoImage    Image? @relation(fields: [companyId, logoImageId], references: [companyId, id])
  brandColor   CheckoutBrandColor
  background   CheckoutBackground
  updatedAt    DateTime @updatedAt
}
```

La migración la genera `prisma migrate dev --create-only`, siguiendo `.agents/skills/database-migrations/SKILL.md`. Quién guardó no se persiste: queda en el log `checkout_appearance_saved`.

### 4.2 SQL añadido a la migración generada

```sql
ALTER TABLE "CompanyCheckoutAppearance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CompanyCheckoutAppearance" FORCE ROW LEVEL SECURITY;
CREATE POLICY company_checkout_appearance_isolation ON "CompanyCheckoutAppearance"
  USING ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);
```

### 4.3 Invariantes garantizadas por la base

| Invariante | Mecanismo |
| --- | --- |
| Una apariencia por empresa | PK `companyId` |
| Solo la empresa del contexto lee o escribe | RLS `FORCE` con `app.company_id` |
| El logo es una imagen de la misma empresa | FK compuesta `(companyId, logoImageId) → Image(companyId, id)` |
| Una imagen en uso como logo no se puede borrar | FK `ON DELETE RESTRICT` |
| Solo colores y fondos del catálogo | Enums `CheckoutBrandColor` y `CheckoutBackground` |
| La apariencia se borra con la empresa | `ON DELETE CASCADE` |

La migración no bloquea tablas existentes: crea una tabla y dos enums nuevos, y solo añade una FK hacia `Image` desde esa tabla vacía. No toca datos. Los valores `white` y `neutral` del enum se renombran a `soft` y `medium` en la migración `rename_checkout_backgrounds` ([§15.5](#155-identificadores-de-fondo-y-migración)).

### 4.4 Ciclo de vida de la fila

| Evento | Operación |
| --- | --- |
| Empresa sin personalizar | No hay fila; se usa la apariencia de Yoyos |
| Guardar | `upsert` de la fila completa en una sola sentencia; nunca hay escrituras parciales |
| Restablecer y guardar | `upsert` con `defaultCheckoutAppearance`; la fila no se borra |
| Quitar el logo y guardar | `logoImageId = NULL` |

**Cambios del catálogo.** Ajustar los tonos de un color existente solo cambia `checkout-colors.ts`. Agregar un color requiere una migración que añada el valor al enum. Retirar un color requiere una migración que primero pase sus filas a `yoyos` y después quite el valor; mientras tanto, el dominio trata un identificador desconocido como dato inválido y el comprador ve la apariencia predeterminada.

## 5. Dominio y tipos

### 5.1 Identificadores y valores

Cada feature declara sus propios tipos marcados (*branded types*), como ya hacen `orders` y `products`:

```ts
export type CompanyId = string & { readonly __brand: "CompanyId" };
export type ImageId = string & { readonly __brand: "ImageId" };
export type HexColor = string & { readonly __brand: "HexColor" };   // solo para los tonos del catálogo
export const checkoutBrandColors = ["yoyos", "forest", "petrol", "ocean", "plum", "raspberry", "terracotta", "mustard", "graphite"] as const;
export type CheckoutBrandColor = (typeof checkoutBrandColors)[number];
export const checkoutBackgrounds = ["soft", "medium", "brand_tint"] as const;   // Suave, Medio, De marca
export type CheckoutBackground = (typeof checkoutBackgrounds)[number];

export type CheckoutAppearance = Readonly<{
  logoImageId: ImageId | null;
  brandColor: CheckoutBrandColor;
  background: CheckoutBackground;
}>;

export type CheckoutAppearanceError = Readonly<{ code: "INVALID_CHECKOUT_APPEARANCE"; message: string }>;

export const defaultCheckoutAppearance: CheckoutAppearance; // sin logo, "yoyos", "medium"
export function parseCheckoutAppearance(value: unknown): Result<CheckoutAppearance, CheckoutAppearanceError>;
```

`parseCheckoutAppearance` es la única forma de construir un `CheckoutAppearance` a partir de datos externos: valida que el color y el fondo pertenezcan al catálogo y aplica los *brands*; no acepta HEX. Se usa en dos puntos: al entrar al caso de uso y al leer una fila de la base, que también es un dato externo al proceso. `HexColor` solo tipa las constantes del catálogo, escritas en el código.

### 5.2 Catálogo de colores

Desde el ajuste del 19 de octubre, este catálogo de ocho tonos es el que usa el **catálogo público** (congelado) y el que da nombre y muestra a cada color en el editor. El checkout usa la paleta completa de [§15.6](#156-paleta-por-color). Los tipos y la función de esta sección se renombran a `CatalogTokens`, `CatalogPalette` y `catalogPalette`, sin cambiar sus valores.

```ts
export type CheckoutTokens = Readonly<{
  primary: HexColor; "primary-foreground": HexColor; "primary-hover": HexColor; "primary-pressed": HexColor;
  ring: HexColor; accent: HexColor; "accent-foreground": HexColor; "brand-background": HexColor;
}>;
export type BrandColorDefinition = Readonly<{ name: string; light: CheckoutTokens; dark: CheckoutTokens }>;
export type CheckoutPalette = Readonly<{ light: CheckoutTokens & { background: HexColor }; dark: CheckoutTokens & { background: HexColor } }>;

export const checkoutBrandColorCatalog: Readonly<Record<CheckoutBrandColor, BrandColorDefinition>>;
export function checkoutPalette(brandColor: CheckoutBrandColor, background: CheckoutBackground): CheckoutPalette;
```

Las claves coinciden con `docs/design-tokens.json`. Este catálogo no toca `card`, `border`, `input`, `muted*` ni los colores semánticos; la paleta del checkout sí redefine los no semánticos ([§15.6](#156-paleta-por-color)).

**Catálogo.** Cada color define a mano todos sus tokens en ambos modos. Los cuatro tonos base son los de la [definición de producto](apariencia-del-checkout.md#colores-disponibles):

| Id | Nombre | `light.primary` | `light.brand-background` | `dark.primary` | `dark.brand-background` |
| --- | --- | --- | --- | --- | --- |
| `yoyos` | Yoyos | `#8C552D` | `#F7EFE6` | `#D5A16C` | `#1F1B19` |
| `forest` | Bosque | `#2F6B4F` | `#F1F6F2` | `#8FCBA8` | `#181E1B` |
| `petrol` | Petróleo | `#13646B` | `#EEF6F6` | `#84CBD0` | `#161E1F` |
| `ocean` | Océano | `#1F5A8C` | `#EFF4FA` | `#8EBDE6` | `#171C22` |
| `plum` | Ciruela | `#6B3A7D` | `#F6F1F8` | `#C9A2D8` | `#1E1921` |
| `raspberry` | Frambuesa | `#A8305F` | `#FBF0F4` | `#EE9BBB` | `#221A1D` |
| `terracotta` | Terracota | `#A4452A` | `#FBF2EE` | `#EDA38A` | `#221B19` |
| `mustard` | Mostaza | `#7E5C00` | `#FAF5E6` | `#E3C063` | `#201E17` |
| `graphite` | Grafito | `#333238` | `#F4F4F5` | `#C9C7CF` | `#1C1C1E` |

El resto de tokens se fija en T0 con estas reglas, y los tests del catálogo las comprueban:

- **`primary-foreground`:** el del sistema en cada modo: blanco en claro, casi negro en oscuro.
- **`primary-hover` y `primary-pressed`:** variantes del mismo tono con diferencia mínima de 1,15:1 y 1,3:1 respecto de `primary`, conservando 4,5:1 con `primary-foreground`.
- **`ring`:** igual a `primary`, que ya supera 3:1 sobre las superficies.
- **`accent`:** superficie de selección clara (claro) u oscura (oscuro) del tono de la marca; **`accent-foreground`:** un tono de la marca con 4,5:1 sobre `accent`.
- **`primary` como texto:** se usa también en enlaces e iconos, así que debe alcanzar 4,5:1 contra `card`, `background` del sistema y su `brand-background`.

`catalogPalette` (el antiguo `checkoutPalette`) resuelve el fondo del catálogo público como antes del ajuste: Suave (`soft`) es `#FFFFFF` en claro; Medio (`medium`), el `background` del sistema; De marca (`brand_tint`), el `brand-background` de esta tabla. En oscuro, Suave y Medio usan el `background` oscuro del sistema.

`checkoutBrandColorCatalog` es la única fuente de tonos. No hay conversión de espacios de color ni ajuste en tiempo de ejecución; el cálculo de contraste solo existe en los tests.

## 6. Esquemas de las fronteras JSON

No se crea un contrato en `shared/contracts/`: esa carpeta es para contratos entre aplicaciones (core ↔ mobile), y la app móvil no usa la apariencia. Los esquemas viven en `presentation/checkout-appearance-schemas.ts` dentro de la feature, como en `chats/presentation/*-schemas.ts`.

Solo hay esquemas donde hay una frontera JSON que no cubre el dominio:

```ts
// Servidor → comprador: solo datos visuales
export const publicCheckoutAppearanceSchema = z.strictObject({
  logoUrl: z.url({ protocol: /^https?$/ }).nullable(),
  brandColor: z.enum(checkoutBrandColors),
  background: z.enum(checkoutBackgrounds),
});

// Editor → iframe de vista previa
export const checkoutPreviewMessageSchema = z.strictObject({
  type: z.literal("checkout-appearance:update"),
  appearance: publicCheckoutAppearanceSchema,
  mode: z.enum(["light", "dark"]),
  state: z.enum(["review", "payment"]),
});

// Iframe → editor: listo para recibir el estado
export const checkoutPreviewReadySchema = z.strictObject({ type: z.literal("checkout-appearance:ready") });
```

- **Entrada del editor:** no tiene esquema de transporte propio. La action pasa el JSON como `unknown` a `checkoutAppearance.save`, y `parseCheckoutAppearance` del dominio lo valida y normaliza. Un segundo esquema solo duplicaría esa regla.
- **`logoUrl`:** el esquema solo valida la forma: `http` o `https` y nunca `javascript:` ni `data:`. Acepta hosts IP y `localhost`, que usan el almacenamiento local y los E2E; `z.httpUrl()` los rechaza. La política de URLs públicas la impone el adaptador R2 (`r2-image-storage.ts`): exige HTTPS con `NODE_ENV=production` y rechaza credenciales, query y fragmento.
- Los tipos se infieren con `z.infer`; no hay DTOs escritos a mano.
- La apariencia pública **no** se agrega a `publicCheckoutSchema`. Viaja en un campo propio de los datos del loader del checkout (`PageData.appearance`), porque las respuestas de la action de confirmación no la necesitan.
- `postMessage` es una frontera JSON. Ambos lados validan con `safeParse` y descartan cualquier mensaje cuyo `event.origin` no sea `window.location.origin`.

## 7. Casos de uso

Viven en `application/checkout-appearance.ts`. Reciben sus dependencias como argumento y devuelven `Result`.

```ts
type CheckoutAppearanceFailure = CheckoutAppearanceError
  | Readonly<{ code: "INVALID_IMAGE" | "INVALID_STORED_DATA" | "PERSISTENCE_UNAVAILABLE"; message: string }>;

type AppearanceDependencies = Readonly<{
  load: (companyId: CompanyId) => Promise<Result<CheckoutAppearance | null, CheckoutAppearanceFailure>>;
  save: (companyId: CompanyId, appearance: CheckoutAppearance) => Promise<Result<null, CheckoutAppearanceFailure>>;
  imageAvailable: (companyId: CompanyId, imageId: ImageId) => Promise<Result<boolean, CheckoutAppearanceFailure>>;
  imageUrl: (imageId: ImageId) => Promise<Result<string | null, Readonly<{ message: string }>>>;
}>;
```

| Caso de uso | Entrada | Salida | Errores | Autorización |
| --- | --- | --- | --- | --- |
| `getCheckoutAppearance` | `companyId` | `CheckoutAppearance \| null` | `INVALID_STORED_DATA`, `PERSISTENCE_UNAVAILABLE` | Contexto privado (middleware) |
| `saveCheckoutAppearance` | `companyId`, `unknown` | `CheckoutAppearance` | `INVALID_CHECKOUT_APPEARANCE`, `INVALID_IMAGE`, `PERSISTENCE_UNAVAILABLE` | Contexto privado; el `companyId` sale de la sesión, nunca del formulario |
| `getPublicCheckoutAppearance` | `companyId` | `PublicAppearanceResult` | Ninguno: una falla devuelve `{ kind: "fallback" }`, y si falla el logo, `logoUrl: null` | Solo después de autorizar el acceso al pedido |
| `getCheckoutAppearancePreview` | `companyId` | `{ companyName, appearance, logoUrl, paymentSettings }` | `PERSISTENCE_UNAVAILABLE` | Contexto privado |

```ts
type PublicAppearanceResult =
  | Readonly<{ kind: "default" }>                                   // sin apariencia guardada
  | Readonly<{ kind: "custom"; appearance: PublicAppearance }>
  | Readonly<{ kind: "fallback" }>;                                 // lectura fallida o datos inválidos
```

`default` y `fallback` se ven igual para el comprador (apariencia de Yoyos), pero se distinguen en la observabilidad (12.2).

Reglas de `saveCheckoutAppearance`:

1. Valida con `parseCheckoutAppearance`; un color fuera del catálogo se rechaza.
2. Si hay `logoImageId`, `imageAvailable` comprueba que la imagen existe en el contexto de la empresa (RLS) y que es `public`.
3. `save` hace el `upsert` completo.
4. Devuelve la apariencia guardada, que pasa a ser la nueva versión publicada del editor.

La FK compuesta repite a nivel de base la comprobación del paso 2.

`composition.ts` expone la fachada:

```ts
checkoutAppearance.get(companyId)
checkoutAppearance.save(companyId, userId, value)   // registra checkout_appearance_saved
checkoutAppearance.getPublic(companyId)             // envuelve en withTenantIsolation(companyId)
checkoutAppearance.getPreview(companyId)            // apariencia + companyPaymentSettings.get + URLs de imágenes
```

`imageAvailable` lanza una excepción si `getCompanyId()` no coincide con el `companyId` recibido. Es un error de programación, no un `Result`, igual que en `companyPaymentSettings`.

## 8. Subida del logo

Se reutiliza `POST /api/images` sin cambios:

- Validación por contenido real: PNG/JPG/WEBP, hasta 10 MB y 8000 px por lado.
- La imagen se crea con visibilidad `public`; el editor avisa que el logo es visible para los compradores.
- El navegador comprueba tipo y tamaño antes de subir para responder al instante, pero el servidor es la fuente de verdad.
- La subida no publica nada: solo devuelve `{ id, url }` para el borrador. Al guardar, el caso de uso vuelve a verificar el logo.

## 9. Errores y su traducción

| Código | Origen | Editor (action) | Checkout público |
| --- | --- | --- | --- |
| `INVALID_CHECKOUT_APPEARANCE` | Validación | 422 · error junto al control | — |
| `INVALID_IMAGE` | Logo ajeno, privado o inexistente | 422 · «No pudimos usar ese logo. Súbelo de nuevo.» | — |
| `INVALID_STORED_DATA` | Fila corrupta | 503 · «No se pudo cargar la apariencia» | Apariencia predeterminada |
| `PERSISTENCE_UNAVAILABLE` | Base de datos | 503 · reintentar, conservando el borrador | Apariencia predeterminada |
| Subida: `INVALID_IMAGE` / `IMAGE_TOO_LARGE` | `POST /api/images` | Error bajo el control del logo; lo publicado no cambia | — |

## 10. Presentación

### 10.1 Tema del checkout

```tsx
type CheckoutThemeProps = Readonly<{ appearance: PublicCheckoutAppearance | null; children: ReactNode }>;
```

- Con `appearance === null` no emite estilos: el checkout se ve con los tokens globales, que son la paleta Yoyos con fondo Medio.
- En otro caso, obtiene `checkoutPalette(brandColor, background)` (o `catalogPalette` con `surface="catalog"`, [§15.7](#157-tema-y-catálogo-público)) y renderiza:

  ```html
  <style>[data-checkout-theme="…"]{--primary:#…;…}.dark [data-checkout-theme="…"]{--primary:#…;…}</style>
  <div data-checkout-theme="…" class="min-h-screen bg-background text-foreground">…</div>
  ```

- El valor del atributo lo genera `useId`: cada instancia aplica sus variables solo a su subárbol, y servidor y navegador producen el mismo valor.
- Los valores salen siempre del catálogo escrito en el código. Nunca se interpola texto del usuario en el CSS.
- Al limitar el alcance a `[data-checkout-theme]`, la marca no afecta al panel privado.

### 10.2 Cabecera

```tsx
type CheckoutBrandHeaderProps = Readonly<{ companyName: string; logoUrl: string | null }>;
```

- El logo va en una caja de hasta 40 × 160 px, con `object-contain` y una superficie clara neutra en ambos modos.
- Lleva `alt=""`, porque el nombre ya aparece al lado.
- Si la imagen falla (`onError`), se oculta y queda solo el nombre.

### 10.3 `routes/checkout.tsx`

```ts
type PageData = { …actual; appearance?: PublicCheckoutAppearance | null };
```

En el loader, después de un `orders.getCheckout(access)` exitoso, se llama a `checkoutAppearance.getPublic(access.companyId)`, en paralelo con la configuración de entrega y la vista de pago. El loader etiqueta la solicitud con `checkoutAppearance: result.kind`. Si es `custom`, valida la apariencia con `publicCheckoutAppearanceSchema` (respuesta propia) y la pone en `appearance`; en otro caso, `appearance: null`.

En la página:

- Todo el contenido se envuelve en `<CheckoutTheme>`.
- La cabecera actual se reemplaza por `<CheckoutBrandHeader>`.
- Se mantienen `Cache-Control: no-store` y `Referrer-Policy: no-referrer`, así que recargar muestra la última apariencia publicada.
- El `ErrorBoundary` no recibe ni muestra la marca.

### 10.4 `routes/buyer-payment.tsx` (redirección)

El pedido tiene checkout habilitado si y solo si `orders.getCheckout(access)` tiene éxito, porque `checkoutView` falla con `CHECKOUT_UNAVAILABLE` cuando `checkoutEnabledAt` es null. Así no se toca `getBuyerPaymentView`.

| Caso | Respuesta | `outcome` |
| --- | --- | --- |
| ID inválido o pedido inexistente | 404 con el error genérico | `unavailable` |
| `resolveBuyerAccess` con `PERSISTENCE_UNAVAILABLE` | 503 | `technical_failure` |
| `getCheckout` con éxito (pendiente, confirmado o cancelado) | 301 a `/checkout/:companyId/:orderId` | `redirected` |
| Sin checkout y `getBuyerPaymentView` con éxito | 200, página de pago | `rendered` |
| Sin checkout y pedido cancelado | 409 | `cancelled` |
| Otro error de `getCheckout` o `getBuyerPaymentView`, o vista inválida | 503 y `log.error` | `technical_failure` |

- Se conservan el `ErrorBoundary` genérico y las cabeceras `no-store` y `no-referrer`. El componente de página se conserva para los pedidos sin checkout (históricos, POS o manuales).
- `order-detail.tsx` usa `buyerLink`: enlaza a `/checkout/:companyId/:orderId` si el checkout está habilitado y el pedido no está cancelado, a `/pago/:orderId` si no hay checkout y a nada si está cancelado con checkout.
- `orders.getBuyerPaymentView` y la API de comprobantes se mantienen, porque el checkout los usa.

### 10.5 Editor (`routes/checkout-appearance-settings.tsx`)

Sigue el mock aprobado `a4` ([editor](../.impeccable/mocks/checkout-editable/a4-closed-light.png), [diálogo de colores](../.impeccable/mocks/checkout-editable/a4-dialog-light.png), [registro de aprobación](../.impeccable/mocks/checkout-editable/a4.json)). El registro de superficie de Impeccable se crea al implementarlo (T5).

Se registra como `settings/checkout-appearance` en las dos ramas del layout privado (`public-*` y `localized-*`). En `private-layout.tsx` se agrega `"appearance"` a la navegación activa. Los textos van en `app/locales.ts`.

```ts
// loader
type EditorLoaderData = Readonly<{ companyName: string; published: CheckoutAppearance; logoUrl: string | null }>;
// action
type EditorActionData = { success: true; appearance: CheckoutAppearance } | { error: CheckoutAppearanceFailure["code"] };
```

Estado local del borrador:

```ts
type EditorDraft = Readonly<{ appearance: CheckoutAppearance; logoUrl: string | null }>;
type EditorActivity = { kind: "idle" } | { kind: "uploading" } | { kind: "saving" };
type EditorFailure = { kind: "upload"; code: string } | { kind: "save"; code: CheckoutAppearanceFailure["code"] } | null;

// Derivados
const dirty = !sameAppearance(draft.appearance, published);
const canSave = dirty && activity.kind === "idle";
```

- **Color:** una fila con una sola muestra del modo activo en la vista previa (`light.primary` o `dark.primary`), el nombre del color, «Tono para modo claro/oscuro» y «Cambiar». Abre `<BrandColorDialog>`.
- **Diálogo de colores:** `role="dialog"` con título «Elige el color de tu marca»; cuadrícula de 3 × 3 implementada como `radiogroup`, con una muestra del modo activo y el nombre por opción, y «Predeterminado» en Yoyos. La opción marcada lleva borde e icono de verificación. Mantiene su propia selección hasta «Usar <color>», que actualiza `draft.appearance.brandColor`; «Cancelar», cerrar y Escape la descartan. Foco inicial en la opción actual, flechas para moverse, devolución del foco a la fila al cerrar.
- **Fondo:** control segmentado Suave / Medio / De marca. Debajo, una línea de ayuda por opción nombra el color elegido ([§15.8](#158-editor-vista-previa-y-stories)).
- **Subida:** `POST /api/images`; si sale bien, se actualizan `draft.logoUrl` y `logoImageId`.
- **Guardar:** `fetcher.submit(appearance, { method: "post", encType: "application/json" })`. Al terminar muestra «Apariencia actualizada», y lo guardado pasa a ser la nueva versión publicada.
- **Descartar:** borrador = publicado. **Restablecer:** borrador = `defaultCheckoutAppearance`; hace falta guardar para publicarlo.
- **Salida con cambios:** `useBlocker(dirty)` muestra un diálogo con «Seguir editando» y «Descartar y salir».
- **Errores:** una subida o un guardado fallido conservan el borrador y ofrecen reintentar.
- **Celular:** una sola columna con las pestañas «Editar» y «Vista previa» sobre el mismo estado.

### 10.6 Vista previa (`routes/checkout-appearance-preview.tsx`)

- Se registra como `settings/checkout-appearance/preview` **fuera** del layout privado, pero con el mismo middleware de acceso. Para ello, el middleware se extrae de `private-layout.tsx` a `app/private-access.ts` y ambos lo reutilizan.
- **Loader:** `checkoutAppearance.getPreview(companyId)`.
- **Componentes reales:** renderiza `CheckoutForm`, `DeliverySummary` y `BuyerPaymentContent` dentro de `CheckoutTheme`.
- **Datos:** `preview-fixtures.ts` aporta un `PublicCheckoutResponse` ficticio (pendiente y confirmado) y un `BuyerPaymentView` con importes ficticios y los `settings` reales del negocio, o de ejemplo si no hay.
- **Sin action:** confirmar, pagar y subir comprobante reciben *handlers* vacíos. Además, el iframe usa `sandbox="allow-scripts allow-same-origin"` sin `allow-forms`, así que un formulario no puede enviarse aunque falle un *handler*.
- **Protocolo:** el iframe envía `ready`, y el editor responde con un `update` en cada cambio. El iframe aplica `mode` alternando `.dark` en su `<html>`, sin tocar la preferencia guardada.
- **Estados:** **Revisión** muestra el pedido pendiente con el formulario; **Pago**, el pedido confirmado con los medios de pago. La barra superior siempre indica «Vista previa · Datos de ejemplo».
- **Dimensiones:** el iframe se fija en 390 px (celular) o 1280 px (escritorio) y se escala con `transform: scale()` para caber en el lienzo. Como tiene su propio viewport, los breakpoints reales del checkout funcionan.
- **Marco:** el del teléfono es solo CSS. El contenido es el checkout real, no el del mock; las tarjetas «Tus datos / Editar» del mock eran ilustrativas.

Se descartaron las *container queries* porque obligarían a reescribir las clases responsive del checkout público.

## 11. Seguridad y privacidad

- **Escritura:** solo a través de la action del editor, con `companyId` tomado de `privateUserContext` y RLS activo.
- **Lectura pública:** solo después de un `orders.getCheckout` exitoso. Con un enlace inválido no se consulta la apariencia y no se revela la marca.
- **Respuesta al comprador:** solo `logoUrl`, `brandColor` y `background`; ni IDs ni fechas.
- **Redirección de `/pago`:** revela el `companyId` del pedido a quien tenga el enlace, el mismo acceso que daba la página eliminada.
- **CSS:** generado solo a partir del catálogo del código; el vendedor no aporta ningún valor de color.
- **Vista previa:** autenticada, sin action, con el iframe en *sandbox* y mensajes validados por origen y esquema.

## 12. Observabilidad

Logs de Pino según [logging-conventions.md](logging-conventions.md). `requestId` y `companyId` los añade el contexto de la solicitud.

### 12.1 Eventos

```jsonc
// info · después de guardar
{ "event": "checkout_appearance_saved", "requestId": "…", "companyId": "…", "userId": "…",
  "logoImageId": "…",            // solo si hay logo
  "hasLogo": true, "brandColor": "forest", "background": "brand_tint",
  "isDefault": false }

// error · repositorio
{ "event": "unable_to_load_checkout_appearance", "requestId": "…", "companyId": "…",
  "operation": "get_checkout", "errorCode": "PERSISTENCE_UNAVAILABLE", "err": { … } }

// error · repositorio
{ "event": "unable_to_save_checkout_appearance", "requestId": "…", "companyId": "…",
  "logoImageId": "…",            // solo si hay logo
  "errorCode": "PERSISTENCE_UNAVAILABLE", "err": { … } }

// error · repositorio
{ "event": "invalid_stored_checkout_appearance", "requestId": "…", "companyId": "…",
  "errorCode": "INVALID_STORED_DATA", "invalidFields": ["brandColor"] }
```

Notas:

- **`outcome`:** cada ruta nueva lo fija explícitamente, incluso cuando sale bien. Si no, el middleware infiere `invalid_input` para cualquier 200.
- **Rutas:** se normalizan `/settings/checkout-appearance`, `/settings/checkout-appearance/preview` y `/pago/:orderId` en `logger.ts`, con reglas equivalentes en `newrelic.cjs`. Sin esto, React Router las registra todas como `/{*splat}`.
- **Nunca se registran:** datos del comprador, `orderId`, URLs de imágenes, medios de cobro ni cuerpos de solicitud.

## 13. Plan de trabajo

Las tareas, pensadas para trabajarse en paralelo, están en [apariencia-del-checkout-tareas.md](apariencia-del-checkout-tareas.md).

## 14. Pruebas

Un `test` por comportamiento. Los casos marcados con *(matriz)* se repiten para cada color del catálogo × fondo × modo.

### `domain/checkout-colors.test.ts`

Reemplazado por las pruebas de [§15.9](#159-pruebas) en T7. Lo que sigue es la versión construida en T0.

```ts
describe("catalog")
  test("defines every color of CheckoutBrandColor with light and dark tokens")
  test("matches the base tones of the product definition")
  test("uses Yoyos as the default color")

describe("primary color")
  test("is readable as text on the page, cards and its brand background")   // matriz
  test("keeps button text readable on primary, hover and pressed")           // matriz
  test("makes hover and pressed visibly different from primary")            // matriz

describe("focus ring")
  test("reaches 3:1 against the page and cards")                             // matriz

describe("accent surface")
  test("keeps accent and system text readable on it")                        // matriz

describe("page background")
  test("is pure white for the white option in light mode")
  test("keeps the system dark background for the white option in dark mode")
  test("keeps the system background for the neutral option")
  test("uses the brand background of the color for the brand option in both modes")
  test("keeps system text and muted text readable on it")                    // matriz
```

### `domain/checkout-appearance.test.ts`

```ts
describe("parseCheckoutAppearance")
  test("accepts a complete appearance")
  test("accepts an appearance without logo")
  test("accepts every color of the catalog")
  test("rejects %s as brand color")            // "#2F6B4F", "green", "Bosque", "", null
  test("rejects a logo id that is not a UUID")
  test("rejects a background outside the three options")
  test("rejects unknown fields")

describe("isDefaultCheckoutAppearance")
  test("recognizes the Yoyos default appearance")
  test("treats a different color, background or logo as customized")
```

### `application/checkout-appearance.test.ts`

```ts
describe("saveCheckoutAppearance")
  test("saves logo, color and background together")
  test("saves an appearance without logo without checking images")
  test("rejects a logo that is not an available image of the company and saves nothing")
  test("rejects an invalid appearance and saves nothing")
  test("returns the failure when the logo cannot be checked")
  test("returns the failure when saving fails")

describe("getPublicCheckoutAppearance")
  test("returns the custom appearance with the logo URL and no identifiers")
  test("returns default when the company has no saved appearance")
  test("returns fallback when the appearance cannot be read")
  test("keeps the appearance without logo when the logo URL cannot be resolved")
  test("returns no logo URL when the appearance has no logo")
```

### `infrastructure/checkout-appearance-repository.integration.test.ts`

```ts
describe("loadCheckoutAppearance")
  test("returns null when the company has no appearance")
  test("returns the saved appearance of the company")
  test("does not return the appearance of another company")

describe("persistCheckoutAppearance")
  test("creates the appearance on the first save")
  test("replaces the whole appearance on later saves")
  test("keeps one appearance per company")
  test("removes the logo when saved without one")
  test("rejects a logo that belongs to another company")
  test("rejects a color outside the catalog at the database")
  test("logs and returns PERSISTENCE_UNAVAILABLE when the database fails")
```

### `presentation/checkout-theme.test.tsx`

```ts
describe("CheckoutTheme")
  test("renders no styles when the company has no appearance")
  test("scopes light and dark variables to the checkout")
  test("renders only catalog colors in the style tag")

describe("CheckoutBrandHeader")
  test("shows the logo next to the company name")
  test("shows only the company name when there is no logo")
  test("hides the logo and keeps the name when the image fails to load")
```

### `presentation/preview-protocol.test.ts`

```ts
describe("preview messages")
  test("applies a valid update from the same origin")
  test("ignores messages from another origin")
  test("ignores messages that do not match the schema")
  test("announces readiness to the editor once loaded")
```

### `app/routes/checkout-appearance-settings.test.ts`

```ts
describe("editor loader")
  test("returns the published appearance and logo URL of the session company")
  test("returns the Yoyos default when the company has no appearance")

describe("editor action")
  test("saves the appearance for the session company, ignoring any company in the body")
  test("responds 422 for an invalid appearance or a color outside the catalog")
  test("responds 422 for a logo of another company")
  test("responds 503 and keeps the published appearance when saving fails")
  test("tags the request as save_checkout_appearance with its outcome")
```

### `app/routes/checkout.test.ts` (casos nuevos)

```ts
describe("checkout appearance")
  test("includes the company appearance after authorizing the order")
  test("does not read the appearance for an unauthorized link")
  test("uses the default appearance when the company has none")
  test("uses the default appearance and still loads the order when reading it fails")
  test("tags the request with default, custom or fallback appearance")
```

### `app/routes/buyer-payment.test.ts`

```ts
describe("legacy payment link")
  test("redirects permanently to the checkout of the order")
  test("renders the payment page for an order without checkout")
  test("responds 404 for an unknown order")
  test("responds 404 for an invalid order id")
  test("responds 503 when the order cannot be resolved")
```

### `tests/e2e/checkout-appearance.spec.ts`

```ts
describe("checkout appearance editor")
  test("shows the published appearance and a preview with sample data")
  test("updates the preview without changing the public checkout")
  test("publishes logo, color and background together when saving")
  test("applies the new appearance to a previously shared link on reload")
  test("keeps the draft and the published appearance when an upload fails")
  test("chooses a color in the dialog and shows it in the preview without publishing")
  test("keeps the previous color when the dialog is cancelled")
  test("shows the swatch of the active preview mode in the row and the dialog")
  test("restores the published appearance when discarding")
  test("requires saving to publish a reset")
  test("asks to keep editing or discard when leaving with changes")
  test("switches the preview between phone and desktop, light and dark, review and payment")
  test("never confirms orders or registers payments from the preview")
  test("can be completed with the keyboard on a phone screen")

describe("buyer checkout with appearance")
  test("shows the logo and brand colors in every order state")
  test("shows the company name when the logo fails to load")
  test("shows the generic error without branding for an unauthorized link")
  test("keeps delivery quote and payment flows working")
```

### `tests/e2e/buyer-payment.spec.ts` (reescrito)

```ts
describe("legacy payment link")
  test("opens the order checkout from the order detail")
  test("redirects an old payment link to the order checkout")
  test("renders the payment page for an order without checkout")
  test("shows the generic error for an unknown payment link")
```

## 15. Ajuste: fondos con tono y paleta por color

**Estado:** implementado (T6 y T7, 20 de octubre de 2026). Parte de la [definición de producto](apariencia-del-checkout.md) cerrada en `4db4d522` (Todoist 6hpQqCf4X2RX2fr3, decisiones del CTO del 19 de octubre de 2026). Base: `main` en `c5563e16`. Tareas: T6 y T7 de [apariencia-del-checkout-tareas.md](apariencia-del-checkout-tareas.md#t6--fondos-suave-y-medio).

### 15.1 Objetivo técnico

Al terminar, `CheckoutTheme` redefine en el checkout y en la vista previa todos los tokens de color no semánticos que usan sus componentes, tomados de la paleta del color elegido, en claro y en oscuro. Los fondos Blanco y Neutro pasan a ser Suave y Medio, dos tonos de esa paleta, con sus identificadores renombrados en Postgres y en el código sin invalidar ninguna fila. El catálogo público sigue pintándose con el catálogo de ocho tonos y la regla de fondos anteriores. Un test de dominio recorre 9 colores × 3 fondos × 2 modos y comprueba contraste, escala de fondos y criterio de construcción. No cambia ningún layout, componente, contrato entre aplicaciones ni caso de uso.

```text
CompanyCheckoutAppearance.background (soft | medium | brand_tint)
        │
        ├── checkout y vista previa ──> checkoutPalette(color, fondo) ──> 19 tokens (claro y oscuro)
        └── catálogo público ────────> catalogPalette(color, fondo)  ──> 8 tokens + background (sin cambios visuales)
```

### 15.2 Decisiones

| Tema | Decisión |
| --- | --- |
| Identificadores de fondo | Se renombran: `white` → `soft` y `neutral` → `medium`; `brand_tint` se conserva. Un concepto, un nombre en base, código, logs y pantalla. |
| Migración | `rename_checkout_backgrounds`, generada con `prisma migrate dev --create-only` y con su SQL reemplazado por dos `ALTER TYPE "CheckoutBackground" RENAME VALUE`. Solo cambia el catálogo de Postgres: no reescribe filas ni bloquea la tabla, y toda fila guardada queda con el valor equivalente. |
| Valor predeterminado | `defaultCheckoutAppearance` = sin logo, `yoyos`, `medium`. Sin fila, el checkout sigue sin emitir estilos: los tokens globales son exactamente la paleta Yoyos con Medio. |
| Tokens de la paleta | Los 19 tokens de color no semánticos de `docs/design-tokens.json` que usa el checkout ([§15.6](#156-paleta-por-color)). Los semánticos (`destructive*`, `success*`, `warning*`, `error*`, `info*`) quedan globales. |
| Forma de los datos | Cada color guarda 15 tonos por modo como HEX escritos en el código; `checkoutPalette` los expande a los 19 tokens con alias fijos. Sin conversión de color en tiempo de ejecución. |
| Criterio único | Una tabla de posiciones OKLCH por tono, igual para los ocho colores no Yoyos, con el matiz del tono principal de cada uno. El test de dominio la verifica; no hay generador en el repositorio. |
| Paleta Yoyos | Toma los 19 tokens de `docs/design-tokens.json` (Medio = `background` global); solo Suave y De marca son tonos propios. |
| Catálogo público | `CheckoutTheme` recibe `surface="catalog"` en `catalog-sections.tsx` y usa `catalogPalette`, que es el `checkoutPalette` actual renombrado, con sus valores congelados. |
| Tarjetas en claro | `#FFFFFF` en los nueve colores, como pide el producto («superficie blanca de lectura»). |
| `--brand-background` | La paleta del checkout deja de emitirlo: ningún componente lo usa; su valor llega como `--background` cuando el fondo es De marca. |
| Umbrales del test | 4,5:1 y 3:1 fijados por producto. Iniciales y ajustables, iguales para todas las paletas: luminosidad ±0,02 y matiz ±20° respecto de la tabla, distancia OKLab ≥ 0,015 entre fondos vecinos, 1,15:1 para bordes decorativos. |

### 15.3 Estado verificado

| Pieza | Ubicación | Estado |
| --- | --- | --- |
| Enum `CheckoutBackground` (`white`, `neutral`, `brand_tint`) | `prisma/schema.prisma`, migración `20261010142043_add_company_checkout_appearance` | Se renombran dos valores |
| `checkoutBackgrounds`, `defaultCheckoutAppearance` (`neutral`) | `domain/checkout-appearance.ts` | Cambian los literales |
| `checkoutBrandColorCatalog` (9 colores × 8 tonos × 2 modos), `checkoutPalette` | `domain/checkout-colors.ts` | Pasa a ser `catalogPalette`; se añade la paleta completa |
| `CheckoutTheme`, `checkoutThemeCss` | `presentation/checkout-theme.tsx` | Escribe solo `primary*`, `ring`, `accent*`, `brand-background` y `background`; se añade `surface` |
| `CheckoutTheme` en el checkout | `app/components/checkout-sections.tsx` (`CheckoutShell`), usado por `routes/checkout.tsx` y la vista previa | Sin cambios |
| `CheckoutTheme` en el catálogo | `app/components/catalog-sections.tsx` (`CatalogShell`) | Pasa `surface="catalog"` |
| Esquema público | `presentation/checkout-appearance-schemas.ts` | Usa el enum de dominio |
| Editor | `routes/checkout-appearance-settings.tsx` (líneas 161–219), textos en `app/locales.ts` (`backgroundWhite`, `backgroundNeutral`, `backgroundBrandTintHint`) | Cambian etiquetas y ayudas |
| Stories | `presentation/checkout-theme.stories.tsx` (`backgroundNames`) | Cambian los nombres; las historias por color ya muestran los tres fondos |
| Botón principal | `app/components/ui/button.tsx` usa `--primary-hover` y `--primary-pressed` | Sin cambios |
| Bordes por defecto | `app/app.css`: `* { @apply border-border; }` | Toma `--border` del ámbito del tema sin cambios |
| Contrato `shared/contracts` | — | La apariencia no viaja a mobile; nada cambia |

### 15.4 Brechas que cierra

1. Los fondos Blanco y Neutro no tienen el matiz del color ([§15.6](#156-paleta-por-color)).
2. `--border`, `--input`, `--card`, `--muted`, `--foreground` y sus variantes quedan globales con cualquier color ([§15.6](#156-paleta-por-color)).
3. Los identificadores `white` y `neutral` ya no describen la opción ([§15.5](#155-identificadores-de-fondo-y-migración)).
4. No existe un criterio común verificado para construir las paletas ni un test de contraste sobre todas las superficies ([§15.9](#159-pruebas)).
5. El catálogo público comparte la función de paleta con el checkout y cambiaría con ella ([§15.7](#157-tema-y-catálogo-público)).
6. El editor muestra Blanco y Neutro y solo tiene ayuda para De marca ([§15.8](#158-editor-vista-previa-y-stories)).

### 15.5 Identificadores de fondo y migración

```prisma
enum CheckoutBackground {
  soft        // Suave (antes white)
  medium      // Medio (antes neutral)
  brand_tint  // De marca
}
```

```sql
-- migrations/<timestamp>_rename_checkout_backgrounds/migration.sql
ALTER TYPE "CheckoutBackground" RENAME VALUE 'white' TO 'soft';
ALTER TYPE "CheckoutBackground" RENAME VALUE 'neutral' TO 'medium';
```

- Se genera con `pnpm exec prisma migrate dev --create-only --name rename_checkout_backgrounds` tras editar el esquema. Prisma propone recrear el enum y convertir la columna, lo que fallaría con filas `white`; ese SQL se reemplaza por las dos sentencias de arriba.
- `RENAME VALUE` actualiza `pg_enum`: las filas guardan el OID del valor, así que cada fila `white` se lee como `soft` sin reescribirse. Corre dentro de la transacción de la migración y no bloquea `CompanyCheckoutAppearance` más que un instante.
- `brand_tint` no cambia. No hay valor por defecto en la columna; el predeterminado vive en el dominio.
- **Despliegue:** la migración corre antes de arrancar la versión nueva. Durante ese intervalo, una instancia antigua que lea `soft` obtiene `INVALID_STORED_DATA` y el comprador ve la apariencia predeterminada; un guardado con `white` falla con 503 y el editor ofrece reintentar. No se pierde ni se corrompe nada.
- Nada en el código acepta los identificadores antiguos: tras la migración no existen en la base, y el esquema del `postMessage` se carga en la misma versión que el editor.

### 15.6 Paleta por color

**Tokens que usa el checkout.** Clases presentes en `checkout-sections.tsx`, `routes/checkout.tsx`, `buyer-payment-content.tsx`, `checkout-brand-header.tsx`, `checkout-preview-page.tsx` y `components/ui/*`, más el borde por defecto de `app.css` y los estados de `button.tsx`:

`background`, `foreground`, `card`, `card-foreground`, `popover`, `popover-foreground`, `primary`, `primary-foreground`, `primary-hover`, `primary-pressed`, `secondary`, `secondary-foreground`, `muted`, `muted-foreground`, `accent`, `accent-foreground`, `border`, `input`, `ring`.

Quedan globales `destructive*`, `success*`, `warning*`, `error*` e `info*` (producto: colores semánticos), la superficie blanca del logo (`checkout-brand-header.tsx`) y las imágenes de pago.

**Tipos** (`domain/checkout-colors.ts`):

```ts
/** The 15 tones each color writes per mode. */
export type CheckoutPaletteTones = Readonly<{
  soft: HexColor; medium: HexColor; "brand-background": HexColor;          // background scale
  foreground: HexColor; card: HexColor; muted: HexColor; "muted-foreground": HexColor;
  border: HexColor; input: HexColor;
  primary: HexColor; "primary-foreground": HexColor; "primary-hover": HexColor; "primary-pressed": HexColor;
  accent: HexColor; "accent-foreground": HexColor;
}>;
export const checkoutTokenNames = ["background", "foreground", "card", "card-foreground", "popover", "popover-foreground",
  "primary", "primary-foreground", "primary-hover", "primary-pressed", "secondary", "secondary-foreground",
  "muted", "muted-foreground", "accent", "accent-foreground", "border", "input", "ring"] as const;
export type CheckoutTokens = Readonly<Record<(typeof checkoutTokenNames)[number], HexColor>>;
export type CheckoutPalette = Readonly<{ light: CheckoutTokens; dark: CheckoutTokens }>;

export const checkoutColorPalettes: Readonly<Record<CheckoutBrandColor, Readonly<{ light: CheckoutPaletteTones; dark: CheckoutPaletteTones }>>>;
export function checkoutPalette(brandColor: CheckoutBrandColor, background: CheckoutBackground): CheckoutPalette;
```

- `CheckoutPaletteTones` existe porque cuatro pares de tokens son siempre iguales en el sistema y en todas las paletas; guardarlos una vez evita 72 literales duplicados.
- `checkoutPalette` expande: `background` = el tono del fondo elegido (`soft`, `medium` o `brand-background`); `card-foreground`, `popover-foreground` y `secondary-foreground` = `foreground`; `popover` = `card`; `secondary` = `muted`; `ring` = `primary`. Son los mismos alias que ya cumplen los tokens globales.
- Los tipos de 5.2 pasan a `CatalogTokens`, `CatalogPalette` y `catalogPalette`; `checkoutBrandColorCatalog` conserva nombre y valores.

**Paleta Yoyos.** Sus 15 tonos de cada modo salen de `tokens.colors.light` / `tokens.colors.dark` de `docs/design-tokens.json`, con `medium` = `background` global (`#F7F4EF` y `#1C1B1D`). Solo `soft` y `brand-background` son tonos propios, construidos con la tabla de abajo y el matiz de `#8C552D` / `#D5A16C`; el `brand-background` actual (`#F7EFE6`, `#1F1B19`) es el punto de partida y se ajusta si no cumple la distancia entre fondos. Así, una empresa sin fila o con Yoyos y Medio ve exactamente los colores de hoy.

**Criterio de construcción de los otros ocho.** Cada tono toma el matiz OKLCH del tono principal del mismo modo, la luminosidad L de la tabla y un croma C = mín(C máx de la tabla, C del tono principal). Las luminosidades son las de los tokens globales de Yoyos, así que todas las paletas ocupan las mismas posiciones relativas. El valor se redondea a HEX y se escribe en `checkoutColorPalettes`.

| Tono | Claro L | Claro C máx | Oscuro L | Oscuro C máx |
| --- | --- | --- | --- | --- |
| `soft` (Suave) | 0,985 | 0,006 | 0,205 | 0,006 |
| `medium` (Medio) | 0,968 | 0,012 | 0,224 | 0,012 |
| `brand-background` (De marca) | 0,945 | 0,024 | 0,245 | 0,020 |
| `card` | `#FFFFFF` | — | 0,268 | 0,012 |
| `foreground` | 0,258 | 0,012 | 0,933 | 0,012 |
| `muted` | 0,930 | 0,014 | 0,309 | 0,014 |
| `muted-foreground` | 0,497 | 0,025 | 0,750 | 0,025 |
| `border` | 0,873 | 0,020 | 0,388 | 0,020 |
| `input` | 0,602 | 0,030 | 0,608 | 0,030 |
| `accent` | 0,920 | 0,030 | 0,336 | 0,035 |

Tonos fuera de la tabla: `primary` es el tono principal del producto (no cambia); `primary-foreground` es `#FFFFFF` en claro y `#1C1B1D` en oscuro; `primary-hover` y `primary-pressed` conservan los valores actuales del catálogo (ya cumplen 1,15:1 y 1,3:1 frente a `primary`); `accent-foreground` = `primary`.

La tabla se comprobó durante el diseño para los ocho colores: con estos valores todas las parejas de [§15.9](#159-pruebas) superan el mínimo y el redondeo a HEX desvía el matiz como mucho 13° y la luminosidad menos de 0,002. Al implementar, el brand-background de Yoyos pasó de `#F7EFE6`/`#1F1B19` a `#FAE9DE`/`#271F16` por la distancia con Medio, y el mínimo de `primary-pressed` de Yoyos en el test es 1,15:1 (su token global oscuro llega a 1,18:1). Si al implementar un tono no cumple, se ajusta solo ese tono dentro de las tolerancias de la tabla; si hace falta salir de ellas, se ajusta la fila de la tabla para todos los colores.

Ejemplo (Bosque, claro): Suave `#F7FBF9`, Medio `#EEF7F2`, De marca `#E0F2E8`, texto `#1F2522`, atenuado `#E0EBE5`, texto secundario `#56675E`, borde `#CADAD1`, campo `#72877B`, realce `#D4EBDE`.

### 15.7 Tema y catálogo público

```tsx
type CheckoutThemeProps = Readonly<{
  appearance: PublicCheckoutAppearance | null;
  surface?: "checkout" | "catalog";   // "checkout" por defecto
  children: ReactNode;
}>;
export function checkoutThemeCss(appearance: Pick<PublicCheckoutAppearance, "brandColor" | "background">, scope: string, surface?: "checkout" | "catalog"): string;
```

- `surface="checkout"` usa `checkoutPalette`; `surface="catalog"` usa `catalogPalette`. El resto del componente (ámbito `useId`, `<style>` en SSR, `.dark`, `appearance === null` sin estilos) no cambia.
- `CatalogShell` (`app/components/catalog-sections.tsx`) es el único llamador con `surface="catalog"`. `CheckoutShell` y la vista previa no cambian.
- Sin `appearance`, ninguna de las dos superficies emite estilos, igual que hoy.
- Cuando se decida extender la paleta al catálogo, basta con quitar la prop en `CatalogShell` y borrar `catalogPalette` con su catálogo de ocho tonos, salvo `name` y `primary`.

### 15.8 Editor, vista previa y stories

- **Editor:** el mapa de etiquetas de `checkout-appearance-settings.tsx` pasa a `{ soft, medium, brand_tint }`. La línea de ayuda se muestra para la opción activa, sea cual sea, con su texto. Mismo `ToggleGroup`, mismas clases.
- **Textos** (`app/locales.ts`): `backgroundWhite` y `backgroundNeutral` se sustituyen por `backgroundSoft` y `backgroundMedium`; `backgroundBrandTintHint` cambia de texto y se añaden `backgroundSoftHint` y `backgroundMediumHint`.

  | Clave | es | pt |
  | --- | --- | --- |
  | `backgroundSoft` | Suave | Suave |
  | `backgroundMedium` | Medio | Médio |
  | `backgroundBrandTint` | De marca | Da marca |
  | `backgroundSoftHint` | Usa el fondo más claro de {{color}}. En modo oscuro cambia solo. | Usa o fundo mais claro de {{color}}. No modo escuro muda sozinho. |
  | `backgroundMediumHint` | Usa un fondo claro de {{color}}. En modo oscuro cambia solo. | Usa um fundo claro de {{color}}. No modo escuro muda sozinho. |
  | `backgroundBrandTintHint` | Usa el fondo con más color de {{color}}. En modo oscuro cambia solo. | Usa o fundo com mais cor de {{color}}. No modo escuro muda sozinho. |

- **Restablecer** usa `defaultCheckoutAppearance`, que ya queda con `medium`.
- **Vista previa:** sin cambios de código; recibe la paleta nueva a través de `CheckoutTheme`. El protocolo valida `background` con el enum renombrado.
- **Stories:** `backgroundNames` = `{ soft: "Suave", medium: "Medio", brand_tint: "De marca" }`. Las historias por color ya muestran los tres fondos lado a lado en cada modo, que es lo que pide la revisión color por color.
- `app/components/ui/radio-group.stories.tsx` usa «Blanco» y «Neutro» como texto de ejemplo genérico: no es la apariencia y no se toca.

### 15.9 Pruebas

Contraste con la luminancia relativa de WCAG (helper actual del test). Luminosidad, croma y matiz en OKLCH con un helper de unas diez líneas que vive en el test. Las pruebas con matriz usan `test.each` y su título incluye color, fondo y modo; el mensaje de cada `expect` nombra el elemento y las dos superficies, así un fallo dice qué tono corregir.

**`domain/checkout-colors.test.ts`** (reescrito)

```ts
describe("palettes")
  test("defines the same tones for every color in light and dark mode")
  test("keeps the main tones of the product definition")
  test("uses the global Yoyos tokens for the Yoyos palette, with Medio as the system background")
  test("uses white cards in light mode for every color")
  test("uses white text on buttons in light mode and near black in dark mode")
  test("expands the tones into every token the checkout uses and no semantic token")

describe("palette construction")                                              // 8 colores × 2 modos
  test.each("$color · $mode places every derived tone at the lightness of the shared scale")
  test.each("$color · $mode derives every tinted tone from the hue of its main tone")

describe("backgrounds")
  test("maps Suave, Medio and De marca to their tones of the chosen palette")
  test.each("$color · $mode orders Suave, Medio and De marca from the most sober to the most tinted")   // 9 × 2
  test.each("$color · $mode keeps the three backgrounds visibly distinct")                              // 9 × 2
  test("never uses pure white or an untinted gray as a background")

describe("contrast")                                                          // 9 × 3 × 2 = 54
  test.each("$color · $background · $mode main and secondary text reach 4.5:1 on the page, cards and muted areas")
  test.each("$color · $background · $mode button text reaches 4.5:1 on primary, hover and pressed")
  test.each("$color · $background · $mode brand-colored links reach 4.5:1 on the page, cards and the selection highlight")
  test.each("$color · $background · $mode selection highlight text reaches 4.5:1 on its surface")
  test.each("$color · $background · $mode field and control borders reach 3:1 on the page and cards")
  test.each("$color · $background · $mode the focus ring reaches 3:1 on the page and cards")
  test.each("$color · $background · $mode decorative borders stay visible on the page and cards")
  test.each("$color · $mode hover and pressed are visibly different from primary")

describe("public catalog palette")
  test("keeps the pre-adjustment tones of every color")
  test("shows Suave as the former white background and Medio as the former neutral one")
  test("keeps the former De marca background of each color")
```

Reglas del test: «escala» = en claro L(Suave) > L(Medio) > L(De marca); en oscuro L(Suave) < L(Medio) < L(De marca). «Distintos» = distancia OKLab ≥ 0,015 entre vecinos. «Sin teñir» = `#FFFFFF` o C < 0,004, salvo el Medio de Yoyos, que es el global por regla de producto. Construcción y matiz: solo los ocho colores no Yoyos; el matiz se mide en tonos con C ≥ 0,005.

**`domain/checkout-appearance.test.ts`** (cambios)

```ts
  test("uses Yoyos with Medio as the default appearance")
  test("rejects a background outside the three options")          // ejemplos: "white", "neutral", ""
```

**`presentation/checkout-theme.test.tsx`** (cambios)

```ts
describe("CheckoutTheme")
  test("sets borders, fields, cards, muted areas and texts from the chosen palette")
  test("keeps the pre-adjustment colors and the global borders for the public catalog")
  test("renders only palette colors in the style tag")              // renombra "renders only catalog colors…"
```

**`app/components/catalog-sections.test.tsx`** (nuevo)

```ts
describe("CatalogShell")
  test("paints the public catalog with the former white background and the global borders")
```

**`infrastructure/checkout-appearance-repository.integration.test.ts`** (cambios)

```ts
  test("rejects the former white identifier at the database")
```

Los demás tests de la feature solo cambian literales (`white` → `soft`, `neutral` → `medium`).

**E2E**

| Archivo | Cambio |
| --- | --- |
| `tests/e2e/checkout-appearance.spec.ts` | Radios «Suave», «Medio»; valor guardado `medium`. Nuevo: `test("names the chosen color in the help line of each background")`. |
| `tests/e2e/checkout-appearance-preview.spec.ts` | Literales `soft`/`medium`. Nuevo: `test("changes borders and fields with the brand color in the preview")`. |
| `tests/e2e/checkout-appearance-buyer.spec.ts` | `shows the logo and brand colors in every order state` comprueba además que el borde de una tarjeta es el `border` de Bosque y no `#DCD4C9`. |
| `tests/e2e/public-catalog.spec.ts` | Sin cambios; el aspecto lo cubre `CatalogShell`. |

**Comprobaciones manuales**

- Con datos de desarrollo que tengan filas `white` y `neutral`, aplicar la migración y comprobar que el editor muestra «Suave» y «Medio» y que el checkout carga sin `invalid_stored_checkout_appearance`.
- Revisión visual con Impeccable de las historias de `checkout-theme.stories.tsx` (nueve colores × tres fondos, claro y oscuro) y del checkout real con dos colores, comparadas lado a lado; registrar el resultado en el registro de superficie.
- Catálogo público con Bosque y Suave guardados: fondo blanco en claro, bordes globales, botón `#2F6B4F`.

### 15.10 Observabilidad

No hay eventos nuevos. `checkout_appearance_saved.background` pasa a registrar `soft`, `medium` o `brand_tint`. Si durante el despliegue una instancia antigua lee un valor renombrado, el evento existente `invalid_stored_checkout_appearance` (error, `invalidFields: ["background"]`) lo deja visible.

### 15.11 Límites y comprobaciones al implementar

- Fuera del ajuste: panel privado, catálogo público, colores semánticos, layout y componentes, colores HEX libres, colores nuevos.
- Verificar que Postgres del entorno es 10 o superior (`RENAME VALUE`) y que, tras la migración, `prisma migrate diff --from-migrations … --to-schema-datamodel …` no reporta diferencias.
- Verificar que la paleta Yoyos con los tokens globales cumple el test de contraste con sus nuevos Suave y De marca; si un global no cumple, se ajusta el fondo de Yoyos, nunca el token global.
- Comprobar con Impeccable que ningún componente del checkout usa un color literal (`bg-white`, `text-stone-*`) que escape a la paleta; si aparece, se cambia por su token, sin tocar el layout.

## Estado

**Construido:** T0 a T5 de [apariencia-del-checkout-tareas.md](apariencia-del-checkout-tareas.md) están integradas en la rama de la feature (`jorgeluis594/checkout-editable`). Incluye la migración `20261010142043_add_company_checkout_appearance`, el editor con vista previa en vivo, el checkout con marca y la redirección de `/pago/:orderId`.

**Ajuste del 19 de octubre de 2026 (construido el 20 de octubre):** T6 (identificadores de fondo y editor) y T7 (paleta por color y contraste), definidos en [§15](#15-ajuste-fondos-con-tono-y-paleta-por-color) y en [apariencia-del-checkout-tareas.md](apariencia-del-checkout-tareas.md#t6--fondos-suave-y-medio).

**Pendiente:** la verificación en staging de logs y transacciones de New Relic de las cuatro rutas, a cargo del equipo que despliega. El detalle está en el criterio de T5 de [apariencia-del-checkout-tareas.md](apariencia-del-checkout-tareas.md#t5--cierre-del-lanzamiento).
