# Yoyos

## Desarrollo local con Docker

Desde la raíz del repositorio, inicia la web y PostgreSQL:

```sh
docker compose up --build
```

El servicio `migrate` aplica las migraciones y crea el rol `core_app`; la web arranca con ese rol restringido. Abre [http://localhost:3000](http://localhost:3000). Para detener los servicios, pulsa `Ctrl+C` o ejecuta:

```sh
docker compose down
```

PostgreSQL conserva los datos en un volumen al detener los servicios. Para eliminar también esos datos, usa `docker compose down -v`.

La app móvil sigue ejecutándose con Expo desde `apps/mobile`.

## Actualización de una instalación existente

Detén la web antes de migrar y conserva el volumen de PostgreSQL:

```sh
docker compose stop web
docker compose up --build migrate
docker compose up --build -d web
```

No uses `docker compose down -v` durante la actualización: elimina los datos.
