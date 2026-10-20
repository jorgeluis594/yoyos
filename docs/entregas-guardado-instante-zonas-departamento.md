# Guardado al instante de modalidades y zonas por departamento: definición de producto

**Estado:** definición lista para implementar. 19 de octubre de 2026. Parte de la pantalla de entregas que existe hoy en web (`settings/delivery`) y en móvil: tres modalidades con un botón «Guardar configuración» y zonas que agrupan distritos elegidos de uno en uno. Complementa las [decisiones de couriers y opciones](couriers-y-opciones-de-entrega-decisiones.md) (C1–C7) y el [refactor de zonas, opciones y agencias](refactor-zonas-opciones-agencias.md) (D1–D14), que siguen vigentes. Tarea de Todoist 6hpQPg75pr9H38gV. El diseño técnico va en [entregas-guardado-instante-zonas-departamento-technical.md](entregas-guardado-instante-zonas-departamento-technical.md).

## Problema y situación

Una vendedora que despacha a todo el sur abre «Modalidades de entrega» desde el celular para empezar a ofrecer envío a agencia. Activa el switch, baja a configurar la zona y, al volver, la pantalla le dice «Tienes cambios sin guardar»: el switch no se había guardado porque faltaba tocar «Guardar configuración» al final del bloque. Después crea la zona «Zona sur» para cobrar S/ 15.00 en Arequipa y Cusco: tiene que elegir departamento, provincia y marcar distrito por distrito en las 8 provincias de Arequipa y las 13 de Cusco, 225 distritos en total. Se rinde a la mitad y deja la zona solo con la capital. El aviso de que le falta una opción de agencia con cobertura aparece abajo, en la sección de zonas, y no le dice que su única opción de agencia no tiene sedes elegibles: el comprador de Cayma no ve ninguna tarifa y le escribe por WhatsApp preguntando cuánto cuesta el envío.

## Objetivo

El vendedor configura sus entregas con menos pasos y sin perder cambios: cada modalidad se guarda al tocar su switch, el punto de recojo se guarda al terminar de escribir y una zona cubre departamentos o provincias enteros con una sola marca.

Hipótesis: si funciona, desaparecen las modalidades activadas en pantalla pero no guardadas y bajan las zonas con cobertura parcial de un departamento. Se notaría en que los compradores de distritos fuera de la capital del departamento reciben tarifa al cotizar.

## Usuarios y superficies

| Usuario | Necesidad | Superficie |
| --- | --- | --- |
| Vendedor que configura por primera vez cómo entrega | Activar modalidades y ver al instante qué le falta para que se coticen | Web (390 y 1280 px) y móvil, Configuración → Entregas |
| Vendedor que amplía su cobertura a otro departamento | Agregar Arequipa y Cusco a una zona con una tarifa, sin elegir 225 distritos | Web y móvil, «Zonas y tarifas de envío» |
| Comprador que abrió el link del pedido y elige su distrito | Recibir la tarifa de su distrito aunque la zona se haya definido por departamento | Checkout web, sin cambios de diseño |

## Alcance de la primera versión

Una sola entrega, con la Parte 1 construida antes que la Parte 2.

- **Parte 1, web y móvil:** guardado al instante de los tres switches (Recojo en tienda, Entrega a domicilio, Envío a agencia) y del punto de recojo; avisos de guardando, guardado y error junto a cada modalidad; reversión del switch si falla; conflicto de versión con recarga que conserva lo que se editaba en otra parte; aviso de cobertura junto al switch de domicilio y de agencia, que en agencia considera sedes elegibles; desaparece el botón «Guardar configuración».
- **Parte 2, web y móvil:** marcar departamentos enteros y provincias enteras en el selector de distritos de la zona, mostrarlos como una sola entrada en la selección, en la lista de zonas y al reabrir; aviso de solape antes de guardar; la cotización del checkout los cubre.
- Solo Perú, con el catálogo de geografía vigente (25 departamentos, 196 provincias, 1892 distritos).
- Se reutilizan los componentes, estilos y layout actuales: tarjetas, `Switch`, `Alert`, `Button`, `FieldDescription`, el selector de distritos y la lista de zonas, y sus equivalentes en móvil.

