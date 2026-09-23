# Yoyos

## Desarrollo local con Docker

Desde la raíz del repositorio, inicia la web y PostgreSQL:

```sh
docker compose up --build
```

La web aplica las migraciones al iniciar. Abre [http://localhost:3000](http://localhost:3000). Para detener los servicios, pulsa `Ctrl+C` o ejecuta:

```sh
docker compose down
```

PostgreSQL conserva los datos en un volumen al detener los servicios. Para eliminar también esos datos, usa `docker compose down -v`.

## Instalación local

Con Node.js 24 y pnpm, instala primero las dependencias compartidas y después las de cada app:

```sh
pnpm --dir shared install --frozen-lockfile
pnpm --dir apps/core install --frozen-lockfile
pnpm --dir apps/mobile install --frozen-lockfile
```

Ambas apps importan Money desde `@shared/money`. `decimal.js` es una dependencia privada de `shared/`; Docker la instala automáticamente.

La app móvil se ejecuta con `pnpm --dir apps/mobile start`.

Para ejecutar las pruebas de Money y comprobar los contratos compartidos en ambas apps:

```sh
cd apps/core
pnpm exec tsx --test ../../shared/money.test.mjs
pnpm typecheck
cd ../mobile
pnpm exec tsc --noEmit
```
