# Plantilla del documento de producto

El documento vive en `docs/<tema>.md`, en español, y describe solo el diseño vigente a nivel de producto. Las secciones marcadas como constantes van siempre; las opcionales solo cuando la funcionalidad las necesita. No se inventa contenido para llenar una sección: si no aplica, se omite.

No contiene decisiones de construcción: ni estructura de datos, ni contratos técnicos, ni organización del código, ni pruebas ejecutables. Esas se definen en la fase siguiente tomando este documento como definición de comportamiento.

## Estilo

- Título con el patrón «<Tema>: definición de producto» o «<Tema> en <plataforma>: definición de producto».
- Debajo del título, una línea de **Estado** con la fecha, qué existe ya, qué documento complementa o sustituye y la tarea de Todoist.
- Voz impersonal, presente declarativo, sin primera ni segunda persona. Sujetos: «el vendedor», «el comprador», «la pantalla», «Yoyos».
- Cada regla afirma y cierra la alternativa: «Se bloquea la venta si falta stock. No se reserva stock en el carrito».
- Valores siempre concretos: cantidades, tiempos, rangos, hora de Lima. Un ejemplo con datos reales cuando haya ambigüedad: S/ 120.00, «Pedido #1001», 28/09/2026.
- Comillas angulares «» para textos visibles en la interfaz; negrita para controles y acciones (**Guardar e imprimir**).
- Tablas de dos columnas para reglas (`| Aspecto | Comportamiento |`), listas numeradas para flujos, bloques `text` para diagramas.
- Las decisiones se afirman sin marcador. Los supuestos se marcan: «Supuesto: …». Lo que depende del fundador va en el bloque de preguntas, nunca disfrazado de decisión.
- Sin historial de decisiones descartadas ni «antes se había decidido». Al reorganizar no se pierde detalle.

## Esqueleto

```markdown
# <Tema>: definición de producto

**Estado:** <definición para implementar | borrador con preguntas abiertas>. <Qué existe ya, documento del que parte, tarea de Todoist, fecha>.

## Problema y situación                 (constante)
## Objetivo                             (constante)
## Usuarios y superficies               (constante si hay más de un actor o plataforma)
## Alcance de la primera versión        (constante)
## Fuera de esta versión                (constante)
## Flujo                                (constante en funcionalidades con interfaz)
## Pantallas                            (constante en funcionalidades con interfaz)
## Reglas                               (constante)
## Estados                              (cuando hay ciclo de vida)
## Cuando algo falla                    (constante)
## Quién ve y hace qué                  (cuando hay más de un actor o datos sensibles)
## Información que se conserva          (cuando el pedido, el negocio o el teléfono guardan algo nuevo)
## Vocabulario                          (cuando aparece un término nuevo o dos que se confunden)
## Decisiones cerradas                  (constante)
## Criterios de aceptación              (constante)
## Pendientes y preguntas               (solo mientras existan; se elimina al cerrarse)
```

## Guía por sección

### Problema y situación
Un párrafo. Qué hace hoy el vendedor o el comprador sin esta funcionalidad, en qué momento ocurre (en el chat con el cliente esperando, en la tienda, de noche cerrando caja), con qué lo resuelve hoy (cuaderno, Excel, memoria, otra app) y qué sale mal. Una historia concreta, no una categoría. Si la funcionalidad es paridad con la web, decirlo: «La web ya lo resuelve; el vendedor opera desde el móvil y hoy debe abrir la web para…».

### Objetivo
Una o dos oraciones con lo que el usuario podrá hacer al terminar. Si hay una hipótesis de resultado (más confirmaciones, menos pedidos abandonados), escribirla como hipótesis y decir cómo se vería.

### Usuarios y superficies
Tabla `| Usuario | Necesidad | Superficie |`. Usuarios por situación, no por demografía: «vendedor registrando una venta en tienda con el cliente delante», «comprador que recibió un enlace por WhatsApp y no tiene cuenta».

