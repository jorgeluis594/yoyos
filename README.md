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

La app móvil sigue ejecutándose con Expo desde `apps/mobile`.