Puntos de encuentro con otras tareas:

- 6hhgPHPcVvfJH253 (selector configurable por país) y 6hjQ2chgJx6Q3qMV (geografía genérica): esta tarea agrega la marca de departamento y provincia completos al selector actual; esos refactors la incorporan como una capacidad de su configuración, sin duplicarla.
- 6hpQ6v6PCQ55pgM3 (checkout con recojo en agencia): usa la misma cotización por distrito. Una zona por departamento solo cambia qué opciones aplican a cada distrito.
- 6hp2wX7FfqChCmW3 (Escape borra la selección del selector): mismo componente; conviene corregirlo antes o junto con la Parte 2.

## Fuera de esta versión

- Excluir distritos de un departamento o provincia elegidos. Se activa si los vendedores crean muchas zonas de una sola excepción. Mientras tanto, el precio distinto se da con otra zona para ese distrito.
- Avisar de solape al reactivar una zona desactivada con **Reactivar**. Se activa si el solape por reactivación genera reclamos; hoy la tarifa extra es visible en la cotización.
- Rediseño de la pantalla de configuración o del checkout.
- Cambios en opciones, tarifas, couriers o sedes; carga de sedes reales (6hpPJM53WPcwJvJ3).
- Refactor de geografía (6hjQ2chgJx6Q3qMV) y del selector (6hhgPHPcVvfJH253).
- Tarifas por peso, distancia o mapa. Otros países.

## Flujo

### Parte 1. Activar una modalidad

1. El vendedor abre Configuración → Entregas. Ve las tres modalidades con su switch, sin botón de guardar.
2. Toca el switch de «Envío a agencia». El switch cambia en el acto y bajo la descripción de la modalidad aparece «Guardando…».
3. Al confirmarse, el texto pasa a «Guardado». Si no hay una opción de agencia activa con sedes elegibles en una zona activa, aparece además el aviso «Falta una opción de agencia activa con cobertura» con el enlace **Ir a zonas y tarifas**.
4. El vendedor recarga la página o abre la app en otro dispositivo y ve la modalidad activada.

Caminos alternativos:

- **Falla el guardado:** el switch vuelve a su estado anterior y la modalidad muestra el motivo con **Reintentar**.
- **Otra persona cambió la configuración:** el switch vuelve a su estado anterior, aparece el aviso de conflicto con **Recargar configuración**; recargar no borra el texto del punto de recojo sin guardar ni el borrador de zona abierto.

### Parte 1. Activar recojo en tienda sin punto de recojo

1. El vendedor toca el switch de «Recojo en tienda» sin haber guardado nombre y dirección.
2. El switch sigue apagado, se abren los campos del punto de recojo y junto al switch aparece «Completa el nombre y la dirección para activar el recojo.»; el foco va al primer campo vacío.
3. El vendedor escribe el nombre y la dirección. Al salir del campo o al dejar de escribir, se guardan.
4. Cuando el nombre y la dirección quedan guardados, el recojo se activa en ese mismo guardado: el switch se enciende y aparece «Guardado».

### Parte 2. Crear «Zona sur» con dos departamentos

1. En «Zonas y tarifas de envío», el vendedor toca **Agregar zona** y escribe «Zona sur».
2. En «Distritos de la zona», elige el departamento Arequipa y marca **Todos los distritos de Arequipa**. El resumen dice «109 distritos seleccionados: Arequipa, todos los distritos». No se despliega la provincia ni la lista de distritos.
3. Elige el departamento Cusco y marca **Todos los distritos de Cusco**. El resumen dice «225 distritos seleccionados: Arequipa, todos los distritos; Cusco, todos los distritos».
4. Agrega una opción a domicilio de S/ 15.00 y toca **Guardar zona**.
5. La lista de zonas muestra «Zona sur» con «Arequipa, todos los distritos; Cusco, todos los distritos».
6. Un comprador de Cayma (Arequipa) o de Wanchaq (Cusco) recibe la tarifa de S/ 15.00 en el checkout; uno de Miraflores (Lima) no.