### Alcance de la primera versión
Lista de lo que entra, acotado por tipos, canales, plataformas y geografía antes que por confiabilidad. Indicar qué pertenece a otra tarea y qué punto de encuentro se deja definido para que esa tarea solo sume. Si hay varias rebanadas, el orden.

### Fuera de esta versión
Lista de lo que se difiere, cada ítem con su disparador: «cuando exista control de frecuencia de envíos», «cuando se defina tarifas». Lo que tenga riesgo real se registra como tarea en Todoist y se enlaza.

### Flujo
Lista numerada del camino habitual de punta a punta, con la acción principal de cada paso y los valores por defecto. Después, los caminos alternativos que importan (rechazo, resultado en duda, abandono a medio camino) como sublistas cortas.

### Pantallas
Una entrada por pantalla, con el nombre en negrita seguido de dos puntos y:
- Acción principal y controles (**Cargar más**, **Guardar**).
- Estados: todavía no hay datos, cargando, sin resultados para estos filtros, error de carga, demasiados. Cada estado con su texto visible entre «».
- Textos de botones y de mensajes que ve el usuario, con el remedio en cada error.
- Qué se conserva al navegar (búsqueda, lista, posición) y qué pide confirmación al descartar.
- Navegación con flechas de texto: Configuración → Apariencia del checkout.

### Reglas
Tabla `| Aspecto | Comportamiento |`. Cada regla con valores concretos y, cuando no sea obvia, un ejemplo con datos reales.

### Estados
Tabla `| Estado | Significado | Qué lo provoca | Qué se puede hacer | Qué ve el vendedor | Qué ve el comprador |` (quitar columnas que no apliquen), más una lista de transiciones permitidas. Indicar qué pasa con los registros que existían antes de este estado.

### Cuando algo falla
Tabla `| Situación | Qué ve el usuario | Qué puede hacer |` que distinga los cuatro resultados de cada acción con efecto: éxito, rechazo conocido (vuelve a corregir con el trabajo intacto y el elemento señalado), no se envió (reintento), resultado en duda (se verifica antes de repetir; nunca se presenta como éxito). Qué se bloquea mientras hay una acción en duda. Qué pasa si el usuario abandona a medio camino y vuelve.

### Quién ve y hace qué
Tabla `| Actor | Puede ver | Puede hacer | No puede |`. Para cada capa de protección, el riesgo concreto que cierra. Qué datos del negocio no ve el comprador. Si la respuesta a una acción pública es igual exista o no el recurso.

### Información que se conserva
Qué se copia en el pedido y queda fijo (lo acordado), qué se muestra siempre vigente (instrucciones para actuar ahora), qué es preferencia del teléfono y qué es dato de la cuenta, qué no se guarda por ser efímero, y qué ocurre con lo que ya existía antes. Sin estructura de datos: solo qué información, de quién y hasta cuándo.

### Vocabulario
Lista `término: definición` para cada concepto nuevo o par de términos que se confunden, con el texto que ve el usuario entre «».

### Decisiones cerradas
Tabla `| Decisión | Por qué |` con las decisiones de esta funcionalidad que no deben reabrirse, en una línea cada una. Sin historial ni alternativas: solo lo vigente y su razón. Sirve para que un agente futuro no vuelva a proponer lo descartado.

### Criterios de aceptación
Lista numerada de escenarios concretos: situación con datos y resultado observable. Cada uno debe poder convertirse en una prueba en la fase siguiente, pero aquí no se dice de qué tipo ni dónde. Cubrir el camino habitual, cada rechazo conocido, el resultado en duda y el abandono a medio camino.

### Pendientes y preguntas
Solo mientras existan. El bloque de preguntas sigue el Paso 12 de la guía de producto: numeradas, opción recomendada primero con su razón, consecuencia de cada alternativa, y aparte la lista «Decidido salvo objeción». Cuando el fundador responde, el documento se actualiza y las preguntas resueltas desaparecen de esta sección.
