# Guía para definir producto en Yoyos

Esta guía describe cómo se define una funcionalidad de Yoyos a nivel de producto: qué problema resuelve, qué hace, qué ve cada persona, qué reglas rige, qué pasa cuando algo falla y qué queda fuera. No describe cómo se construye: la organización del código, la persistencia, los contratos técnicos y las pruebas ejecutables se definen después, en la fase de implementación, a partir del documento que produce esta guía.

Se usa recorriendo los pasos en orden. Cada paso tiene reglas con un ejemplo y, cuando ayuda, lo que no se hace. Los ejemplos son ilustrativos: muestran la forma de la decisión, no son decisiones ya tomadas sobre esa funcionalidad.

Yoyos es un SaaS para pequeños negocios de Perú que venden por WhatsApp e Instagram. Tiene una aplicación web y una aplicación móvil para el vendedor, y un checkout por enlace para el comprador. El vendedor opera sobre todo desde el teléfono, con el cliente esperando en el chat.

---

## Paso 1. Entender el problema y a quién le pasa

**1.1 Se parte de una situación concreta, no de una categoría.**
Antes de proponer nada se escribe qué hace hoy el vendedor o el comprador sin la funcionalidad, en qué momento ocurre y qué sale mal. Si no se puede contar una historia concreta, no se entiende el problema todavía.
- Ejemplo: «El vendedor recibe un "ya te pagué" por WhatsApp a las 9 de la noche, abre la app de su banco, busca el movimiento, y anota en un cuaderno qué pedido quedó pagado. Al día siguiente no recuerda si el de S/ 120.00 era de Carla o de Rosa».
- No hacer: «Los vendedores necesitan gestionar sus pagos».

**1.2 El usuario se define por la situación en que está, no por quién es.**
Para cada funcionalidad se nombra a cada actor por lo que está haciendo en ese momento: vendedor registrando una venta en tienda con el cliente delante; comprador que recibió un enlace y no tiene cuenta; vendedor revisando de noche qué quedó sin cobrar.
- Ejemplo: en un checkout hay dos usuarios: el comprador que abre el enlace desde WhatsApp en su teléfono y el vendedor que mira desde la app qué pedidos confirmaron.

**1.3 Se identifica quién resuelve hoy el problema hablando.**
En Perú el vendedor y el comprador ya conversan por WhatsApp. Antes de diseñar un flujo se pregunta si ese paso ya ocurre en la conversación. Si ocurre ahí, Yoyos registra el resultado y no lo reemplaza.
- Ejemplo: si el comprador pagó de menos, el vendedor le escribe y acuerdan el saldo. Yoyos registra el pago parcial y muestra el saldo pendiente. No hay un botón para «reclamar diferencia».

**1.4 Se escribe el resultado esperado como hipótesis.**
Qué cambia en el comportamiento del vendedor o del comprador si la funcionalidad funciona, y cómo se vería. No se prometen mejoras que no se van a observar.
- Ejemplo: «Si funciona, el vendedor deja de pedir la captura de pago por chat y la recibe adjunta al pedido; se vería en la proporción de pagos reportados con captura».

---

## Paso 2. Acotar la primera versión

**2.1 La primera versión cubre el caso habitual de punta a punta y nada más.**
Se diseña lo que el vendedor hace todos los días, completo, desde que empieza hasta que termina. Los casos raros se resuelven con un aviso claro y una salida manual, no con mecanismos adicionales.
- Ejemplo: al imprimir etiquetas, la primera versión imprime una etiqueta por producto con una impresora recordada. Si dos personas imprimen a la vez y una falla, la app avisa y ofrece reintentar. No se diseña una cola ni un turno de impresión.
- No hacer: diseñar para el escenario que el vendedor no ejecutaría, como cerrar un checkout «por envío sin confirmación» cuando el vendedor nunca envía sin confirmar.

**2.2 Se recorta por dimensiones visibles, nunca por confiabilidad.**
Para que la primera versión sea pequeña se limitan los tipos admitidos, los canales, las plataformas o los países. Lo que entra, entra completo y confiable: nada de «a veces se pierde» o «solo funciona si no cierran la app».
- Ejemplo: recibir mensajes de WhatsApp empieza con texto e imágenes de chats individuales, sin grupos ni audios. Pero ningún mensaje de los que sí entran puede perderse, incluso si el teléfono mata la app.
- No hacer: aceptar grupos y audios «con pérdida ocasional» para mostrar más alcance.