Caminos alternativos:

- **Solape:** si la selección comparte distritos con otra zona activa, antes de **Guardar zona** aparece el aviso con cuántos distritos comparte; guardar sigue permitido.
- **Provincia entera:** elige departamento Lima, provincia Lima y marca **Todos los distritos de la provincia Lima**; la entrada es «Lima (provincia), todos los distritos».
- **Desmarcar:** desmarcar el departamento o la provincia saca de la zona todos sus distritos.

## Pantallas

**Modalidades de entrega (web y móvil):** Configuración → Entregas.

- Mismas tarjetas, filas y switches de hoy. Desaparecen el botón «Guardar configuración», el aviso «Tienes cambios sin guardar.» y el aviso general «Configuración guardada.».
- Cada modalidad muestra su propio estado de guardado bajo su descripción, con los componentes de aviso actuales (texto de ayuda para «Guardando…» y «Guardado», `Alert` destructivo para errores; en móvil, el texto pequeño y el texto de error que ya usa la pantalla):
  - «Guardando…» mientras el guardado está en curso.
  - «Guardado» al confirmarse. Se mantiene hasta el siguiente cambio de esa modalidad.
  - Error con su motivo y **Reintentar**, ver "Cuando algo falla".
- Mientras una modalidad se guarda, los tres switches quedan deshabilitados; los campos del punto de recojo siguen editables y su cambio se guarda al terminar el guardado en curso.
- **Entrega a domicilio:** con el switch encendido y sin cobertura, muestra «Falta una opción de domicilio activa con cobertura» y **Ir a zonas y tarifas**.
- **Envío a agencia:** con el switch encendido y sin cobertura, muestra «Falta una opción de agencia activa con cobertura» y **Ir a zonas y tarifas**. Si el catálogo de couriers está vacío, sigue mostrando «Todavía no hay couriers disponibles para envío a agencia. Mientras tanto, ofrece entrega a domicilio o recojo en tienda.» en lugar del aviso de cobertura.
- **Ir a zonas y tarifas** lleva a la sección «Zonas y tarifas de envío» de la misma pantalla.
- Los avisos de cobertura dejan de mostrarse en la sección de zonas: viven solo junto al switch.
- **Recojo en tienda:** campos «Nombre del punto de recojo», «Dirección» e «Indicaciones (opcional)», sin botón aparte.
  - En web, los campos se ven con el recojo activado o mientras el vendedor intenta activarlo; con el recojo desactivado se ve, como hoy, «Guardamos tu punto para cuando lo vuelvas a activar: {nombre} · {dirección}». En móvil, los campos se ven siempre, como hoy.
  - Cada campo se guarda al salir de él o tras 1.5 segundos sin escribir (valor inicial, ajustable). No se guarda en cada tecla.
  - El estado de guardado del punto se muestra en la fila de Recojo en tienda, igual que el del switch.
  - Un campo obligatorio vacío muestra junto al campo «Completa los campos obligatorios.» y ese cambio no se guarda; se conserva el último punto guardado.
- Salir de la pantalla con un texto del punto de recojo sin guardar (en curso o con error) pide confirmación: «Hay cambios del punto de recojo sin guardar.» con **Salir sin guardar** y **Seguir editando**.
- Estados de carga y error de carga: los de hoy («No se pudo cargar la configuración» con **Recargar configuración**).

**Zonas y tarifas de envío, lista (web y móvil):**

