# Prueba física Android: despachos y rótulos (D2)

Fecha: 2026-10-13. Celular Samsung SM-A566E (R5CY32G04RW), Android, zona America/Lima. Rama jorgeluis594/preparacion-despachos-rotulos.
Capturas: [`images/preparacion-despachos-rotulos-prueba-fisica/`](images/preparacion-despachos-rotulos-prueba-fisica/) (nombres citados abajo; galería al final). Sin ediciones de código de producto.

## Veredicto
**La impresión física NO se pudo probar: no había impresora disponible** (el coordinador lo confirmó; la app también dice "No se encontraron impresoras Brother QL-810W en esta red"). Se probó todo lo demás en el celular real contra el backend real. Se encontró **1 bug** (fecha programada se guarda un día antes).

## Entorno y build
- JDK 17 (Temurin vía mise; `brew install --cask zulu@17` falla: pide sudo). Build: `./gradlew app:assembleDebug --no-configure-on-demand` en `apps/mobile/android` tras `expo prebuild`. **Nota:** `expo run:android` falla porque pasa `--configure-on-demand` y los `flatDir` de los AAR locales (WhatsAppGo, BrotherPrintLibrary) no se resuelven ("Could not find :WhatsAppGo:"). Hay que correr gradle sin ese flag.
- `WhatsAppGo.aar` (no versionado, ignorado por git) se copió desde otro worktree (`message-to-order`) porque no hay gomobile. No afecta a impresión.
- Core aislado: `docker compose -p despachos-fisica` (override en `/tmp/despachos-fisica-override.yaml`) en `localhost:3070` (el 3000 lo usa otro worktree). `adb reverse` 3070→3070 y **8081→8082** (el build debug apunta a `localhost:8081`, ocupado por el Metro de otro worktree; mi Metro corre en 8082). Al principio el celular cargó el bundle del otro worktree (capturas `00-*`, descartadas).
- Datos aislados (usuario demo@yoyos.local, "Yoyos Demo"): 2 couriers (Shalom, Olva), 3 agencias (una con nombre de 120+ chars y dirección ~300), zonas Lima y Arequipa con opciones domicilio/agencia, 2 productos, pedidos 1001–1023 (script `/tmp/despachos-fisica-setup.mjs`, `/tmp/despachos-fisica-more.mjs`).
- Pedidos: 1001 domicilio con referencia y fecha 15/10; 1002 domicilio, nombre de 66 chars y dirección de 300 sin referencia ni fecha; 1003 domicilio con referencia de 900 chars sin fecha; 1004 domicilio Arequipa; 1005 agencia Shalom con fecha 14/10; 1006 agencia con nombre de agencia/dirección extensos y nombre largo, sin fecha; 1007 agencia Olva; 1008 **sin entrega (incompleto)**; 1009 **cancelado**; 1010–1023 domicilios simples (para paginación).