**2.3 Se amplía lo que existe antes de crear algo nuevo.**
Si Yoyos ya tiene una pantalla, un listado, un flujo o un concepto que cubre el caso, se extiende. Un concepto nuevo necesita una frase que explique por qué no sirve uno existente; si no la hay, no se crea.
- Ejemplo: el aviso «Ya pagué» del comprador no es un «aviso de pago» aparte: es un pago en estado «reportado», sin importe confirmado, que aparece en el mismo listado de pagos del pedido.
- No hacer: una entidad «solicitud de pago» con su propia pantalla cuando el pago ya tiene estados.

**2.4 Lo que se resuelve conversando no se convierte en flujo.**
Si un paso ya ocurre en el chat entre vendedor y comprador (pedir cambios, aclarar un pago, acordar la agencia), Yoyos no lo media. Se registra lo acordado y se indica, cuando hace falta, que el ajuste se resuelve fuera de la app.
- Ejemplo: tras confirmar el checkout, si el comprador quiere cambiar un producto, lo pide por el chat. El vendedor cancela el pedido y crea otro. No hay botón «Solicitar cambio».
- No hacer: disputas, rechazos, mensajería interna o notificaciones para situaciones que una conversación resuelve.

**2.5 Los datos escritos bastan para empezar.**
Direcciones, couriers, agencias y bancos se escriben a mano. Mapas, catálogos mantenidos por Yoyos y selectores se difieren hasta que el uso demuestre que hacen falta.
- Ejemplo: domicilio con dirección, distrito e indicaciones en texto; courier por nombre; agencia de destino escrita en cada pedido; billetera digital con número y titular, sin imagen de QR.

**2.6 Toda operación diaria del vendedor va en web y en móvil desde la primera versión.**
El vendedor opera desde el teléfono y la web es la referencia. Si una funcionalidad es del vendedor, se define en ambas plataformas con el mismo comportamiento, salvo que dependa de una capacidad del dispositivo (cámara, impresora junto a la mercadería), en cuyo caso se aprovecha esa capacidad aunque la web no la tenga.
- Ejemplo: confirmar un pago se hace en web y móvil ampliando el detalle del pedido. Imprimir etiquetas es solo móvil, porque la impresora está en el almacén junto al teléfono. La foto de producto se toma con la cámara en móvil aunque en web solo se elija un archivo.
- No hacer: «solo web» como primera versión de algo que el vendedor hace a diario.

**2.7 Se construye en rebanadas verticales.**
La primera rebanada es el caso más simple completo: configuración, uso, lo que ve el vendedor, lo que ve el comprador. Las siguientes rebanadas suman casos. No se construye toda la configuración antes de que nadie pueda usar nada.
- Ejemplo: modalidades de entrega se entrega como «retiro en tienda» completo (configurar el punto de retiro, asignarlo a un pedido, verlo en web y móvil). Después domicilio. Después agencia.

**2.8 Se respeta el corte entre ramas de trabajo.**
Cada funcionalidad se define en su propia tarea. Lo que pertenece a otra tarea no entra, aunque esté cerca, pero el diseño deja el punto de encuentro claro para que esa otra tarea solo sume.
- Ejemplo: el pago con confirmación manual se define con una vista provisional del pedido para el comprador, porque el checkout completo es otra tarea. La definición indica que el checkout mostrará ese mismo pago cuando llegue.
- No hacer: definir en una rama el botón de WhatsApp o el costo de envío que otra rama ya cubre.

---

## Paso 3. Diseñar el flujo y las pantallas

**3.1 El camino habitual se hace en el menor número de toques.**
Se identifica la acción que el vendedor hace casi siempre y se la convierte en la acción principal, con los valores por defecto cargados y lo que ya se sabe precargado. Las excepciones viven en ajustes o en acciones secundarias, no en un diálogo que aparece cada vez.
- Ejemplo: al crear un producto, la acción principal es **Guardar e imprimir** con una copia y la impresora recordada, porque casi todo producto nuevo necesita etiqueta. Al editar un producto, **Guardar** e **Imprimir** son independientes, porque editar no suele implicar reimprimir.
- Ejemplo: al confirmar un pago, el importe viene precargado con el saldo pendiente completo; el vendedor solo lo cambia si fue un pago parcial.
- No hacer: campos vacíos obligatorios cuando el valor habitual se conoce; un paso de configuración en cada operación.