- Cada zona muestra sus entradas separadas por «; »: primero los departamentos completos, luego las provincias completas y luego los distritos sueltos, cada grupo en orden alfabético. Ejemplo: «Arequipa, todos los distritos; Lima (provincia), todos los distritos; Miraflores · 150122».
- Los distritos sueltos conservan el formato de hoy, «Nombre · código».
- Una zona creada distrito por distrito se ve como hoy, con el separador «; ».
- Ya no muestra los avisos de cobertura (pasan a las modalidades). El resto de la lista (opciones, tarifas, «Sin agencias elegibles: no se ofrece al cotizar», **Editar**, **Desactivar**, **Reactivar**) no cambia.

**Zonas y tarifas de envío, editor de zona (web y móvil):**

- Mismo editor y mismo selector «Distritos de la zona», con dos marcas nuevas:
  - Al elegir un departamento aparece, junto al selector de departamento, **Todos los distritos de {departamento}**: casilla en web, switch en móvil, con el mismo estilo de las filas de distrito.
  - Al elegir una provincia aparece, junto al selector de provincia, **Todos los distritos de la provincia {provincia}**.
- Con el departamento visible marcado como completo, el selector de provincia y la lista de distritos de ese departamento quedan deshabilitados con el texto «Arequipa ya está completo en la zona.». No se despliega ni se lista ninguno de sus distritos.
- Con la provincia visible marcada como completa, la lista de distritos de esa provincia queda deshabilitada con «Lima (provincia) ya está completa en la zona.».
- Para agregar otro departamento, el vendedor cambia el departamento en el selector y marca el nuevo; las marcas anteriores se conservan.
- Resumen de la selección: «{N} distritos seleccionados: {entradas}», donde N es la cantidad total de distritos que cubre la zona y las entradas son las mismas de la lista. Ejemplo: «225 distritos seleccionados: Arequipa, todos los distritos; Cusco, todos los distritos». En móvil, cada entrada es una fila con **Quitar {entrada}**, por ejemplo **Quitar Arequipa**.
- Al reabrir una zona con **Editar**, el selector abre en el departamento de la primera entrada, con sus marcas como se guardaron.
- Aviso de solape, visible mientras la selección comparte distritos con otras zonas activas, encima de **Guardar zona**, con el `Alert` actual en su variante informativa (en móvil, el texto pequeño de la sección): «Comparte 109 distritos con Arequipa ciudad. Esos distritos recibirán las tarifas de ambas zonas.» Con varias zonas: «Comparte 109 distritos con Arequipa ciudad y 1 con Cayma express. Esos distritos recibirán las tarifas de todas.» No bloquea el guardado.
- Sin ninguna entrada, **Guardar zona** muestra «Selecciona al menos un distrito, provincia o departamento.».

**Checkout del comprador:** sin cambios de diseño ni de textos.

## Reglas

