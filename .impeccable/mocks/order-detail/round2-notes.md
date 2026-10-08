# Detalle de pedido — segunda ronda de propuestas

Estado: tres propuestas raster abiertas e inspeccionadas; el usuario eligió A el 2026-10-08 porque agrupa campos y datos, mientras las otras opciones tienen demasiado texto. A es la dirección actual aprobada; se preserva la evidencia anterior. El usuario solicitó posteriormente implementar A; estado de implementación y checks en ../../review/order-detail/round2-report.md.

Modo Operate; mundo visual existente de PRODUCT.md y DESIGN.md. Referencias: capturas finales 06-detalle-superior, 06-detalle-entrega, 01-inicio, 04-pedidos y 03-configuracion. Generadas con image_gen nativo; prompts exactos y referencias en los sidecars de cada opción.

- A, resumen conectado: comprador integrado en cabecera, productos y pago agrupados; entrega contextual y detalles progresivos. Conserva mayor cantidad de información visible.
- B, acción contextual: saldo y acción disponible primero, seguido de lista conectada; desglose secundario. Recomendación inicial del agente, no elegida por el usuario, por reducir más la carga visual y mantener el lenguaje de Inicio y Pedidos. Actualizar entrega abre opciones válidas de envío o entrega directa.
- C, ficha compacta: una sola ficha con separadores y acciones de entrega junto a los datos. Menos tarjetas; acceso directo, a costa de mantener más filas monetarias visibles.

Cada imagen muestra la vista completa sin pago y un ejemplo con pago cubierto y detalles abiertos. Son composiciones de scroll extendido, no evidencia de ejecución en teléfono. Los datos de destinatario de los ejemplos son ficticios.

Contrato funcional para cualquiera de las opciones: preservar guardas reales de pago/stock/estado, entrega directa o envío, edición de modalidad, cancelación y recuperación incierta, historial y revisión/anulación de pagos, comprobantes, sobrepago y cambios de precio. Los avisos excepcionales siguen junto a su sección y conservan anuncios accesibles. No forzar asignación de modalidad como requisito nuevo. Un solo motivo visible cuando envío y entrega comparten bloqueo; ningún CTA inactivo repetido.

La confirmación del comprador mantiene generación del enlace, copia, URL seleccionable y recuperación manual ante error. Detalles internos conserva stock, vendedor, autor, fecha de finalización y costo interno separado del cargo al cliente. Todos los controles mantienen etiqueta, foco, semántica, estados ocupados y área mínima de 48dp; las filas se adaptan al texto grande y tema oscuro con tokens existentes.

Límites detectados del raster: A añadió miniaturas de producto fuera de alcance; se conservarían filas de texto existentes. B generó el subtítulo Sin pagos registrados en un ejemplo pagado: no se debe literalizar, se usa el historial real. C conserva Ver desglose con el desglose abierto: ajustar etiqueta/chevron al estado real, sin duplicación. Son decisiones de composición, no datos nuevos ni cambios de reglas.

La fase de propuestas se realizó sin cambios de código, pruebas, QA exhaustivo ni acceso al celular. Evidencia anterior intacta.

## Aclaración funcional del usuario — datos manuales de entrega

Regla común a A, B y C: asignar o editar datos de entrega NO exige pago. En pedidos activos, no cancelados y con entrega pendiente, Asignar/Editar permanece disponible incluso sin pago o con pago parcial. Se conservan los bloqueos transitorios por operación/recuperación y las validaciones del formulario. Los tres raster ya muestran Asignar en el estado sin pago; Editar debe conservar la misma disponibilidad cuando existen datos. No se regeneran imágenes ni se altera su prompt de procedencia.

La acción manual queda junto a los datos, separada de marcar enviado/entregado. El motivo de pago se refiere exclusivamente a estas dos operaciones de cumplimiento, cuyas guardas de pago completo, stock y estado no cambian.

Lectura de código: canEditDelivery en order-detail-screen.tsx:219 no consulta pago; order-delivery-screen.tsx:61 tampoco lo utiliza para bloquear el formulario; save conserva solo bloqueos de operación, estado, selección y cotización. canSetDelivery en order-state-machine.ts:251 y setOrderDelivery en application/set-delivery.ts:33 permiten la edición pendiente sin exigir pago. No se encontró un bloqueo indebido por pago. Verificación solo por lectura, sin tests ni QA.
