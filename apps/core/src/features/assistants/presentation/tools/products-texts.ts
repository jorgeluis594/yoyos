export const productReadFailureMessage = "No pudimos leer tus productos en este momento. Inténtalo de nuevo en unos segundos.";
export const noProductMessage = "No encontré ese producto en tu tienda. Búscalo con Buscar productos.";
export const reversedPriceMessage = (to: string, from: string) => `El precio hasta (${to}) es menor que el precio desde (${from}).`;
export const pageOutOfRangeMessage = (total: number) => `Esa página no existe: hay ${total} ${total === 1 ? "producto" : "productos"} en total, 20 por página.`;
export const unknownFieldMessage = (fields: string) => `No existe el campo ${fields}. Usa solo los campos de la herramienta.`;

export const productToolsInstructions = [
  "Este conector lee los productos de una sola tienda, la que autorizó la conexión, y no puede cambiar nada.",
  "Yoyos no tiene categorías de productos: si el dueño pregunta por categorías, dile que no existen y busca por el nombre del producto.",
  "Si el dueño pide cambiar un producto (un precio, el stock, activar o desactivar una variante), dile que no puedes y dale el enlace del producto en Yoyos que viene en cada resultado.",
  "El stock es el conteo actual de cada variante, no una reserva: otro pedido puede descontarlo en cualquier momento.",
  "El precio de compra es solo para el dueño: no lo ofrezcas en un texto pensado para un cliente y no calcules márgenes ni ganancias sumando costos.",
  "Para mandar un producto a un cliente usa el enlace_cliente; si un producto no lo trae, no inventes un enlace.",
  "Cada respuesta indica el estado del catálogo de la tienda en «catalogo». Si está oculto, avísaselo al dueño una sola vez en la conversación, salvo que pregunte por el catálogo.",
  "Los montos y el stock ya vienen listos para mostrar; no los recalcules.",
  "Si una llamada se rechaza por falta de autorización, pide al dueño que vuelva a conectar el conector desde la configuración de tu asistente; la dirección está en Yoyos → Ajustes → Asistentes de IA.",
].join(" ");

export const searchProductsDescription = [
  "Busca productos de la tienda. Úsala cuando el dueño pregunte qué tiene, cuánto cuesta, qué le queda de un color o talla, qué se le está acabando o qué no está en el catálogo («¿tienes polos azules en M?», «¿qué se me está acabando?»).",
  "Yoyos no tiene categorías. Para buscar un tipo de producto usa texto con una palabra corta en singular o su raíz: «polo» para «polos», «casac» para «casacas». Si no hay resultados, prueba con una más corta antes de decir que no existe. texto se busca como una sola frase en el nombre del producto o en cualquier SKU, sin distinguir mayúsculas ni tildes: «polo azul» solo encuentra nombres que contengan «polo azul»; los colores y tallas van en valores.",
  "Todos los filtros son opcionales y se combinan. valores: de 1 a 3 entradas, cada una «Azul» o «Color: Azul» (opción y valor, hasta 30 caracteres cada uno); la variante debe tener todos los valores a la vez, exactos y sin distinguir mayúsculas ni tildes. Si un valor no existe, la respuesta lista los valores de la tienda para reintentar.",
  "precio_desde y precio_hasta: montos con hasta dos decimales en la moneda de la tienda, sobre el precio de venta de la variante, ambos extremos incluidos. stock: «con stock», «stock bajo» (1 a 3 unidades) o «agotado» (0), sobre cada variante activa. en_catalogo: «sí» o «no»; un producto está en el catálogo si es visible y tiene al menos una variante activa.",
  "Los filtros de variante (valores, precio y stock) se aplican juntos a una misma variante activa. orden: «recientes» (por defecto) o «nombre». pagina: 20 productos por página.",
  "Cada producto trae nombre, SKU, precio, stock con el resumen de sus variantes, si está en el catálogo, número de variantes, enlace de Yoyos, enlace_cliente cuando el catálogo está publicado y, con filtros de variante, las variantes que coinciden (hasta 10). Nunca trae el precio de compra: está solo en ver_producto.",
].join(" ");

export const viewProductDescription = [
  "Muestra todo lo de un producto: nombre, descripción, opciones, cada variante con su combinación, SKU, precio de venta, precio de compra, stock, nivel y si está activa o desactivada, y los enlaces. Úsala cuando el dueño pida el detalle de un producto o pregunte cuánto le costó («¿cuánto me costó la casaca negra?»).",
  "Indica exactamente uno: producto (el id que devuelve buscar_productos) o sku (un SKU exacto, sin distinguir mayúsculas ni espacios en los extremos). Con un SKU abre el producto de esa variante y la marca con buscada_por_sku: responde primero sobre ella. Si el dueño nombra el producto sin id ni SKU, usa primero buscar_productos.",
  "El stock es el conteo actual, no una reserva. precio_compra es «Sin precio de compra» si el dueño nunca lo ingresó; es para el dueño y no se ofrece a un cliente. Un producto o un SKU desconocido, o de otra tienda, responde igual: «No encontré ese producto en tu tienda. Búscalo con Buscar productos.».",
].join(" ");