**3.2 Los controles siguen la convención de la plataforma; el comportamiento es el mismo en todas.**
Un listado en móvil usa «Cargar más» y hojas para filtros; en web usa páginas numeradas y paneles. Lo que no cambia entre plataformas son los resultados, el orden, las reglas y los textos de los estados.
- Ejemplo: el catálogo móvil muestra productos de veinte en veinte con **Cargar más** y conserva la búsqueda; la web pagina. Ambos devuelven los mismos productos en el mismo orden para la misma búsqueda.
- No hacer: inventar una regla distinta en móvil con la excusa del patrón móvil.

**3.3 El trabajo del usuario nunca se pierde sin su permiso.**
Al volver de una pantalla se conserva la búsqueda, la lista cargada y la posición. Salir de un formulario con cambios o de una venta con carrito pide confirmación. Un error del servidor devuelve a la pantalla con lo escrito intacto y el campo afectado señalado.
- Ejemplo: el vendedor arma una venta con tres productos, confirma, y resulta que uno no tiene stock. La venta sigue en la pantalla de revisión con los tres productos y el que falta marcado; corrige la cantidad y vuelve a confirmar.
- No hacer: reiniciar la lista al volver, vaciar un formulario por un error, sobrescribir en silencio un cambio hecho desde otro dispositivo.

**3.4 Cada pantalla define sus estados y el texto de cada uno.**
Para cada pantalla se escribe qué se ve cuando todavía no hay nada, cuando está cargando, cuando no hay resultados para estos filtros, cuando falló la carga y cuando hay demasiados elementos. Son estados distintos con textos distintos.
- Ejemplo: historial de ventas sin ninguna venta: «Todavía no registras ventas. Crea la primera desde Productos». Con filtro sin resultados: «No hay ventas entre el 1 y el 7 de octubre». Sin conexión: «No se pudo cargar el historial» con **Reintentar**.
- No hacer: una lista vacía para los tres casos; mostrar un catálogo vacío cuando lo que pasó es que no hubo conexión.

**3.5 Mientras hay una operación pendiente de resolver, no se inicia otra igual.**
Si una acción con efecto (venta, pago, impresión) quedó en duda porque no llegó respuesta, la pantalla lo muestra, ofrece verificar o rehacer, y bloquea iniciar otra del mismo tipo hasta que se resuelva.
- Ejemplo: el vendedor confirma una venta y se corta la conexión. Al volver, la app muestra «Hay una venta pendiente de verificar» y no deja crear otra hasta comprobar si quedó registrada.

**3.6 Un identificador de negocio se muestra completo o no se muestra.**
Un código de producto, un número de pedido o un número de operación nunca se recortan con puntos suspensivos: dos elementos distintos parecerían iguales. Si no cabe, se usa otra presentación o se avisa.
- Ejemplo: en una etiqueta, el código de variante se imprime completo en hasta tres líneas; si aun así no cabe, la etiqueta no se imprime y se explica, pero el producto sí se guarda.
- No hacer: bloquear la operación principal (guardar) por un problema de presentación (imprimir).

**3.7 Las acciones dicen lo que hacen y las confirmaciones nombran el resultado.**
Un botón dice «Confirmar pago», no «Aceptar». Una confirmación de descarte dice «Eliminar pedido» y «Conservar pedido», no «Sí» y «No».

---

## Paso 4. Fijar las reglas de negocio

**4.1 Yoyos registra lo que el vendedor verificó; lo que el comprador declara es un aviso.**
El dinero que cuenta es el que el vendedor confirmó haber recibido. El comprador puede avisar y adjuntar evidencia, pero no fija importes ni confirma pagos. Del mismo modo, el comprador no fija precios, totales ni descuentos: los calcula Yoyos con los datos del vendedor.
- Ejemplo: el comprador toca **Ya pagué** y adjunta la captura de Yape. El pago queda «reportado» sin importe y el saldo del pedido no cambia. El vendedor revisa su banco, confirma e ingresa el importe recibido: recién entonces el saldo baja.
- No hacer: pedirle al comprador el importe y restarlo del saldo; confirmar automáticamente porque hay captura.

**4.2 Dinero, despacho y stock son procesos independientes.**
Cada uno tiene su propio ciclo y sus errores se corrigen por separado. Confirmar un pago no marca el pedido como enviado; anular un pago no devuelve stock ni cambia la entrega; registrar una entrega no cobra.
- Ejemplo: un pedido entregado hace una semana tiene un pago confirmado por error. Se anula ese pago y se registra el correcto. La entrega no cambia.
- No hacer: impedir anular un pago porque el pedido ya se despachó; encadenar «pagado» con «enviado».

