# Buenas prácticas de producto aplicables a Yoyos

Síntesis de marcos externos (octubre de 2026) filtrada por lo que complementa la guía de producto de Yoyos. La guía manda cuando hay conflicto; estas prácticas cubren el problema del usuario, la situación de uso, los estados de cada pantalla, los textos y las métricas.

## Principios que comparten los marcos

1. Empezar por el problema, con una historia concreta de por qué el statu quo falla (Shape Up, Intercom, Torres).
2. Describir al usuario por situación y por el trabajo que quiere hacer, no por demografía (Jobs To Be Done, Intercom).
3. Medir por el comportamiento del cliente, no por features entregadas (Cagan, Torres, Wodtke).
4. Declarar lo que no se hace: non-goals, no-gos, «not doing» (Google design docs, Square, Shape Up, Atlassian).
5. Describir la solución a nivel de flujo, no de píxel (Shape Up: breadboards y fat marker sketches).
6. Fijar apetito de tiempo y recortar alcance para caber, en vez de estimar (Shape Up, Linear).
7. Probar el riesgo mayor de la forma más barata antes de construir; los cuatro riesgos son valor, usabilidad, factibilidad y viabilidad (Cagan, Patton).
8. Nombrar los rabbit holes con la decisión ya tomada (Shape Up).
9. Registrar las decisiones cerradas con su razón, para no repetir el debate (Google design docs). En Yoyos se registra solo lo vigente, sin historial de alternativas.
10. Enviar pequeño y seguido; el envío es el comienzo del aprendizaje (Intercom, Linear).

## Checklist de usabilidad por pantalla o flujo

Aplicar al escribir la sección «Pantallas» del documento.

1. Hay una sola acción principal, visible sin scroll y en la zona del pulgar.
2. En cinco segundos se sabe dónde se está y qué se puede hacer.
3. Están definidos los estados: nada todavía, cargando, sin resultados para estos filtros, error de carga, demasiados elementos, correcto, hecho.
4. El estado vacío dice qué aparecerá aquí y ofrece el botón para crearlo.
5. Cada error está junto al campo, en lenguaje llano, con el remedio, y conserva lo escrito.
6. Toda acción destructiva tiene deshacer o, si es irreversible, una confirmación cuyos botones nombran el resultado («Eliminar pedido» / «Conservar pedido»), nunca «Sí» / «No».
7. Cada acción da feedback antes de 400 ms o muestra progreso.
8. Se minimiza la escritura: cámara, contactos, autocompletado, valores por defecto, precarga de lo que ya se conoce.
9. Sin conexión o con conexión lenta se guarda el estado y se puede retomar; nunca se presenta un fallo de red como lista vacía o como éxito.
10. Los botones dicen lo que pasará («Enviar cotización», no «Enviar»). Se quita la mitad de las palabras.
11. Se imitan las convenciones que el vendedor ya conoce de WhatsApp e Instagram.
12. Menos de siete opciones visibles por decisión, agrupadas.
13. Contraste suficiente, etiqueta en cada campo, objetivos táctiles de al menos 44 pt, sin depender solo del color.
14. Se define qué ve un negocio con 500 pedidos y qué ve uno con un pedido: búsqueda, filtro, paginación.
15. Se define qué pasa si el usuario abandona a medio camino y vuelve.
16. Se aceptan entradas flexibles (teléfono con o sin +51, montos con coma o punto) y se emiten salidas estrictas.

## Preguntas que el agente se hace antes de escribir

Son preguntas para responder con el contexto leído, no para hacerle al fundador. Si una no puede responderse con el contexto y cambia alcance, dinero, datos o prioridades, pasa al bloque de preguntas del documento.

Problema
- ¿Cuál fue la última vez que esto fue un problema real para un vendedor? ¿Qué pasó exactamente?
- ¿Cómo lo resuelve hoy? ¿Cuaderno, Excel, memoria, otra app, una llamada?
- ¿Qué pasa si no se construye?
- ¿Hay más de una forma de resolverlo? Si no, se está describiendo una solución, no un problema.

Usuario
- ¿En qué situación ocurre? ¿Con el cliente esperando en el chat, en la tienda, de noche cerrando caja?
- ¿Qué le genera ansiedad de cambiar su forma actual? ¿Qué hábito lo retiene?
- ¿Quién paga y quién usa? ¿Son la misma persona?

Alcance
- ¿Cuál es el esqueleto que camina: lo mínimo de punta a punta que ya sirve?
- ¿Qué se deja fuera a propósito y qué lo desbloquea?
- ¿Qué pertenece a otra rama o tarea?

Solución
- ¿Cuáles son los lugares, controles y conexiones del flujo?
- ¿Qué alternativas se consideraron y por qué no? (Se usan para decidir; en el documento solo queda la decisión.)
- ¿Qué parte del flujo es la más incierta y qué se decide ya sobre eso a nivel de producto?

Experiencia
- ¿Qué ve el usuario cuando no hay nada, cuando hay demasiado y cuando falla?
- ¿Qué dice exactamente el botón principal y el mensaje de error?
- ¿Qué pasa sin señal o si cierra la app a medio pedido?
- ¿Qué convención de WhatsApp o Instagram se imita o se rompe?

