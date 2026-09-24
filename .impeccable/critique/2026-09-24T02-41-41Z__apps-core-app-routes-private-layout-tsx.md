---
target: layout base
total_score: 23
max_score: 36
na_heuristics: 5
p0_count: 0
p1_count: 0
timestamp: 2026-09-24T02-41-41Z
slug: apps-core-app-routes-private-layout-tsx
---
Method: dual-agent (A: /root/design_review · B: /root/mechanical_review)

# Crítica inicial del layout base

La paleta Caramelo sobrio y la tipografía encajan con Yoyos. La composición necesita mejores proporciones y separación de superficies.

| Heurística | Nota /4 | Observación |
|---|---:|---|
| Estado visible | 3 | Inicio identificado; cierre pendiente sin texto específico. |
| Lenguaje natural | 4 | Etiquetas claras en español. |
| Control y libertad | 3 | Tema, salida y diálogo nativo. |
| Consistencia | 3 | Tokens coherentes, grupos mejorables. |
| Prevención | n/a | No hay entrada de datos ni acciones destructivas. |
| Reconocimiento | 3 | Usuario truncado. |
| Eficiencia | 2 | Marco básico. |
| Estética | 2 | Superficie indiferenciada. |
| Recuperación | 3 | Cierre fallido permite reintentar. |
| Ayuda | 0 | Inicio sin siguiente paso operativo. |
| Total | 23/36 | Evaluación previa a los cambios. |

## Fortalezas
Paleta sobria, navegación rotulada y estados de foco/error existentes.

## Prioridades
1. Barra lateral de 192 px comprime nombres; ampliar y permitir saltos de línea.
2. Separar navegación y contenido con superficies existentes y alinear cabeceras.
3. Mejorar agrupación de empresa, navegación y cuenta; conservar densidad compacta.
4. Añadir salto al contenido y ampliar botones móviles.
5. El saludo no ofrece un siguiente paso. La solución funcional queda pendiente de módulos operativos reales; no añadir destinos ficticios.

## Carga cognitiva y recorrido
Pocas decisiones visibles, pero falta jerarquía. La llegada es tranquila y termina en un lienzo sin tarea. Usuarios frecuentes necesitan tareas reales; usuarios de teclado necesitan acceso directo al contenido; nombres largos deben poder leerse.

## Evidencia
Captura suministrada y código; evaluaciones independientes. Detector CLI: cero hallazgos. Los problemas de proporción son visuales, no detectados automáticamente. No equivale a una certificación de accesibilidad.

Questions skipped: el usuario solicitó explícitamente criticar y luego mejorar el layout; alcance e identidad constan en el proyecto.