**4.3 Lo acordado con el cliente se edita libremente hasta que se ejecuta; después se congela.**
Mientras un pedido está pendiente, su entrega, su destinatario y sus datos de comprador se pueden corregir. Al marcarlo enviado o entregado, esa información queda fija porque describe lo que realmente ocurrió.
- Ejemplo: el vendedor cambia la dirección de entrega dos veces antes de despachar. Después de marcar «Enviado», la dirección ya no se edita; si hubo un error, se resuelve con el courier y se anota en el pedido.

**4.4 Se registra aunque falten datos; los vacíos se muestran y se exigen solo cuando una acción los necesita.**
El vendedor puede anotar una venta sin saber todavía cómo se entregará ni el nombre completo del cliente. Un dato ausente es una presentación («Entrega por definir»), no un estado nuevo ni un bloqueo. Se exige cuando la acción lo requiere: confirmar un checkout exige nombre y teléfono; despachar exige destino.
- Ejemplo: el pedido #1001 se crea con «Cliente: Público general» y «Entrega por definir». Días después el vendedor asigna retiro en tienda y lo despacha.
- No hacer: rechazar el alta por campos que se completan después; inventar un estado «sin entrega».

**4.5 Los días se interpretan en la hora del negocio.**
Un filtro «ventas de hoy» abarca desde las 00:00 hasta las 23:59 en la hora de Lima. Yoyos opera en Perú con una sola zona horaria mientras no exista un negocio fuera del país.
- Ejemplo: una venta registrada el 28 de septiembre a las 11:30 p. m. hora de Lima aparece en el filtro «28 de septiembre», aunque en otra zona ya fuera 29.

**4.6 Cada proceso de cuenta tiene su propio propósito y no se mezcla con otro.**
Verificar el correo y recuperar la contraseña son procesos distintos: completar uno no completa el otro, cada uno tiene su propio vencimiento y su propio texto.
- Ejemplo: alguien que aún no verificó su correo recupera su contraseña. Entra con la nueva contraseña, pero el correo sigue sin verificar y se le sigue pidiendo.

**4.7 Un cambio de productos en un pedido es otro pedido.**
Un pedido existente no cambia sus productos: se cancela y se crea uno nuevo. Así el número de pedido siempre describe lo mismo que se acordó.

---

## Paso 5. Definir estados y qué puede cambiar cuándo

**5.1 Cada estado tiene nombre, significado para el usuario y transiciones permitidas.**
Para todo lo que tiene ciclo de vida (pedido, pago, entrega, conexión de WhatsApp, impresión) se lista cada estado con qué significa, qué lo provoca, qué puede hacerse en él y qué ve cada actor. Un estado se define por lo que el usuario necesita distinguir, no por lo que es cómodo guardar.
- Ejemplo: un pago es «reportado» (el comprador avisó, sin importe, no suma), «confirmado» (el vendedor verificó, con importe, suma al pagado) o «anulado» (fue un error, conserva importe y fecha, no suma). De reportado se pasa a confirmado o anulado; de confirmado solo a anulado; anulado es final.
- No hacer: estados que ningún actor necesita distinguir; banderas sueltas («tiene error», «está imprimiendo») sin un conjunto cerrado de estados.

**5.2 Un estado existe solo si alguien lo consulta o actúa sobre él; lo demás es presentación.**
Si nadie filtra, cuenta ni decide por una condición, no es un estado: es una forma de mostrar un dato que ya existe.
- Ejemplo: «Entrega por definir» no es un estado de entrega: es cómo se muestra un pedido que aún no tiene entrega asignada. «Checkout pendiente» sí interesa (el vendedor quiere ver qué pedidos esperan confirmación), pero se deriva de «el enlace se habilitó y aún no se confirmó».
- No hacer: «costo de envío pendiente» como estado para esperar a que exista la funcionalidad de tarifas; cero significa gratis.

**5.3 Lo que ya existía no hereda estados nuevos ni datos inventados.**
Al introducir un estado o un dato, los registros anteriores quedan como «sin ese dato», explícitamente. No se les atribuye un valor que nadie registró.
- Ejemplo: tras lanzar el checkout, los pedidos creados antes no aparecen como «pendientes de confirmación»: simplemente no tienen checkout. Un pago registrado antes de que existiera «quién lo confirmó» muestra «registrado por: desconocido», no el nombre del vendedor actual.

**5.4 Los registros se corrigen anulando y creando otro, no editando.**
Un pago, una entrega ejecutada o cualquier registro con efecto se corrige con una anulación que conserva el original, quién anuló y cuándo, más un registro nuevo. Anular no significa devolver dinero.
- Ejemplo: se confirmó un pago de S/ 150.00 cuando llegaron S/ 115.00. Se anula el de 150 (queda visible como anulado) y se registra uno de 115.

