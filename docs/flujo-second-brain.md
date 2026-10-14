# Flujo del segundo cerebro: captura, organización y recuperación

Fecha de documentación: 2026-10-01 (fecha local verificada).
Estado: acuerdos de diseño; implementación pendiente.
Fuente: conversación con el usuario sobre la separación de Capture, Organize, Recall, Distill y Express.
Ámbito: segundo cerebro personal compartido entre proyectos.

## Cómo retomar en otra sesión

Este documento es una base de discusión, no una solicitud de implementación. Revisar los componentes uno por uno: Capture, Organize, Recall y el agente Distill. Para cada uno, definir sus disparadores, entradas, salidas, límites y preguntas pendientes antes de pasar al siguiente. Express permanece bajo la dirección del usuario.

No modificar skills ni configurar agentes o tareas programadas durante esta revisión salvo solicitud explícita del usuario.

## Propósito

Conservar ideas y conocimiento con poca fricción, organizar el material para encontrarlo y recuperarlo cuando ayude a crear, decidir o actuar. La captura no se limita a decisiones confirmadas: una idea incompleta puede merecer conservarse antes de conocer su aplicación.

Este documento registra nuestra adaptación del enfoque CODE a un flujo con agentes. La separación en skills y agentes es una decisión de diseño propia, no una arquitectura prescrita por Tiago Forte.

## Decisiones acordadas

### 1. Separar las responsabilidades

El flujo tendrá responsabilidades diferenciadas para Capture, Organize y Recall. La destilación estará a cargo de un agente invocado por Recall cuando resulte necesaria. Express será dirigido por el usuario y podrá apoyarse en agentes para ejecutar el trabajo.

Obsidian es el soporte de las notas, no quien decide por sí mismo qué conocimiento conservar o cómo elaborarlo. La política del segundo cerebro se distingue de las operaciones de lectura y escritura de archivos.

Los nombres definitivos, el número de archivos de skill y los mecanismos de activación todavía no están especificados.

### 2. Capture: conservar material sin exigir madurez

Responsabilidad: ingresar material en Inbox durante el día, sin obligar a clasificarlo o destilarlo inmediatamente.

El alcance discutido incluye ideas, posibilidades, preguntas, observaciones, referencias, aprendizajes, hipótesis y decisiones con sus motivos. Guardar una propuesta no equivale a aprobarla, verificarla ni comprometerse a implementarla.

La captura debe conservar suficiente contexto y procedencia para comprender el material después. No se busca copiar indiscriminadamente cada mensaje ni crear una nota por cada intervención.

Pendiente: fijar el umbral de captura automática, el tratamiento de propuestas del asistente todavía no comentadas por el usuario y el formato mínimo definitivo de cada captura.

### 3. Organize: revisión diaria de lo capturado

Cadencia de diseño: revisar diariamente lo capturado durante el día y organizarlo.

Responsabilidad: dar al material una ubicación o asociación útil, relacionarlo con notas existentes y detectar duplicados. El esquema discutido es PARA: proyectos, áreas, recursos y archivo, con Inbox como bandeja temporal de entrada.

Organizar no requiere resumir profundamente el contenido, resolver una pregunta ni convertir una idea en tarea. Lo que todavía no encaje puede permanecer pendiente en Inbox.

Esta cadencia no implica que exista ya una tarea programada. No se acordaron una hora, un mecanismo de ejecución, permisos para mover archivos ni si la revisión será completamente autónoma o supervisada.

### 4. Recall: recuperar contexto para una necesidad concreta

Responsabilidad: buscar y devolver el conocimiento relevante cuando el usuario pregunta, retoma un proyecto, compara opciones o prepara un trabajo.

Si las notas existentes bastan, Recall las utiliza directamente. Si requieren elaboración, invoca al agente de destilación. No toda consulta necesita destilación y recuperar información no obliga a modificar la bóveda.

### 5. Distill: agente invocado por Recall

La destilación no será un procesamiento diario obligatorio de todas las capturas. Se realizará bajo demanda, vinculada a una necesidad de recuperación o uso.

Responsabilidad del agente: elaborar el material pertinente, extraer lo esencial y devolver una síntesis junto con sus fuentes. Debe distinguir los hechos de las hipótesis y conservar las diferencias o contradicciones relevantes.

Límites discutidos:

- No sustituir automáticamente las notas originales por una interpretación.
- No invocar al agente si el material ya responde de forma suficiente.
- No confundir la síntesis necesaria para contestar una consulta con conocimiento que deba persistirse.

La persistencia de una síntesis será una decisión explícita del flujo, no un efecto automático de cada consulta. Queda pendiente definir quién la decide y con qué criterios; no se ha establecido que siempre requiera confirmación manual del usuario.

### 6. Express: el usuario aplica el conocimiento

Express es el trabajo concreto para el que se recupera el conocimiento: crear una propuesta, tomar una decisión, escribir, diseñar o implementar, entre otros resultados.

El usuario dirige esa actividad y puede apoyarse en agentes. No se plantea una skill genérica adicional de Express como parte del mantenimiento del segundo cerebro.

## Flujo resumido

```text
Durante el día
  Ideas, referencias, preguntas y aprendizajes
    -> Capture
    -> Inbox

Revisión diaria
  Inbox
    -> Organize
    -> Material ubicado y relacionado
       (lo no resuelto puede seguir pendiente en Inbox)

Ante una necesidad concreta
  Usuario / trabajo en curso
    -> Recall
       -> Notas suficientes: devolver contexto y fuentes
       -> Elaboración necesaria: invocar agente Distill
          -> Devolver síntesis y fuentes
    -> Express: el usuario aplica el conocimiento,
       con ayuda de agentes si lo necesita

Persistencia de la síntesis
  Decisión separada; no automática por cada recall
```

## Ejemplo ilustrativo, no requisito de Yoyos

1. Capture conserva: «¿Y si el vendedor preparara una colección antes del live?» como posibilidad, no como decisión.
2. Organize relaciona la captura con Yoyos y la preparación de ventas.
3. Al retomar ese problema, Recall encuentra esa idea y otras notas relacionadas.
4. Si hay material disperso que elaborar, Distill devuelve una síntesis de posibilidades, evidencias y dudas, con sus fuentes.
5. El usuario usa esa síntesis para decidir qué explorar o para desarrollar una propuesta: Express.

## Preguntas pendientes antes de implementar

- ¿Qué señales activan Capture y qué propuestas del asistente se conservan sin una reacción explícita del usuario?
- ¿Cuál es la unidad de captura: idea individual, tema, conversación o combinación?
- ¿Qué campos son obligatorios y cómo se representa la procedencia?
- ¿Cómo se ejecuta la organización diaria y con qué autonomía para mover, combinar o archivar notas?
- ¿Qué criterios concretos hacen que Recall invoque a Distill?
- ¿Cómo selecciona Recall las fuentes y qué límites de lectura tiene el agente de destilación?
- ¿Cuándo una síntesis merece persistirse y cómo se conserva su relación con las fuentes?
- ¿Cómo se reflejará esta separación en las skills existentes sin reglas duplicadas?

## Estado de implementación

Este documento no crea ni modifica skills, agentes, automatizaciones o tareas programadas. Las skills existentes no deben tomarse como prueba de que este flujo ya está implementado; su adecuación queda pendiente de la definición final y de una solicitud de implementación.

La bóveda utilizada en esta conversación es `/Users/jorgegonzalez/Documents/Segundo Cerebro`.
