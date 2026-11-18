Revisión rápida de UI/UX de Yoyos (solo lectura, NO edites código del repo).
- La app web corre en http://localhost:3000 (docker compose ya levantado por el coordinador; no lo bajes ni lo reconstruyas, no borres volúmenes).
- Crea tus propios datos aislados (cuenta nueva con email único, p.ej. ux-<area>-<timestamp>@test.local). Si el sign-up pide verificar email, marca emailVerified por SQL en el contenedor de postgres (ver ~/yoyos-landing-capturas/pedido-web-2-3/setup.sh como referencia de curl/SQL).
- Usa el navegador embebido de Orca (`orca skills get orca-cli`, sección browser) o Playwright (apps/core/node_modules/.pnpm/playwright@*/...). Para Expo web: shims en memoria expo-web-secure-store-shim; usa un puerto propio.
- Sé simple y rápido: máximo ~30-40 min. Recorre los flujos principales como un vendedor real, en escritorio y ancho móvil (390px).
- Busca: errores/crashes, textos rotos o en inglés, estados vacíos/carga/error faltantes, botones que no responden, layout roto, foco/teclado, feedback tras guardar, confusiones de UX.
- No corras suites de tests completas (memoria del host limitada).
- Guarda capturas en ~/yoyos-landing-capturas/ux-review/<area>/ y escribe ~/yoyos-landing-capturas/ux-review/<area>/REPORT.md.
- Entregable (worker_done): lista de hallazgos ordenada por severidad (bloqueante / mayor / menor), cada uno con pasos para reproducir y ruta de captura. Si todo está bien, dilo explícitamente con lo que probaste. Escribe en español.
