# MVP · Preparación de despachos y rótulos imprimibles

[Ver tarea en Todoist](https://app.todoist.com/app/task/6hfvfVmhjj3MWjJ3)

## Objetivo

Ayudar al vendedor a organizar los pedidos por despachar y preparar sus paquetes sin copiar nuevamente los datos del comprador.

## Alcance

- Ampliar la consulta existente con filtros por estado, fecha de despacho y courier.
- Registrar la fecha de despacho y el courier cuando corresponda.
- Imprimir rótulos de destinatario a partir de los datos del pedido.
- Mantener los filtros actuales de cliente y fecha de venta; fecha de despacho representa un dato diferente.

## Criterios de aceptación

- El vendedor puede localizar los pendientes para una fecha y courier determinados sin confundir fecha de venta con fecha de despacho.
- Puede consultar los productos y el destino usando el pedido existente.
- Puede obtener un rótulo imprimible con negocio remitente, destinatario, contacto y destino; incluye agencia, referencia o documento cuando corresponda y estén registrados.
- Los rótulos utilizan los datos guardados del pedido, sin exigir volver a escribirlos.
- Un rótulo de destinatario no se presenta como guía oficial del courier.
- Los pedidos con datos insuficientes muestran qué falta antes de imprimir.

## Fuera de alcance

Excel para carga a couriers, reporte general, agrupación con conteos, cambios de estado por lote, guías oficiales, integración con couriers y compatibilidad obligatoria con impresoras específicas.

## Paralelismo e integración

Los rótulos pueden avanzar con el formato de destinatario acordado sin esperar pago ni checkout terminado. Los filtros por estado se integran con estados de despacho. La experiencia de impresión concreta se valida con el negocio piloto.
