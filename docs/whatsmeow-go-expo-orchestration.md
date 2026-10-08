# Orquestación de WhatsApp nativo para Expo

La [propuesta técnica](whatsmeow-go-expo-implementation.md) y el [backlog WA-01..14](whatsmeow-go-expo-tasks.md) son la referencia normativa de esta serie. El backlog sigue pendiente: esta línea base organiza el trabajo, no acredita implementación ni pruebas. Cada PR debe entregar su capacidad con los casos UT/IT asignados en la matriz del backlog y conservar una compilación verificable.

## Dependencias

```text
WA-01 → WA-02 → WA-03 ┬→ WA-04 ┐
                      └→ WA-05 ┴→ WA-06 → WA-07 ┬→ WA-08 ┐
                                                 └→ WA-09 → WA-10 ┴→ WA-11 ┬→ WA-12 ┐
                                                                             └→ WA-13 ┴→ WA-14
```

| Tarea | Entrega | Requiere |
| --- | --- | --- |
| WA-01 | Módulo Expo y callbacks Go/nativo | Línea base |
| WA-02 | Snapshot cifrado y recuperación | WA-01 |
| WA-03 | Stores transaccionales y errores de protocolo | WA-02 |
| WA-04 | Mensajes, identidad y referencias normalizados | WA-03 |
| WA-05 | API, QR y controlador de conexión | WA-03 |
| WA-06 | Entrega durable y confirmación | WA-04, WA-05 |
| WA-07 | Identidad PN/LID tardía | WA-06 |
| WA-08 | Historial por lote atómico | WA-07 |
| WA-09 | Logout y cambio de cuenta | WA-07 |
| WA-10 | Archivos privados de imágenes | WA-09 |
| WA-11 | Presupuestos persistidos | WA-08, WA-10 |
| WA-12 | Servicio y recreación Android | WA-11 |
| WA-13 | Recuperación iOS al reanudar | WA-11 |
| WA-14 | Evidencia integral y límites | WA-12, WA-13 |

## Ramas, implementación y revisión

La línea base usa `jorgeluis594/add-bailyes` con un PR **draft** hacia `main`. Sus commits previos de SQLite móvil y del probe Go forman parte de ese PR; la revisión debe considerar el diff completo contra `main`. No fusionar automáticamente.

Para que cada PR tenga una sola base revisable, usar una pila lineal en orden `WA-01` a `WA-14`: rama `jorgeluis594/wa-01` desde la línea base, y cada `jorgeluis594/wa-NN` desde la rama `wa-(NN-1)`. Abrir el PR de cada tarea contra su rama predecesora; el PR de WA-01 apunta a `jorgeluis594/add-bailyes`. Este orden serializa WA-04/05, WA-08/09 y WA-12/13 por claridad de diff, aunque sus capacidades son independientes en el DAG. No empezar WA-06, WA-11 o WA-14 sin ambas capacidades que les corresponden.

Asignar la implementación y las correcciones de cada tarea a **Sol 6 medium**. Después de que el autor publique una rama revisable, asignar a **Astra medium** una revisión del diff *contra la base de ese PR*, incluyendo código conectado, casos UT/IT, seguridad, concurrencia y límites relevantes. Sol corrige los hallazgos en la misma rama y Astra vuelve a revisar el delta actualizado antes de solicitar integración. Registrar en el PR comandos, resultados, casos pendientes y evidencia de plataforma; generar bindings por sí solo no demuestra ejecución nativa.

Al fusionar un PR, retargetear su sucesor a la nueva base (`main` si corresponde) y actualizar las ramas descendientes para conservar diffs limpios; verificar el diff de cada PR tras el cambio de base. La integración requiere revisión y checks satisfactorios, y sigue siendo una decisión explícita; no habilitar auto-merge ni declarar una tarea cerrada por abrir su PR.

Las pruebas automatizadas usarán transporte y servicios controlados y, cuando corresponda, APIs nativas reales. No hay teléfono disponible para QA manual en esta línea base: toda evidencia que exija hardware Android/iOS real queda **sin ejecutar** hasta disponer de ese entorno. La cobertura de 242 IDs (68 UT, 174 IT) en el backlog es asignación, no resultado de pruebas ni prueba de compatibilidad con WhatsApp real.