| Aspecto | Comportamiento |
| --- | --- |
| Guardado de una modalidad | Tocar el switch guarda solo ese cambio. Domicilio y agencia se guardan sin ninguna condición previa. |
| Un guardado a la vez | Mientras un guardado de modalidades o del punto de recojo está en curso, no empieza otro. Los switches se deshabilitan; un texto del punto escrito mientras tanto se guarda al terminar el actual. |
| Agencia o domicilio sin cobertura | Se guardan igual (C5). Se muestra el aviso de cobertura junto al switch mientras la modalidad esté activada y no tenga cobertura. |
| Cobertura de domicilio | Existe si hay al menos una opción a domicilio activada en una zona activada. |
| Cobertura de agencia | Existe si hay al menos una opción de agencia activada, en una zona activada, con al menos una sede elegible. Sede elegible: sede activa del catálogo cuyo courier está habilitado para el negocio, la misma regla que hoy marca «Sin agencias elegibles: no se ofrece al cotizar». |
| Aviso de cobertura al día | El aviso se recalcula al guardar una zona, al activar o desactivar una zona y al recargar, sin tocar el switch. |
| Negocios fuera de Perú | No ven avisos de cobertura, porque no tienen zonas. |
| Recojo sin nombre o dirección | El recojo no queda activado mientras falte el nombre o la dirección guardados. Tocar el switch abre los campos, indica lo que falta y el recojo se activa en el guardado en que nombre y dirección quedan completos. |
| Intento de activar el recojo | Dura mientras el vendedor sigue en la pantalla. Si sale antes de completar los datos, el recojo queda desactivado. Apagar el switch durante el intento lo cancela. |
| Punto con recojo activado | Vaciar el nombre o la dirección no se guarda: el campo muestra el error y se conserva el último punto guardado. El recojo sigue activado. |
| Punto con recojo desactivado | El punto se guarda si tiene nombre y dirección, o si se vacían los tres campos (queda sin punto). Un punto a medias no se guarda y muestra el error en el campo. |
| Indicaciones | Opcionales. Se guardan igual que los otros campos; vacías quedan sin indicaciones. |
| Momento de guardar el texto | Al salir del campo o tras 1.5 segundos sin escribir (valor inicial, ajustable). Un texto igual al guardado no genera guardado. |
| Versión de la configuración | Modalidades, punto de recojo y zonas comparten la misma versión, como hoy. Guardar una zona desde la misma pantalla actualiza la versión sin generar conflicto con las modalidades. |
| Departamento completo | Al marcarlo, todos sus distritos quedan en la zona. La zona recuerda «departamento completo» como tal: se reabre igual y cubre los distritos que el catálogo agregue después a ese departamento. |
| Provincia completa | Misma regla que el departamento, a nivel de provincia. |
| Varias unidades en una zona | Una zona puede combinar departamentos completos, provincias completas y distritos sueltos. Ejemplo: Arequipa completo, provincia Lima completa y el distrito Huaral. |
| Absorción dentro de la zona | Al marcar un departamento completo, salen de la selección las provincias y distritos sueltos de ese departamento que ya estaban marcados: quedan cubiertos por el departamento. Lo mismo para una provincia completa respecto de sus distritos. |
| Desmarcar | Desmarcar un departamento o provincia completos saca de la zona todos sus distritos. No se restauran las marcas sueltas absorbidas antes. |
| Sin excepciones | No se quitan distritos de un departamento o provincia completos. Para un precio distinto se crea otra zona con ese distrito. |
| Solape entre zonas | Permitido, como hoy: un distrito en varias zonas activas recibe una tarifa por cada opción activada aplicable de cada zona, sin colapsar por modalidad ni precio. |
| Aviso de solape | Cuenta los distritos que la selección actual comparte con cada otra zona activada, incluidos los cubiertos por departamentos y provincias completos. Se muestra antes de guardar y no bloquea. Las zonas desactivadas no cuentan, porque no generan tarifas. |
| Cotización | Una zona activada aplica al distrito del comprador si lo incluye como distrito suelto o si su departamento o provincia están completos en la zona. |
| Zonas existentes | Las zonas distrito por distrito siguen funcionando igual y se editan como hoy. No se convierten a departamentos aunque cubran uno entero. |
| Nombres en pantalla | Departamento: «{Departamento}, todos los distritos». Provincia: «{Provincia} (provincia), todos los distritos». No hay provincias con el mismo nombre en dos departamentos del catálogo; «(provincia)» distingue la provincia Arequipa del departamento Arequipa. |

## Cuando algo falla

Acciones con efecto: guardar una modalidad, guardar el punto de recojo, guardar una zona.