**5.5 No se crean estados ni pasos para esperar a otra funcionalidad.**
Cuando una rama futura va a añadir algo, la actual se define completa sin ese algo. La integración ocurre cuando llegue, no se deja un hueco con nombre.

---

## Paso 6. Definir qué pasa cuando algo falla

Toda acción con efecto (crear, confirmar, pagar, imprimir, enviar) se define con cuatro resultados posibles, y el documento dice qué ve el usuario en cada uno:

| Resultado | Qué pasó | Qué ve el usuario |
|---|---|---|
| Éxito | La acción se completó | Confirmación que nombra lo que realmente se garantiza |
| Rechazo conocido | Yoyos dijo que no (falta stock, importe inválido, pedido cancelado) | Vuelve a la pantalla con su trabajo intacto y el motivo junto al campo o elemento afectado, con el remedio |
| No se envió | Nunca salió (sin conexión, validación local) | Aviso y opción de reintentar sin riesgo |
| Resultado incierto | Salió pero no llegó respuesta | Aviso de que puede haberse completado; se verifica antes de repetir |

**6.1 Un resultado incierto nunca se presenta como éxito ni se repite automáticamente.**
Si no llegó respuesta, la acción puede haberse completado. Se verifica consultando antes de ofrecer repetir, y repetir usa el mismo intento, de modo que nunca se crean dos ventas, dos productos ni dos etiquetas.
- Ejemplo: se envía a imprimir y se agota el tiempo de espera después de que la impresora empezó a recibir. La app muestra «Puede haberse impreso; revisa la impresora antes de repetir» y ofrece **Imprimir de nuevo**.
- No hacer: mostrar «Guardado» sin confirmación; reintentar en bucle; crear un segundo registro al repetir.

**6.2 Repetir por duda no crea duplicados.**
Si el vendedor repite una acción que ya se completó, Yoyos lo reconoce y lo dice: «Este producto ya fue creado», con un enlace para verlo. No se crea otro ni se finge que se creó de nuevo.

**6.3 Lo principal no se deshace porque falle lo secundario.**
Si una acción tiene un efecto principal (crear el producto, registrar el pago) y uno secundario (imprimir, descontar stock, avisar), el fallo del secundario no borra ni repite el principal. Se avisa y se ofrece reintentar solo el secundario.
- Ejemplo: **Guardar e imprimir** guarda el producto y luego falla la impresora. El producto queda creado y la pantalla ofrece **Reintentar impresión** y **Cambiar impresora**, conservando variante y cantidad.
- Ejemplo: se confirma un pago y al descontar stock falta una unidad. El pago queda confirmado; la app avisa que el stock quedó sin ajustar y el vendedor lo resuelve en inventario.

**6.4 Un rechazo conocido se corrige en el sitio.**
Cuando Yoyos rechaza por una regla, el usuario vuelve a la pantalla de corrección con todo lo que escribió, el elemento afectado señalado y el remedio en el mensaje.
- Ejemplo: el total del checkout cambió porque el vendedor editó un precio mientras el comprador leía. Al confirmar, el comprador ve «El total cambió a S/ 95.00. Revisa y confirma de nuevo» con el formulario intacto.
- No hacer: cerrar el intento y obligar a empezar de cero; «Ocurrió un error» sin decir cuál ni dónde.

**6.5 Los mensajes hablan en el idioma del vendedor y nombran la garantía real.**
Ningún mensaje muestra nombres técnicos ni códigos internos. Un éxito dice exactamente lo que se garantiza: «aceptado por el proveedor» no es «entregado»; «enviado a la impresora» no es «impreso».
- Ejemplo: «No se pudo conectar con la impresora Brother del almacén» en vez de «Connection refused». «Correo enviado» solo cuando el proveedor lo aceptó; si no, «No pudimos enviar el correo, inténtalo en unos minutos».

**6.6 Nunca se continúa como si se hubiera guardado algo que no se guardó.**
Si guardar una preferencia, una sesión o un registro falla, la app lo dice y detiene lo que dependía de eso. «No hay dato» y «no se pudo leer» son situaciones distintas y se muestran distinto.
- Ejemplo: al leer la impresora recordada falla el almacenamiento del teléfono. La app no muestra «sin impresora configurada»; muestra «No se pudo leer la impresora guardada» y ofrece elegir una.

