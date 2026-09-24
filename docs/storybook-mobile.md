# Storybook para componentes móviles

**Estado:** propuesta; aún no está instalado en `apps/mobile`.

## Objetivo

Mostrar los componentes de React Native de `apps/mobile` en un catálogo web para revisar variantes, estados y temas. El Storybook existente en `apps/core` corresponde a la app web de React y permanece separado.

## Enfoque

- Usar [Storybook para React Native Web](https://storybook.js.org/docs/get-started/frameworks/react-native-web-vite) como herramienta de desarrollo independiente. `apps/mobile` ya incluye `react-native-web`.
- Mantener sus historias y configuración fuera de las rutas y la entrada nativa. Storybook no debe importarse desde el código que carga la app en Android o iOS.
- Verificar que el bundle de producción nativo no incluya Storybook. Con esa separación, el catálogo no afecta el rendimiento de la app instalada; sí añade dependencias y tiempo de instalación al entorno de desarrollo.

La vista web sirve para explorar componentes, pero no reproduce exactamente los controles ni la interacción nativa. La revisión final de Android se hace en el celular con Expo Go.