| Situación | Lo que ve el vendedor | Lo que puede hacer |
| --- | --- | --- |
| Éxito al guardar una modalidad o el punto | «Guardado» en esa modalidad; el switch o el texto quedan como los dejó | Seguir |
| Rechazo por datos del punto (falta nombre o dirección) | El error junto al campo, «Completa los campos obligatorios.»; con el intento de activar recojo, además «Completa el nombre y la dirección para activar el recojo.» junto al switch | Completar el campo; se guarda al salir de él |
| Rechazo por conflicto de versión | El switch vuelve a su estado anterior (o el texto del punto queda en el campo sin guardar) y aparece «Otra persona cambió la configuración. Recarga para ver los cambios.» con **Recargar configuración**. Los switches quedan deshabilitados hasta recargar | **Recargar configuración** trae las modalidades, el punto y la lista de zonas vigentes; conserva en pantalla el texto del punto sin guardar y el borrador de zona abierto |
| No enviado (sin conexión o error del servidor) | El switch vuelve a su estado anterior y aparece «No se pudo guardar. Revisa tu conexión y vuelve a intentarlo.» con **Reintentar**. El texto del punto sigue en el campo | **Reintentar** vuelve a enviar el mismo cambio |
| En duda (salió y no llegó respuesta) | El switch vuelve al último estado confirmado y aparece «No pudimos confirmar el guardado.» con **Reintentar**. Nunca se muestra «Guardado» | **Reintentar** reenvía el cambio con la misma versión: si ya se había guardado, responde como conflicto y ofrece recargar; nunca aplica el cambio dos veces |
| Respuesta tardía de un intento anterior | No cambia lo que se ve; solo cuenta la respuesta del intento visible | — |
| Borrador de zona tras recargar | Si la zona en edición cambió en el servidor, el editor muestra «Otra persona cambió esta zona. Revisa tu borrador antes de guardar.» encima de **Guardar zona** | Guardar el borrador, que reemplaza esos cambios, o **Cancelar edición** |
| Guardar zona: rechazos, conflicto, en duda | Igual que hoy («Revisa el nombre, los distritos y las opciones de la zona.», «La configuración cambió o no pudimos confirmar el guardado…» con **Recargar configuración**). Solo cambia el texto de distritos vacíos, «Selecciona al menos un distrito, provincia o departamento.» | Igual que hoy |
| Salir con texto del punto sin guardar | Confirmación «Hay cambios del punto de recojo sin guardar.» | **Salir sin guardar** o **Seguir editando** |

## Quién ve y hace qué

| Actor | Puede ver | Puede hacer | No puede |
| --- | --- | --- | --- |
| Usuario del negocio con acceso a configuración | Modalidades, punto, zonas y avisos de su negocio | Guardar modalidades, punto y zonas | Ver o cambiar la configuración de otro negocio |
| Comprador con el link del pedido | Las tarifas que aplican a su distrito, con el nombre de la opción y de la zona como hoy | Elegir distrito y tarifa | Ver las zonas, sus departamentos o el aviso de solape |

## Información que se guarda

- La configuración del negocio guarda el estado de cada modalidad y el punto de recojo, como hoy; cada cambio reemplaza al anterior.
- La zona guarda sus departamentos completos, provincias completas y distritos sueltos como tales, no la lista expandida de distritos de un departamento. Dónde y cómo se guarda lo resuelve el diseño técnico.
- El intento de activar el recojo y el texto aún no guardado son efímeros: no se guardan ni se recuperan al volver.
- Los pedidos ya creados no cambian: la tarifa elegida y el destino quedan en el pedido aunque después cambie la zona (regla vigente).
- La app no está en producción: no hay conversión de zonas existentes. Las zonas distrito por distrito quedan tal cual.

## Vocabulario

- **Modalidad:** cómo recibe el comprador: «Recojo en tienda», «Entrega a domicilio», «Envío a agencia».
- **Cobertura:** que una modalidad tenga al menos una opción activa en una zona activa que se pueda cotizar; en agencia, además, con sede elegible.
- **Departamento completo / provincia completa:** marca de la zona que cubre todos los distritos de ese departamento o provincia, presentes y futuros. En pantalla: «Arequipa, todos los distritos», «Lima (provincia), todos los distritos».
- **Distrito suelto:** distrito marcado de uno en uno, como hasta hoy.
- **Solape:** distritos que la zona en edición comparte con otras zonas activas.