**6.7 Una respuesta tardía o de otra sesión no cambia lo que está en pantalla.**
Si llega una respuesta de un intento anterior, de otra impresión o de una sesión ya cerrada, se ignora. Solo la respuesta del intento visible actualiza la pantalla.

---

## Paso 7. Definir quién ve y hace qué

**7.1 Cada actor tiene su propio acceso y el acceso abre exactamente lo que es.**
El vendedor entra con su cuenta y ve lo de su negocio. El comprador entra por el enlace de un pedido y ve y hace solo lo que ese pedido permite: consultar, confirmar, avisar un pago. Conocer un enlace o un número no abre nada más.
- Ejemplo: el enlace del checkout permite ver el pedido #1001 y confirmarlo. No permite ver otros pedidos del mismo negocio, ni registrar pagos como vendedor, ni cancelar.

**7.2 La protección es la mínima que cierra el riesgo real, y el riesgo se nombra.**
Antes de agregar una capa (vencimiento, token, verificación extra) se escribe qué riesgo concreto cierra. Si no hay riesgo nombrable, no se agrega.
- Ejemplo: el riesgo del enlace de checkout es que alguien adivine enlaces ajenos. Un enlace imposible de adivinar lo resuelve. No necesita vencimiento ni un paso de verificación del comprador.
- No hacer: vencimientos, confirmaciones por correo o biometría «por si acaso».

**7.3 Nunca se revela si una cuenta existe.**
Registrarse con un correo ya usado y pedir recuperación de un correo desconocido responden exactamente igual que el caso normal.
- Ejemplo: «Si existe una cuenta con ese correo, recibirás un enlace en unos minutos», tanto si existe como si no.

**7.4 Lo que cada parte ve es lo mínimo que necesita, y la evidencia la ven las dos.**
El comprador no ve datos internos del negocio (costos, identificadores de contactos, notas del vendedor). El vendedor ve todo lo de su pedido, incluida la captura que subió el comprador; el comprador también ve la captura que subió.

**7.5 Lo que pertenece al vendedor se queda con el vendedor.**
La sesión de WhatsApp vive solo en su teléfono. Yoyos nunca la recibe, nunca lee mensajes desde su servidor y nunca envía avisos para despertar la app. Esta restricción no se discute ni se reformula.

---

## Paso 8. Decidir qué información se conserva

**8.1 El pedido guarda una copia de lo acordado; lo que es instrucción para actuar ahora se muestra actual.**
Lo que forma parte del acuerdo con el comprador (punto de retiro, dirección, destinatario, productos y precios) se copia en el pedido y no cambia aunque el negocio cambie su configuración. Lo que es una instrucción para actuar en este momento (número de billetera para pagar) se muestra siempre vigente.
- Ejemplo: el punto de retiro «Av. Lima 123» queda en el pedido aunque la tienda se mude. El número de Yape que ve el comprador al pagar es el actual del negocio, no el que había cuando se creó el pedido.
- Ejemplo: lo que escribe el comprador en el checkout (nombre, teléfono) queda en ese pedido; no modifica la ficha del contacto que el vendedor tiene guardada.

**8.2 Solo se conserva la última versión de lo acordado.**
Cada cambio reemplaza al anterior. No hay historial de versiones de una dirección ni de un destinatario. Si importa saber que algo cambió, se anota en el pedido, no se guarda cada versión.

**8.3 No se guarda lo efímero.**
Lo que no sobrevive a la operación (un trabajo de impresión, una lista cargada, un borrador de venta sin confirmar) no se conserva. Se guarda lo mínimo para recuperarse de una interrupción: qué estaba en duda y cómo verificarlo.
- Ejemplo: si la app se cierra con una venta a medias, al volver no se recupera el carrito. Si se cierra después de confirmar y antes de recibir respuesta, sí se recuerda que esa venta está en duda.
- No hacer: borradores recuperables, historial de impresiones, colas locales en una primera versión.

**8.4 Una preferencia del dispositivo sobrevive al cierre de sesión; los datos de una cuenta no se mezclan con otra.**
La impresora recordada es del teléfono, no de la cuenta: sigue ahí tras cerrar sesión. Las ventas, listas y pendientes son de la cuenta: se limpian al cerrar sesión o quedan ligados a esa cuenta para que otra no los vea.
- Ejemplo: un vendedor cierra sesión y entra con otra empresa. La impresora sigue elegida; el aviso de «venta pendiente de verificar» de la empresa anterior no aparece hasta que vuelva a entrar con ella.

