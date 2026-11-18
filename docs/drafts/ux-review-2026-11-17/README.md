# Revisión UX del 17 de noviembre de 2026

Revisión de UI/UX hecha con cuatro revisores (Sonnet) corriendo en Orca, cada uno sobre una
superficie, contra el entorno local. Sin bloqueantes. Este directorio es la **evidencia**: las
capturas que citan los hallazgos y el reporte completo de cada revisor.

- `common.md`: encargo y método común de los cuatro revisores.
- `web-productos/REPORT.md`, `web-pedidos/REPORT.md`, `movil-productos/REPORT.md`,
  `movil-pedidos/REPORT.md`: reportes por superficie, con pasos para reproducir y el nombre de la
  captura de cada hallazgo.
- Las capturas viven junto a cada reporte, con el nombre que el reporte cita.

Fecha de la revisión: 2026-11-17. Los reportes se escribieron contra el entorno local de ese día;
antes de implementar hay que **reproducir cada hallazgo en `origin/main`**, porque `main` siguió
moviéndose y alguno puede estar ya resuelto.

## Hallazgos mayores de la revisión

| # | Área | Hallazgo | Captura |
|---|------|----------|---------|
| 1 | Web productos | Enter en «Agregar otro valor» guarda el producto sin variantes | `web-productos/09-enter-en-valor.png` |
| 2 | Web productos | «Stock no válido» marca en rojo el campo de precio | `web-productos/15-stock-negativo.png` |
| 3 | Web productos | En 390px la columna Stock de la tabla de variantes queda fuera de vista | `web-productos/21-m-editar.png` |
| 4 | Web productos | Con error de fila en escritorio, la columna Stock se recorta y el mensaje general queda lejos | `web-productos/12-edicion-inline-invalida.png` |
| 5 | Móvil pedidos | Un pago mayor al total se registra sin validar (S/ 999 en un pedido de S/ 60) | `movil-pedidos/09-pago-monto-excesivo.png` |
| 6 | Móvil pedidos | «Anular pago» actúa sin confirmación (`order-detail-screen.tsx:598`) | `movil-pedidos/11-anular-pago.png` |

Los hallazgos menores y lo que quedó sin probar están en cada reporte, con su captura.