## Resultado por punto
| # | Punto | Resultado | Evidencia / notas |
|---|---|---|---|
| 1 | Build, instalación, login, empresa de prueba | **OK** | `01-login`, `02-login-ok-inicio`, `03-ventas-lista`. Build debug instalado y login contra core local. Aviso del sistema "16 KB" ignorado (build debug). |
| 2 | QR de producto DK-1209 sigue imprimiendo | **NO PROBADO** (sin impresora) | Solo se verificó el flujo previo: Productos → icono impresora → búsqueda → "No se encontraron impresoras…" (`32b`, `33-qr-sin-impresora`), mismo error claro que en rótulos. |
| 3 | Rótulos DK-11202: contenido, corte, tamaño de letra | **NO PROBADO** (sin impresora) | Sí OK: filtrar, seleccionar, revisión y tanda (ver abajo). No se pudo ver papel impreso. |
| 3a | Filtros en Ventas | **OK** | Panel con cliente, fecha, estado de despacho, courier, fecha programada (Sin programar, desde/hasta), fecha real (`11`, `12`). Courier=Shalom devuelve solo 1005/1006 (`13`); Sin programar excluye 1001 y 1005 (`15`). |
| 3b | Selección y Imprimir rótulos → revisión | **OK** | 9 seleccionados → "7 rótulos listos; 2 pedidos requieren completar datos": #1009 "Pedido cancelado", #1008 "Entrega sin asignar", ambos con "Ver pedido" (`04`, `05`). Con 23: "21 listos; 2 requieren" (`21`). Indica "Coloca el rollo de 62 × 100 mm (DK-11202)… La app no detecta el rollo" e "Impresora: Sin impresora elegida". "Ver pedido" abre el detalle (`22`). 1003 (referencia 900 chars) y 1006 (textos extensos) quedan "listos" en la revisión: el preflight dice que caben, pero no verificado en papel. |
| 3c | Selección entre páginas / Seleccionar todos | **OK** | 23 pedidos, página 20: Seleccionar todos → 20; "Siguiente" conserva 20 (`17`); Seleccionar todos en pág. 2 → 23 (`18`). Se conserva tras abrir un detalle y volver. Al aplicar un filtro la selección se limpia (`13`). |
| 4 | Tanda: Detener durante envío, error y Continuar, incierto, QR bloqueado, cerrar y reabrir | **PARCIAL** | Sin impresora no se puede enviar nada, así que NO PROBADOS: Detener, error mid-tanda y Continuar tras error, caso incierto, QR bloqueado *mientras corre*. Probado OK: al pulsar Imprimir se crea la tanda "0 de N rótulos impresos / Elige una impresora para continuar" con pedidos en "Pendiente" (`06`, `30`); "Elegir impresora" → "No se encontraron impresoras… Buscar de nuevo / Cancelar" (`07`); "Continuar" sin impresora no avanza ni marca éxito (`08`); Cerrar → Ventas muestra "Ver tanda de rótulos" y "Imprimir rótulos" deshabilitado (`09`); Ver tanda reabre la misma tanda (`10`, `19`); Descartar tanda la elimina y rehabilita Imprimir (`20`). Con la tanda sin ejecutar el QR **no** está bloqueado (esperable; el bloqueo es solo mientras corre). |
| 5 | Papel incompatible → error, no éxito | **NO PROBADO** (sin impresora) | |
| 6 | Imprimir no cambia estados ni fechas | **OK (parcial)** | Snapshot de la tabla Order (estado, cancelado, fechas, stock, total, hash de delivery) antes y después de abrir revisión, crear/reabrir/descartar tandas y pulsar Continuar: **idéntico** (`/tmp/despachos-fisica-snap-before.txt`). Como no hubo impresión real, queda por repetir tras una tanda impresa. |
| + | Fecha programada desde el detalle (#1008) | **FALLA** (bug 1) | Elegir/limpiar OK, pasada se admite (`24`–`28`). |

Tamaño de letra mínimo observado: **no medido (sin papel)**. Por código (`dispatch-label-renderer.ts`): base 12 pt, mínimo 7 pt, paso 0.5 pt (marcado "provisional"; destinatario ×1.5, resto ×1.0–1.2). Falta registrar con la Brother qué tamaño termina usando 1002/1003/1006 y si 7 pt es legible en 62×100.

## Bugs
### 1. La fecha programada se guarda un día antes (Android, Lima UTC-5) — media/alta
- Pasos: Ventas → #1008 → Entrega → "Despacho programado" → Elegir día → elegir **12** → Aceptar: se guarda y muestra **2026-10-11**. Repetido eligiendo **15** (`26-selector-15-elegido`): se guarda **2026-10-14** (BD: `Order.scheduledDispatchDate`). Reproducible; Limpiar funciona (`28`).
- Causa probable (no verificada): `apps/mobile/src/features/orders/presentation/order-day-field.tsx` — `calendarDay(date)` usa `getFullYear/getMonth/getDate` locales sobre el `Date` que devuelve `DateTimePicker` (`@expo/ui`), que en Android parece venir como medianoche UTC; en UTC-5 queda el día anterior. Mismo componente se usa en los filtros de fecha (creación, programada, real), que probablemente heredan el desfase.
- Impacto: las fechas del pie del rótulo y los filtros por fecha programada quedan desfasados un día para usuarios en Perú. Pruebas Jest en UTC no lo detectan.
### Observaciones menores (no bloqueantes)
- La fila de Ventas muestra "Programado: 2026-10-14" (ISO) mientras el rótulo usa dd/mm/aaaa; el botón del detalle también muestra ISO.
- En una tanda larga (21) "Cerrar", "Continuar" y "Elegir impresora" quedan al final de la lista; hay que desplazarse (`32-tanda-21-fin`).
- La tanda lista pedidos del más nuevo al más antiguo (#1007 primero).

## Pendiente para cuando haya impresora
Puntos 2, 3 (contenido/corte/legibilidad, tamaño usado con 1002/1003/1006), 4 (detener, error y continuar, incierto, QR bloqueado en ejecución), 5 (papel equivocado) y repetir 6 tras imprimir. Datos listos en el core `localhost:3070` (`docker compose -p despachos-fisica`, Metro en 8082 con `adb reverse tcp:8081 tcp:8082`). Si se corrige el bug 1, volver a probar con un día distinto de hoy.

## Capturas

### 01-login

![01-login](images/preparacion-despachos-rotulos-prueba-fisica/01-login.png)

### 02-login-ok-inicio

![02-login-ok-inicio](images/preparacion-despachos-rotulos-prueba-fisica/02-login-ok-inicio.png)

### 03-ventas-lista

![03-ventas-lista](images/preparacion-despachos-rotulos-prueba-fisica/03-ventas-lista.png)

### 04-ventas-9-seleccionados

![04-ventas-9-seleccionados](images/preparacion-despachos-rotulos-prueba-fisica/04-ventas-9-seleccionados.png)

### 05-revision-7-listos-2-requieren

![05-revision-7-listos-2-requieren](images/preparacion-despachos-rotulos-prueba-fisica/05-revision-7-listos-2-requieren.png)

### 06-imprimir-sin-impresora

![06-imprimir-sin-impresora](images/preparacion-despachos-rotulos-prueba-fisica/06-imprimir-sin-impresora.png)

### 07-elegir-impresora

![07-elegir-impresora](images/preparacion-despachos-rotulos-prueba-fisica/07-elegir-impresora.png)

### 08-continuar-sin-impresora

![08-continuar-sin-impresora](images/preparacion-despachos-rotulos-prueba-fisica/08-continuar-sin-impresora.png)

### 09-ventas-tras-cerrar-ver-tanda

![09-ventas-tras-cerrar-ver-tanda](images/preparacion-despachos-rotulos-prueba-fisica/09-ventas-tras-cerrar-ver-tanda.png)

### 10-ver-tanda-reabierta

![10-ver-tanda-reabierta](images/preparacion-despachos-rotulos-prueba-fisica/10-ver-tanda-reabierta.png)

### 11-filtros-panel

![11-filtros-panel](images/preparacion-despachos-rotulos-prueba-fisica/11-filtros-panel.png)

### 12-filtros-courier-shalom-abajo

![12-filtros-courier-shalom-abajo](images/preparacion-despachos-rotulos-prueba-fisica/12-filtros-courier-shalom-abajo.png)

### 13-filtro-shalom-aplicado

![13-filtro-shalom-aplicado](images/preparacion-despachos-rotulos-prueba-fisica/13-filtro-shalom-aplicado.png)

### 14-filtro-sin-programar-seleccionado

![14-filtro-sin-programar-seleccionado](images/preparacion-despachos-rotulos-prueba-fisica/14-filtro-sin-programar-seleccionado.png)

### 15-sin-programar-aplicado

![15-sin-programar-aplicado](images/preparacion-despachos-rotulos-prueba-fisica/15-sin-programar-aplicado.png)

### 16-ventas-pagina-fin

![16-ventas-pagina-fin](images/preparacion-despachos-rotulos-prueba-fisica/16-ventas-pagina-fin.png)

### 17-pagina-2-seleccion

![17-pagina-2-seleccion](images/preparacion-despachos-rotulos-prueba-fisica/17-pagina-2-seleccion.png)

### 18-pagina-2-seleccionar-todos-23

![18-pagina-2-seleccionar-todos-23](images/preparacion-despachos-rotulos-prueba-fisica/18-pagina-2-seleccionar-todos-23.png)

### 19-tanda-reabierta-desde-pagina-2

![19-tanda-reabierta-desde-pagina-2](images/preparacion-despachos-rotulos-prueba-fisica/19-tanda-reabierta-desde-pagina-2.png)

### 20-descartar-tanda

![20-descartar-tanda](images/preparacion-despachos-rotulos-prueba-fisica/20-descartar-tanda.png)

### 21-revision-23-pedidos

![21-revision-23-pedidos](images/preparacion-despachos-rotulos-prueba-fisica/21-revision-23-pedidos.png)

### 22-ver-pedido-1008-detalle

![22-ver-pedido-1008-detalle](images/preparacion-despachos-rotulos-prueba-fisica/22-ver-pedido-1008-detalle.png)

### 23-detalle-1008-entrega-fecha

![23-detalle-1008-entrega-fecha](images/preparacion-despachos-rotulos-prueba-fisica/23-detalle-1008-entrega-fecha.png)

### 24-selector-fecha

![24-selector-fecha](images/preparacion-despachos-rotulos-prueba-fisica/24-selector-fecha.png)

### 25-fecha-atrasada-asignada-1008

![25-fecha-atrasada-asignada-1008](images/preparacion-despachos-rotulos-prueba-fisica/25-fecha-atrasada-asignada-1008.png)

### 26-selector-15-elegido

![26-selector-15-elegido](images/preparacion-despachos-rotulos-prueba-fisica/26-selector-15-elegido.png)

### 27-fecha-tras-elegir-15

![27-fecha-tras-elegir-15](images/preparacion-despachos-rotulos-prueba-fisica/27-fecha-tras-elegir-15.png)

### 28-fecha-limpiada-1008

![28-fecha-limpiada-1008](images/preparacion-despachos-rotulos-prueba-fisica/28-fecha-limpiada-1008.png)

### 29-tras-volver

![29-tras-volver](images/preparacion-despachos-rotulos-prueba-fisica/29-tras-volver.png)

### 30-tanda-23-sin-imprimir

![30-tanda-23-sin-imprimir](images/preparacion-despachos-rotulos-prueba-fisica/30-tanda-23-sin-imprimir.png)

### 31-productos

![31-productos](images/preparacion-despachos-rotulos-prueba-fisica/31-productos.png)

### 32-tanda-21-fin

![32-tanda-21-fin](images/preparacion-despachos-rotulos-prueba-fisica/32-tanda-21-fin.png)

### 32b-qr-seleccion

![32b-qr-seleccion](images/preparacion-despachos-rotulos-prueba-fisica/32b-qr-seleccion.png)

### 33-qr-sin-impresora

![33-qr-sin-impresora](images/preparacion-despachos-rotulos-prueba-fisica/33-qr-sin-impresora.png)

### 34-final-tras-cancelar

![34-final-tras-cancelar](images/preparacion-despachos-rotulos-prueba-fisica/34-final-tras-cancelar.png)