**8.5 Lo que identifica algo es estable; lo que se muestra puede cambiar.**
Un pedido se muestra como «Pedido #1001», pero el enlace que se comparte no depende de ese número. Una impresora se recuerda por su identidad física, no por su dirección de red, que cambia. Un contacto de WhatsApp se reconoce por su identificador interno, no por su número ni su alias.

**8.6 El almacenamiento del teléfono es del usuario.**
Los archivos que Yoyos descarga o genera son privados, temporales, acotados en tamaño y se borran cuando dejan de servir. Nada va a la galería del teléfono.

**8.7 Mientras no haya usuarios reales, los cambios aplican a todos sin transición.**
No hay periodo de gracia, excepción ni conversión de datos anteriores mientras Yoyos no tenga negocios operando en producción. Esta regla caduca en cuanto los haya; se comprueba antes de aplicarla.

---

## Paso 9. Fijar el vocabulario y los textos

**9.1 Un solo nombre por concepto, en el documento y en la interfaz.**
Se elige un término para cada cosa y se usa siempre. Si el usuario ve «Ventas» en la pestaña, el documento dice que la pestaña se llama «Ventas» y que muestra pedidos; no alterna «venta», «orden» y «pedido» para lo mismo.

**9.2 Cuando dos términos se confunden, se definen y la definición queda escrita.**
- Ejemplo: modalidad es cómo recibe el comprador (tienda, domicilio, agencia); cobertura es a qué lugares se entrega; tarifa es cuánto cuesta. Pago reportado, confirmado y anulado se muestran como «Reportado», «Confirmado» y «Anulado».

**9.3 Las cosas se nombran por lo que hacen para el usuario, no por quién las provee.**
«Imprimir etiqueta», no el nombre del fabricante de la impresora; «Conectar WhatsApp», no el nombre de la librería; «Medio de pago: billetera digital», con Yape o Plin como opciones.

**9.4 Los textos visibles se escriben en el documento, entre comillas angulares.**
Botones, títulos, estados vacíos, mensajes de error y confirmaciones aparecen con su texto exacto. Un texto se escribe una vez y se recorta: la mitad de las palabras suele sobrar.

---

## Paso 10. Diferir con claridad

**10.1 Lo que no entra se nombra con su disparador.**
Cada ítem diferido dice qué lo desbloquea: «cuando exista control de frecuencia de envíos», «cuando se defina la funcionalidad de tarifas», «cuando haya negocios en producción». Un límite explícito vale más que una solución a medias.
- Ejemplo: «Cerrar la app entre confirmar la venta y recibir la respuesta deja la venta en duda; se verifica al volver. Un modo sin conexión queda para cuando se defina la sincronización diferida».

**10.2 Lo diferido con riesgo real se convierte en tarea.**
Si lo que queda fuera puede causar un problema operativo (pérdida, duplicado, bloqueo), se crea una tarea en el backlog y el documento la enlaza. Lo que solo es una mejora se lista en el documento.

**10.3 No se vuelve a proponer lo que ya se descartó o difirió.**
Si el fundador descartó una cola, un bloqueo, un receptor en servidor o cualquier mecanismo, no se reformula con otro nombre ni se insinúa. Si el agente cree que hay una razón nueva, la expone como pregunta en el bloque final, una sola vez, con la razón.

**10.4 No se construyen versiones parciales que luego haya que deshacer.**
Entre «hacerlo completo después» y «hacer la mitad ahora», se elige la primera.

---

## Paso 11. Decidir qué decide el agente y qué pregunta

El agente decide solo todo lo rutinario y lo deja escrito en el documento. Pregunta solo lo que cambia alcance, dinero, lo que se conserva, prioridades entre funcionalidades o contradice una decisión anterior. Pregunta con recomendación.

### Decide el agente y lo deja escrito

- **Patrones de interfaz estándar de cada plataforma:** pestaña frente a entrada en Inicio, «Cargar más» frente a páginas, pantalla editable frente a detalle con **Editar**, flujos en dos pasos con revisión, hojas para filtros y selección, avisos efímeros para procesos en segundo plano.
- **Conservación de contexto y confirmaciones de descarte:** conservar búsqueda, lista y posición; confirmar al salir con cambios; conservar el borrador ante conflicto.
- **Estados de pantalla y textos:** vacío, cargando, sin resultados, error, demasiados; textos de botones, mensajes y confirmaciones.
- **Comportamiento ante fallos:** los cuatro resultados del Paso 6 aplicados a cada acción; verificar antes de repetir; bloqueo de una segunda operación mientras hay una en duda.
- **Valores por defecto de seguridad de cuenta:** vencimientos de enlaces, cierre de otras sesiones al recuperar contraseña, respuesta uniforme que no revela cuentas.
- **Qué se copia en el pedido y qué se muestra actual,** siguiendo el Paso 8.
- **Qué es preferencia del dispositivo y qué es dato de la cuenta.**
- **Valores de calibración iniciales:** tiempos de espera, cantidades por página, tamaños máximos, marcados como «valor inicial, ajustable».
- **Lo que una regla de esta guía ya resuelve:** si la primera versión funciona solo en línea (sí), si hay cola o bloqueo entre operaciones (no), si un receptor en servidor es admisible (nunca).
- **Lo que ya está registrado en la memoria del repositorio o en un documento vigente.** Si la tarea contradice la memoria, prevalece la memoria y se anota.
- **Hechos comprobables en el código:** si existe una pantalla, un filtro, una capacidad. Se verifica, no se pregunta.

