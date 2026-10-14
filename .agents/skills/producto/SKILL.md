---
name: producto
description: Define una funcionalidad de Yoyos a nivel de producto y escribe su documento en docs/ siguiendo la guía de producto del fundador, decidiendo solo lo rutinario y agrupando en un bloque las pocas preguntas que requieren su respuesta. Usar cuando se pida definir, diseñar o documentar una funcionalidad, un flujo o una pantalla a nivel de producto, o cuando una tarea de Todoist necesite definición antes de implementar. No usar para arquitectura, datos, contratos técnicos, implementación ni pruebas ejecutables.
---

# Producto

Las rutas son relativas a este skill. El agente diseña la funcionalidad completa a nivel de producto siguiendo la guía y entrega el documento terminado; no itera una decisión por turno y no toma decisiones de construcción.

## Referencias

| Archivo | Qué contiene | Cuándo leerlo |
| --- | --- | --- |
| [guia-de-producto.md](guia-de-producto.md) | Doce pasos para definir producto, con reglas, ejemplos y qué decide el agente solo frente a qué requiere al fundador | Siempre, completo, antes de diseñar |
| [hechos-del-producto.md](hechos-del-producto.md) | Mercado peruano, qué puede hacer hoy el vendedor en web y móvil, WhatsApp, forma de trabajo | Siempre; comprobar los hechos marcados [verificar] que toque la funcionalidad |
| [plantilla-documento.md](plantilla-documento.md) | Esqueleto del documento, estilo y guía por sección | Al escribir el documento |
| [buenas-practicas.md](buenas-practicas.md) | Checklist de usabilidad por pantalla, preguntas que el agente se hace, errores comunes, ciclo de producto | Al escribir «Problema y situación», «Pantallas» y «Objetivo» |
| [valores-de-referencia.md](valores-de-referencia.md) | Valores concretos ya fijados (páginas de 20, 1001, 24 h) | Cuando aparezca un caso análogo |

## Pasos

1. **Reunir contexto antes de proponer nada.**
   - Usa [Happy Memory Recall](../happy-memory-recall/SKILL.md) con la funcionalidad como objetivo; la memoria prevalece sobre la descripción de la tarea.
   - Si hay tarea de Todoist, léela y lee sus tareas hermanas del mismo proyecto para saber qué pertenece a otra funcionalidad.
   - Lee los documentos de producto existentes en `docs/` que toque la funcionalidad y comprueba en la aplicación (pantallas, flujos, textos) qué existe ya. Comprueba cada hecho marcado [verificar] que la funcionalidad use.
   - Resume en tres líneas qué pide la tarea, qué existe ya y qué queda fuera por pertenecer a otra funcionalidad. Si la petición admite dos lecturas que llevan a documentos distintos, pregunta cuál antes de seguir; es la única pregunta que se hace antes de escribir.

2. **Responder las preguntas de producto con el contexto.** Recorre las preguntas de [buenas-practicas.md](buenas-practicas.md) (problema, usuario, alcance, solución, experiencia, riesgos, éxito). Lo que el contexto responde se escribe en el documento. Lo que no responde se clasifica con el Paso 11 de la guía: rutinario, se decide y se anota; de alcance, dinero, lo que se conserva, prioridades entre funcionalidades o contrario a una decisión anterior, va al bloque de preguntas.

3. **Diseñar recorriendo los doce pasos de la guía.** Para cada pantalla, aplica el checklist de usabilidad. Para cada regla, un ejemplo con datos reales. Para cada acción con efecto, los cuatro resultados posibles. Para cada concepto nuevo, una línea que diga por qué no sirve uno existente; si no la hay, no se crea. Nunca reproponer lo que el fundador descartó o difirió.

4. **Escribir el documento completo** en `docs/<tema>.md` con [plantilla-documento.md](plantilla-documento.md). Si existe un documento vigente del tema, actualizarlo sin perder detalle en lugar de crear otro. El documento describe comportamiento: qué ve y hace cada actor, reglas, estados, fallos, qué se conserva. No describe estructura de datos, contratos técnicos, organización del código ni pruebas ejecutables. No implementar ni hacer commit durante la definición.

5. **Entregar en el chat** la ruta absoluta del documento, el bloque «Preguntas» con el formato del Paso 12 de la guía (numeradas, opción recomendada primero, consecuencia de cada alternativa) y la lista «Decidido salvo objeción» con las decisiones rutinarias que conviene que el fundador vea. Nada más: el contenido está en el documento.

6. **Cerrar con las respuestas.** Al recibir las respuestas, actualizar el documento, eliminar las preguntas resueltas de «Pendientes y preguntas», pasar el estado a «definición para implementar», actualizar la tarea de Todoist con lo acordado, crear en Todoist las tareas de lo diferido con riesgo real, y registrar con [Happy Memory Maintainer](../happy-memory-maintainer/SKILL.md) las decisiones que deban regir funcionalidades futuras. Si una respuesta contradice una regla de la guía, aplicarla y proponer al fundador la actualización de la regla en [guia-de-producto.md](guia-de-producto.md).

## Guardarraíles

- Una pregunta «¿para qué sirve X?» o «¿por qué tanta protección?» del fundador es una objeción: responder en dos líneas y ofrecer la versión sin X.
- Un mensaje corto con dos lecturas se reformula en una frase y se pregunta cuál es; no se elige una.
- El documento describe solo el diseño vigente. Al reorganizar no se elimina detalle.
- Lo que pertenece a otra funcionalidad no entra, pero el punto de encuentro queda definido para que esa funcionalidad solo sume.
- Si durante la definición aparece una decisión técnica necesaria (dónde se guarda algo, cómo se comunica el móvil con la web), se anota en una línea como «a resolver en implementación» y no se desarrolla.
- La sesión de WhatsApp vive solo en el teléfono del vendedor; Yoyos nunca la recibe ni envía avisos para despertar la app.

## Después de este skill

La arquitectura, la estructura de datos, los contratos entre web y móvil, la organización del código, las pruebas y la observabilidad se definen con el skill [Implementation](../implementation/SKILL.md), que toma este documento como definición de comportamiento.