Riesgos
- ¿Cuál es el supuesto más riesgoso en valor, usabilidad, factibilidad y viabilidad?
- ¿Cómo se prueba de la forma más barata antes de construir?
- ¿Qué dependencia externa (WhatsApp, pasarela, courier, impresora) puede bloquear?

Éxito
- ¿Qué comportamiento del vendedor o del comprador cambia si funciona y cómo se vería en los datos?
- ¿Qué no debe empeorar (tiempo de respuesta, errores de pedido, costo por mensaje)?

## Errores comunes al definir producto

1. Presentar una solución sin problema, o un problema que es una solución disfrazada.
2. Omitir lo que no se hace: el silencio se interpreta como inclusión.
3. Métricas de output (features entregadas) en vez de resultado, o ninguna.
4. Requisitos vagos («rápido», «intuitivo», «escalable») sin número ni prueba.
5. Sobre-especificar la interfaz y la tecnología, quitando espacio a la implementación.
6. Describir solo el camino feliz: sin estados vacíos, errores, demasiados datos ni sin conexión.
7. Definir al usuario por demografía y no por situación.
8. Juzgar factibilidad sin mirar lo que la aplicación ya hace.
9. No registrar las decisiones cerradas; el debate se repite.
10. Documento largo sin un resumen que se lea en una sentada.

## Cómo trabaja un equipo de producto maduro, reducido a un fundador con agentes

Lo que ninguna fuente delega al agente: hablar con clientes, elegir el problema, apostar, decir no, revisar lo desplegado. Lo que el agente absorbe: síntesis de entrevistas, prototipos, construcción, medición y mantenimiento de documentos.

Ciclo mínimo sugerido:

| Fase | Salida | Cadencia | Quién |
|---|---|---|---|
| Resultado del trimestre | Un objetivo y tres resultados clave; una métrica North Star con tres entradas | Trimestral; confianza revisada cada semana | Fundador decide; agente prepara datos |
| Descubrir | Ficha de entrevista de una página; árbol de oportunidades | Una entrevista por semana con un vendedor activo o perdido | Fundador entrevista; agente transcribe y extrae oportunidades |
| Definir y apostar | Documento de producto con alcance, apetito, no-goes, criterio de éxito y criterio de muerte con fecha | Al inicio de cada ciclo de dos semanas | Agente escribe con este skill; fundador responde el bloque de preguntas |
| Probar antes de construir | Prototipo o concierge probado con tres a cinco vendedores | Primera semana del ciclo | Agente construye; fundador prueba |
| Construir una rebanada | Incremento vertical completo, visible solo para quien lo prueba | Ciclo de dos semanas | Agente construye; fundador revisa en el dispositivo |
| Lanzar progresivamente | Beta con cinco negocios, luego todos; changelog | Durante el ciclo | Fundador habla con la beta por WhatsApp |
| Medir y aprender | Revisión a dos y seis semanas; escalar, iterar o matar | Al cierre del ciclo | Agente arma el reporte; fundador decide |

Antipatrones a evitar: medir por entregas, investigación como proyecto puntual, preguntar «¿lo usarías?», probar ideas construyendo software de producción, backlog eterno, wireframes finos demasiado pronto, objetivos fijados y olvidados, specs largos que nadie lee, el gran lanzamiento único.

## Fuentes

- Shape Up (Basecamp): https://basecamp.com/shapeup
- SVPG, cuatro riesgos: https://svpg.com/four-big-risks/ ; evaluación de oportunidades: https://www.svpg.com/assessing-product-opportunities/
- Teresa Torres, árbol de oportunidades: https://www.producttalk.org/2021/08/opportunity-solution-tree/
- Intercom, job stories: https://www.intercom.com/blog/using-job-stories-design-features-ui-ux/ ; principios: https://www.intercom.com/blog/intercom-product-principles/
- Google design docs: https://www.industrialempathy.com/posts/design-docs-at-google/
- Linear Method: https://linear.app/method
- Lenny Rachitsky, plantillas de PRD: https://www.lennysnewsletter.com/p/my-favorite-templates-issue-37
- Example Mapping: https://cucumber.io/blog/bdd/example-mapping-introduction/
- Nielsen Norman Group: heurísticas https://www.nngroup.com/articles/ten-usability-heuristics/ ; estados vacíos https://www.nngroup.com/articles/empty-state-interface-design/ ; mensajes de error https://www.nngroup.com/articles/error-message-guidelines/ ; confirmaciones https://www.nngroup.com/articles/confirmation-dialog/ ; móvil https://www.nngroup.com/articles/mobile-ux/
- Nine States of Design: https://css-tricks.com/?p=345062
- Laws of UX: https://lawsofux.com/
- WCAG: https://www.w3.org/WAI/fundamentals/accessibility-principles/
- The Mom Test (resumen): https://mtlynch.io/book-reports/the-mom-test/
- Paul Graham, Do Things That Don't Scale: https://www.paulgraham.com/ds.html
- Thoughtworks sobre spec-driven development: https://www.thoughtworks.com/en-us/radar/techniques/spec-driven-development
