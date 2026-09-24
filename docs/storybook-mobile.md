# Storybook para componentes móviles

El catálogo web independiente de `apps/mobile` muestra los componentes de `src/components/ui`, `ThemedText` y `ThemedView` con React Native Web y Vite. La configuración vive en `apps/mobile/.storybook`; las historias viven junto a los componentes. El Storybook de `apps/core` sigue separado.

Desde `apps/mobile`:

```sh
pnpm storybook        # http://localhost:6007
pnpm build-storybook  # genera storybook-static/
```

La vista previa carga los estilos y la fuente Inter de la app. El tema sigue la preferencia de color del sistema del navegador; cambia esa preferencia para revisar claro y oscuro. El ícono de `Collapsible` usa un chevrón web sencillo en Storybook. El catálogo web sirve para explorar variantes y estados, pero no sustituye la revisión de controles e interacciones nativas en Expo Go.

Storybook no se importa desde las rutas de Expo. La entrada nativa sigue siendo `expo-router/entry`.