### Requiere al fundador

- **Alcance de la primera versión:** qué tipos, canales, plataformas, países, medios de pago o adjuntos entran; si hay modo sin conexión; si se cubre un caso límite con flujo propio.
- **Hechos del negocio real que fijan valores por defecto:** si casi todos los productos llevan etiqueta; cuántos puntos de retiro o billeteras tiene un negocio; qué demora tolera la recepción de mensajes; si ya hay negocios en producción.
- **Significado de una acción visible:** qué significa «Confirmar pedido» para el comprador; si la captura es obligatoria; quién elige la modalidad de entrega; si el comprador puede cambiar algo tras confirmar; cómo se muestra una diferencia de precio ya cobrada.
- **Reglas de negocio visibles que no se deducen del contexto:** si el checkout muestra los datos de cobro actuales o los del momento del pedido; si el filtro es por día o por fecha y hora; si verificar el correo es obligatorio para entrar.
- **Qué se conserva y quién lo ve** cuando no lo resuelve el Paso 8: si el comprador ve su propia captura; si se guarda quién registró cada cosa.
- **Prioridades y orden entre funcionalidades:** qué entra en esta tarea y qué en otra; en qué orden se construyen las rebanadas.
- **Nomenclatura visible al usuario** que fija un concepto nuevo: cómo se llama una modalidad, cómo se muestra un número de pedido.
- **Cualquier cosa que contradiga una decisión anterior.** Se expone la contradicción y se pregunta; nunca se reintroduce por iniciativa propia.

---

## Paso 12. Presentar el resultado

**12.1 El documento se entrega completo, con las decisiones rutinarias ya tomadas y visibles.**
No se entrega un esqueleto ni una lista de opciones. Se entrega el diseño completo, y cada decisión que tomó el agente sobre algo que el fundador podría querer cambiar aparece en «Decidido salvo objeción».

**12.2 Los criterios de aceptación son escenarios concretos.**
Cada criterio describe una situación con datos y un resultado observable, no una categoría.
- Ejemplo: «El comprador confirma un pedido cuyo total pasó de S/ 100.00 a S/ 95.00 mientras lo leía: ve el aviso del nuevo total, el formulario conserva sus datos y la confirmación no se registra hasta que vuelva a confirmar».
- No hacer: «Se validan los errores del checkout».

**12.3 Las preguntas van en un solo bloque, numeradas, con recomendación.**
Cada pregunta lleva el contexto en una línea, la opción recomendada primero con su razón, las alternativas y la consecuencia de cada una en alcance, datos o esfuerzo, para que se responda con un número. Aparte, la lista «Decidido salvo objeción».

```
Preguntas (responde con el número de opción):

1. ¿La captura de pago es obligatoria para tocar «Ya pagué»?
   (1) Obligatoria. Recomendada: es barata para el comprador y útil para que el vendedor verifique.
   (2) Opcional. Permite avisar sin comprobante; el vendedor verifica sin evidencia.

2. ¿La primera versión de ventas en móvil se limita a negocios de Perú?
   (1) Solo Perú, hora de Lima. Recomendada: sin configuración de zona horaria.
   (2) Cualquier país. Añade una zona horaria por negocio y su configuración.

Decidido salvo objeción:
- El historial muestra veinte ventas por página con «Cargar más».
- Salir de una venta con productos en el carrito pide confirmación; el carrito no se recupera después.
```

**12.4 Una pregunta del fundador del tipo «¿para qué sirve X?» es una objeción.**
Se responde en dos líneas y se ofrece la versión sin X. No se defiende X.

**12.5 Un mensaje corto con dos lecturas se reformula y se pregunta cuál es.**
Es la única pregunta que se hace antes de escribir el documento.
