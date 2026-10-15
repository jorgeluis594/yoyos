# Couriers y opciones de entrega: decisiones

Fecha: 2026-10-15.

## Contexto

Se evaluó ampliar los couriers (Marvisur, Dinsides, Encomienda, Delivery) y agregar un courier "Personalizado". También se comparó el modelo actual con el de Shopify, que separa domicilio y agencia por tipo de método de entrega y genera los puntos de recojo desde un proveedor externo según la dirección del cliente.

## Decisiones

| #  | Decisión | Estado |
| -- | -------- | ------ |
| C1 | Se mantiene el modelo actual de modalidades: entrega a domicilio, envío a agencia y recojo en tienda. | Decidido |
| C2 | Una zona agrupa distritos y puede tener muchas opciones. Cada opción es de una sola modalidad: domicilio o agencia. | Decidido |
| C3 | Una opción a domicilio tiene nombre libre, tarifa y estado. No se asocia a un courier. | Decidido |
| C4 | Una opción de agencia tiene nombre, tarifa, estado y las sedes que el negocio elige. El courier se deduce de la sede y se guarda en el pedido. | Decidido |
| C5 | El negocio elige el courier y sus sedes dentro de cada opción de agencia de la zona. Al guardar la zona, los couriers del negocio (`CompanyCourier`) se derivan de las sedes de sus opciones de agencia: se crea un courier por cada courier referenciado, aunque la opción o la zona estén desactivadas, y queda habilitado solo si lo usa una opción habilitada en una zona habilitada. El negocio deja de enviar con un courier desactivando o quitando sus sedes de la opción. Guardar "Modalidades de entrega" ya no recibe ni modifica couriers (ni en web ni en móvil). Que el courier o la sede estén deshabilitados en el catálogo no cambia este estado: la cotización los filtra al cotizar. Activar "Envío a agencia" no exige couriers habilitados: una opción sin sedes elegibles no se cotiza. | Decidido (rediseño del 2026-10-15) |
| C7 | Una opción de agencia nueva no se guarda sin sedes (las guardadas antes sin sedes siguen editables), sus sedes son de un solo courier (cambiar de courier descarta las sedes del anterior) y su nombre se prellena con el courier elegido mientras el negocio no lo cambie. | Decidido (rediseño del 2026-10-15) |
| C6 | No se muestra al cliente un catálogo de agencias generado automáticamente por cercanía (modelo Shopify `PICKUP_POINT`). El cliente elige entre las sedes que el negocio asoció a la opción. | Decidido |

## Pospuesto

- Agregar Marvisur, Dinsides u otros couriers al catálogo.
- Courier "Personalizado" (encomienda o delivery con texto definido por el negocio).
- Asociar un courier a las opciones a domicilio.
- Registrar transportista y número de seguimiento al despachar.

Mientras tanto, un courier a domicilio o un delivery propio se representa como una opción a domicilio con su nombre (por ejemplo, "Dinsides").

## Referencias

- `docs/refactor-zonas-opciones-agencias.md`: modelo de zonas, opciones y agencias.
- `docs/analisis-competencia-latam5s.md`: métodos de entrega de LATAM5S.
- [Pickup Point Delivery Option Generator API (Shopify)](https://shopify.dev/docs/api/functions/unstable/pickup-point-delivery-option-generator)