## Decisiones cerradas

| Decisión | Por qué |
| --- | --- |
| Cada switch y el punto de recojo se guardan al instante; no hay botón de guardar en modalidades | Evita modalidades activadas en pantalla y no guardadas |
| Agencia y domicilio se activan sin cobertura, con aviso junto al switch | Respeta C5; el aviso dice qué falta donde se toma la decisión |
| El aviso de agencia exige sede elegible | Una opción sin sedes elegibles no se cotiza; sin esto el aviso mentía |
| El recojo no se activa sin nombre y dirección guardados | El comprador no puede elegir un recojo sin dirección |
| El texto se guarda al salir del campo o tras una pausa, nunca por tecla | Evita guardados y conflictos innecesarios |
| Departamentos y provincias completos se guardan como unidad | Se reabren igual y cubren distritos nuevos del catálogo |
| No se listan los distritos de una unidad completa en ningún lugar | Lima tiene 171 distritos; la lista no ayuda a decidir |
| Sin excepciones dentro de un departamento o provincia | Otra zona con el distrito resuelve el precio distinto |
| Se mantiene el solape y se avisa con cuántos distritos se comparten | Regla vigente de tarifas; el aviso evita solapes por descuido |
| Marcar una unidad completa absorbe las marcas sueltas que cubre | No hay duplicados dentro de una zona y el resumen queda limpio |
| Una sola entrega, Parte 1 antes que Parte 2 | Decisión de alcance del fundador |

## Criterios de aceptación

### Parte 1

1. En web (390 y 1280 px) y en móvil, el vendedor toca «Entrega a domicilio» apagado: ve «Guardando…» y luego «Guardado» en esa fila; al recargar, sigue activado. Igual para «Envío a agencia» y para apagar cualquiera de los dos.
2. Ni en web ni en móvil aparece el botón «Guardar configuración», ni «Tienes cambios sin guardar.».
3. Sin conexión, el vendedor activa «Envío a agencia»: el switch vuelve a apagado, ve «No se pudo guardar. Revisa tu conexión y vuelve a intentarlo.» y **Reintentar**; con conexión, **Reintentar** lo guarda y muestra «Guardado».
4. El servidor responde con error al guardar «Entrega a domicilio»: el switch vuelve a su estado anterior y aparece el mensaje con **Reintentar**.
5. El guardado sale y no llega respuesta: el switch vuelve al último estado confirmado, aparece «No pudimos confirmar el guardado.» y nunca «Guardado»; **Reintentar**, si el cambio ya se había aplicado, termina en el aviso de conflicto y no lo aplica dos veces.
6. Con dos pestañas abiertas, en la pestaña A se apaga «Envío a agencia»; en la pestaña B, con un borrador de zona abierto y «Av. Ejército 101» escrito sin guardar en la dirección, se toca «Entrega a domicilio»: B ve «Otra persona cambió la configuración. Recarga para ver los cambios.», el switch vuelve atrás, **Recargar configuración** muestra agencia apagada y conserva el borrador de zona y el texto de la dirección.
7. Un negocio sin opciones de agencia activa «Envío a agencia»: queda guardado y junto al switch aparece «Falta una opción de agencia activa con cobertura» con **Ir a zonas y tarifas**, que lleva a la sección de zonas.
8. Un negocio con la opción de agencia «Olva Sur» activa en «Zona sur» activa, pero cuya única sede está desactivada en el catálogo, ve el aviso de agencia junto al switch. Al guardar en la zona una opción con una sede elegible, el aviso desaparece sin recargar.
9. Un negocio con «Entrega a domicilio» activada y sin opción a domicilio activa en zona activa ve «Falta una opción de domicilio activa con cobertura» junto al switch y no en la sección de zonas.
10. Con el catálogo de couriers vacío, al activar agencia se ve «Todavía no hay couriers disponibles para envío a agencia…» bajo el switch.
11. Sin punto de recojo guardado, el vendedor toca «Recojo en tienda»: el switch sigue apagado, se abren los campos, aparece «Completa el nombre y la dirección para activar el recojo.» y el foco va al nombre. Escribe «Tienda Cercado» y «Calle Mercaderes 210»; al salir de la dirección se guardan, el switch se enciende y aparece «Guardado». Al recargar, el recojo está activado con ese punto.
12. Con el recojo activado, el vendedor cambia las indicaciones a «Timbre 2»: se guarda tras la pausa al escribir o al salir del campo, sin botón, y no hay un guardado por cada tecla.
13. Con el recojo activado, el vendedor borra el nombre: ve «Completa los campos obligatorios.» junto al campo, no se guarda y, al recargar, el nombre anterior sigue y el recojo sigue activado.
14. El vendedor toca el switch de recojo sin datos y sale de la pantalla sin escribirlos: al volver, el recojo está desactivado.
15. Con un texto del punto con error de guardado, salir de la pantalla pide confirmación con **Salir sin guardar** y **Seguir editando**.

