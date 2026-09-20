# ADR 001: Monolito full-stack con Express y React Router

- Estado: aceptada
- Fecha: 2026-09-20

## Contexto

La aplicación será inicialmente un ecommerce monolítico. Debe ofrecer:

- una web React renderizada en el servidor;
- una API para la aplicación móvil e integraciones externas;
- checkout y pasarela de pagos;
- webhooks de pagos y mensajería;
- entrega de imágenes, PDF y otros archivos;
- estado navegable y compartible mediante la URL;
- acceso directo a los casos de uso desde el renderizado del servidor, sin llamadas HTTP internas.

Checkout y envíos podrían migrarse posteriormente a aplicaciones con infraestructura propia.

## Decisión

La aplicación `apps/api` será un monolito modular construido con:

- Express 5 como servidor HTTP;
- React Router 7 en Framework Mode para SSR, rutas web, loaders y actions;
- el adaptador oficial `@react-router/express`;
- React y shadcn/ui para la interfaz.

Express será dueño del perímetro HTTP:

```text
Express
├── /api/*          API para mobile e integraciones
├── /webhooks/*     webhooks de pagos y mensajería
└── /*              React Router SSR
```

Las rutas de Express y los loaders/actions de React Router invocarán los mismos casos de uso directamente. No se harán llamadas HTTP desde el SSR hacia la API interna.

El estado que deba sobrevivir recargas, navegación o enlaces compartidos se representará en los segmentos y parámetros de la URL. Los loaders leerán ese estado y entregarán sus datos durante el renderizado del servidor.

Los archivos persistentes se almacenarán en un servicio de objetos compatible con S3. Para contenido público se usarán URLs directas o CDN; para contenido privado, autorización y URLs firmadas. No se dependerá del disco local del proceso para persistencia.

## Límites de los módulos

Checkout, pagos, envíos y mensajería tendrán módulos de negocio independientes del transporte HTTP y de React. Express y React Router serán adaptadores de presentación; no contendrán reglas de negocio.

Esta separación permitirá extraer un módulo a otro servicio sin reescribir su dominio ni sus casos de uso. La extracción se hará únicamente cuando exista una necesidad operativa concreta.

## Consecuencias

- La web, la API y los webhooks se despliegan inicialmente como una unidad.
- SSR puede consultar la lógica de aplicación sin una petición HTTP adicional.
- Express facilita webhooks, validación de firmas, streaming y descargas.
- React Router aporta SSR y manejo de datos con soporte oficial para Express.
- El monolito comparte proceso y recursos; si un módulo requiere escalado o aislamiento independiente, deberá extraerse posteriormente.

## Alternativas descartadas

- **Fastify + React Router:** viable, pero requiere mantener una integración personalizada entre ambos.
- **React Router App Server sin servidor explícito:** suficiente para una web básica, pero ofrece menos control directo sobre webhooks, archivos y rutas externas.
- **Microservicios desde el inicio:** añade despliegues, comunicación y consistencia distribuida antes de que exista una necesidad comprobada.
