# Hechos del producto

Lo que un agente debe saber de Yoyos y de sus usuarios antes de definir una funcionalidad. Son hechos de producto y de mercado, no de construcción. Los marcados con [verificar] pueden haber cambiado: comprobarlos en el repositorio, en la memoria del proyecto o en Todoist antes de apoyarse en ellos.

## Negocio y mercado peruano

- Los negocios cobran por billetera digital (Yape, Plin) y por transferencia bancaria. El comprador suele enviar una captura de pantalla de la operación como comprobante.
- El vendedor resuelve las diferencias de pago (falta dinero, pago no encontrado, aclaraciones) hablando con el cliente por WhatsApp. Yoyos no necesita un flujo de disputa.
- Un negocio tiene como máximo una billetera digital y una cuenta bancaria configuradas; el checkout muestra titular y número o cuenta.
- Un negocio tiene un solo punto de retiro en tienda, con nombre, dirección e indicaciones escritas a mano.
- Los couriers los escribe el negocio por nombre; no se eligen de una lista de Yoyos. La agencia de destino es texto libre acordado con el cliente en cada pedido.
- Las agencias de courier exigen documento de identidad del destinatario para entregar el paquete; por eso el documento es obligatorio solo en retiro en agencia.
- Las ventas en tienda son inmediatas: se cobran por billetera digital, se confirman a mano sin número de operación y se entregan en el momento. El precio es el del catálogo al completar y el carrito no reserva stock.
- Casi todos los productos nuevos necesitan etiqueta QR; lo habitual es una etiqueta por producto, no una por unidad física. Editar un producto no implica reimprimir.
- La etiqueta objetivo es una etiqueta troquelada pequeña impresa por Wi-Fi desde el teléfono, con un QR por variante.
- El vendedor opera sobre todo desde el móvil y usa Yoyos a diario. Aun así, la recepción de mensajes debe funcionar con la app minimizada.
- Los ajustes de batería del teléfono son responsabilidad del vendedor; Yoyos no diseña alrededor del modo ahorro.
- Yoyos lanza en Perú con hora de Lima; no existe zona horaria por negocio [verificar].
- El vendedor comparte el enlace de checkout por el canal que prefiera. El checkout no se asocia a un chat de WhatsApp ni requiere un teléfono público del negocio.
- El vendedor no despacha un pedido antes de que el comprador lo confirme; no hace falta modelar ese escenario.
- No hay cambio de productos en un pedido ya creado: se cancela y se crea otro.
- WhatsApp identifica a un contacto por número, por un identificador interno estable o por un alias que el usuario puede cambiar. Yoyos reconoce al contacto por el identificador interno.

## Qué puede hacer hoy el vendedor en la web

- Crear cuenta, verificar el correo (obligatorio antes de entrar) y crear su empresa [verificar].
- Recuperar la contraseña por correo.
- Gestionar productos: listar, buscar, crear, editar, precios, código de variante, stock e imágenes.
- Registrar ventas manuales con carrito, contacto opcional («Público general» por defecto) y descuento de stock al completar.
- Ver el historial de ventas filtrado por días y por cliente.
- Ver cada pedido con su estado de pedido, de pago y de entrega por separado; registrar pagos parciales; anular pagos.
- Asignar y editar la entrega de un pedido (destinatario y destino) mientras no se haya despachado.
- Ver el número visible de cada pedido, correlativo por negocio desde 1001.
- Habilitar el checkout por enlace de un pedido y ver si el comprador lo confirmó [verificar].
- No existen roles: cada cuenta ve todo lo de su empresa y nada de otras.
- No hay negocios operando en producción [verificar]: los cambios de reglas aplican a todos sin transición.

## Qué puede hacer hoy el vendedor en el móvil

- Pestañas principales: Inicio, Productos y Ventas [verificar].
- Ver el catálogo, buscar, crear y editar productos, con foto desde galería o cámara.
- Imprimir etiquetas QR desde el producto, con impresora recordada en el teléfono; disponible primero en Android [verificar].
- Registrar una venta en dos pasos (elegir productos, revisar y confirmar) y ver el historial.
- Si una venta queda en duda por falta de respuesta, el móvil la recuerda y bloquea crear otra hasta verificarla.
- El móvil funciona solo con conexión: no hay modo sin conexión ni cambios encolados.
- Vincular WhatsApp escaneando un QR; una sola cuenta de WhatsApp por instalación.

## WhatsApp

- La sesión de WhatsApp del vendedor vive exclusivamente en su teléfono. Nunca está en el servidor de Yoyos y Yoyos nunca envía notificaciones para despertar la app. Esta restricción es innegociable.
- La sesión nunca puede perderse: que un vendedor tenga que volver a escanear el QR es un fallo grave.
- Primera versión: solo recibir texto e imágenes de chats individuales, incluidos los mensajes que el vendedor envió desde otro dispositivo. Sin grupos, sin audios, sin envío desde Yoyos.
- Las imágenes recibidas se guardan de forma privada y temporal, se suben a Yoyos y se borran del teléfono; nunca van a la galería.
- Recibir en segundo plano es requisito, con tolerancia de segundos, no de minutos. En Android se muestra una notificación persistente mientras la app escucha; en iOS la recepción con la app suspendida sigue pendiente [verificar].
- Los mensajes recibidos se sincronizan con Yoyos para que el vendedor los vea junto a sus pedidos; qué hace Yoyos con ellos se define en otra funcionalidad [verificar].

## Forma de trabajo

- Las definiciones de producto las escribe el agente completas aplicando esta guía: decide solo lo rutinario y lo deja anotado, y agrupa en un solo bloque las pocas preguntas que cambian alcance, dinero, lo que se conserva o prioridades.
- Un documento que toma decisiones de alcance sin señalarlas se trata como borrador: cada decisión que requería al fundador debe estar visible en el bloque de preguntas o en «Decidido salvo objeción».
- Cada funcionalidad está ligada a una tarea de Todoist. Antes de entrar en terreno de otra funcionalidad se revisa Todoist para no duplicar alcance.
- La descripción de una tarea puede estar desactualizada frente a decisiones posteriores guardadas en la memoria del repositorio; la memoria prevalece. Al cerrar una definición se actualiza la tarea con lo acordado.
- Las funcionalidades son secuenciales y no se bloquean entre sí: cada una deja su punto de encuentro definido y las demás integran al final.
- El documento de producto vive en `docs/` y se mantiene actualizado con cada acuerdo. Describe solo el diseño vigente, sin referencias a decisiones descartadas. Al reorganizarlo no se pierde detalle.
- Después del documento de producto viene la fase técnica (arquitectura, datos, contratos, pruebas), que lo toma como definición de comportamiento. En la fase de producto no se implementa nada.
- Las decisiones que deben regir funcionalidades futuras se registran en la memoria del repositorio.
- El fundador audita cada concepto preguntando «¿qué es X?» y cada protección preguntando «¿para qué sirve?». Si no hay una respuesta de una línea, X sobra.
