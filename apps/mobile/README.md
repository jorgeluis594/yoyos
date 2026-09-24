# Yoyos mobile

App Expo SDK 57 para registrar una cuenta, vincular una empresa e iniciar/cerrar sesión en core. La sesión de Better Auth se conserva en SecureStore; el JWT de acceso permanece en memoria. Al abrir la app se comprueba la sesión antes de mostrar rutas privadas. Si la empresa quedó pendiente, se pide su nombre y país nuevamente.

## Desarrollo

Instala las dependencias de `shared` y `apps/mobile` con `pnpm install`. Inicia core y luego ejecuta desde este directorio:

```bash
EXPO_PUBLIC_CORE_URL=http://localhost:3000 pnpm start
```

En un dispositivo físico, usa una URL accesible desde el dispositivo. Fuera de desarrollo, `EXPO_PUBLIC_CORE_URL` debe ser HTTPS. La URL y el scheme `yoyos` deben estar permitidos por la configuración de Better Auth en core.

## Verificación local

```bash
pnpm lint
pnpm typecheck
pnpm test
```

Las pruebas de presentación, aplicación y adaptadores usan límites controlados; no requieren un servidor core ni un dispositivo. La app no incluye aún funciones privadas de negocio más allá de la pantalla inicial de empresa.