### Parte 2

16. El vendedor crea «Zona sur», marca **Todos los distritos de Arequipa** y **Todos los distritos de Cusco** sin elegir provincia ni distrito, agrega una opción a domicilio de S/ 15.00 y guarda: en web y en móvil la lista muestra «Arequipa, todos los distritos; Cusco, todos los distritos» y ningún distrito de esos departamentos.
17. Durante la selección, el resumen dice «225 distritos seleccionados: Arequipa, todos los distritos; Cusco, todos los distritos» y nunca lista sus distritos; con Arequipa marcado, la lista de distritos de Arequipa está deshabilitada con «Arequipa ya está completo en la zona.».
18. Al reabrir «Zona sur» con **Editar**, el selector muestra Arequipa y Cusco como completos, sin desplegar distritos.
19. En el checkout, un comprador de Cayma (Arequipa) y uno de Wanchaq (Cusco) reciben la tarifa «Zona sur» de S/ 15.00; uno de Miraflores (Lima) no la recibe.
20. El vendedor marca la provincia Lima completa en una zona: se muestra «Lima (provincia), todos los distritos» en el resumen, en la lista y al reabrir; un comprador de Miraflores recibe su tarifa y uno de Huaral (provincia Huaral) no.
21. En una zona con Cayma marcado suelto, el vendedor marca Arequipa completo: el resumen queda «109 distritos seleccionados: Arequipa, todos los distritos», sin Cayma aparte. Al desmarcar Arequipa, la zona queda sin distritos de Arequipa y Cayma no vuelve.
22. Con «Arequipa ciudad» activa cubriendo solo Cayma, al marcar Arequipa completo en «Zona sur» aparece antes de guardar «Comparte 1 distrito con Arequipa ciudad. Esos distritos recibirán las tarifas de ambas zonas.»; tras guardar, un comprador de Cayma recibe las tarifas de ambas zonas. El texto usa singular o plural según la cantidad.
23. Una zona creada antes distrito por distrito con Miraflores y San Isidro se ve, se edita y se cotiza igual que antes.
24. Guardar una zona sin ninguna entrada muestra «Selecciona al menos un distrito, provincia o departamento.» y no se guarda.

### Comunes

25. La pantalla mantiene sus tarjetas, switches, avisos y layout; el selector de departamentos es el selector actual con las marcas nuevas; el checkout no cambia de diseño.
26. Pasan typecheck, lint, unit, integración, los e2e de core `delivery-settings`, `agency-delivery`, `store-delivery`, `checkout` y `delivery-without-tariffs`, y las pruebas de móvil.
