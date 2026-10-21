export type FaqEntry = Readonly<{ number: number; question: string }
  & ({ visibility: "published"; answer: string } | { visibility: "hidden" })>;

export const faqEntries: readonly FaqEntry[] = [
  {
    number: 1,
    question: "Ya lo manejo con WhatsApp y un Excel.",
    visibility: "published",
    answer:
      "¡Perfecto, sigue usando WhatsApp! Yoyos no te cambia la forma de vender: tus clientes te escriben como siempre. Lo que te ahorras es pasar cada pedido del chat al Excel: cuando te mandan la foto del producto, Yoyos arma el pedido, y tu cliente completa su dirección y elige el envío en el link que tú le compartes.",
  },
  {
    number: 2,
    question: "No tengo tiempo de aprender otra app.",
    visibility: "published",
    answer:
      "Lo entendemos: entre lives y despachos no te sobra tiempo. Por eso Yoyos se usa desde tu celular, junto al WhatsApp que ya tienes. En la demo te ayudamos a dejar Yoyos listo con tus productos.",
  },
  {
    number: 3,
    question: "¿Cuánto cuesta?",
    visibility: "published",
    answer:
      "S/ 50 al mes + IGV. Es una suscripción mensual: no cobramos comisión por tus ventas ni hay pagos únicos. Escríbenos por WhatsApp y te mostramos cómo funciona con tus productos.",
  },
  {
    number: 4,
    question: "Hay herramientas gratis que hacen algo parecido.",
    visibility: "published",
    answer:
      "Hay opciones gratis que te dan un catálogo o una lista de pedidos. Yoyos va más allá: arma el pedido desde la foto que te manda tu cliente por WhatsApp, cotiza el envío por zona y distrito, te da un link para compartir con tu cliente donde elige agencia Shalom u Olva, domicilio o recojo y sube su comprobante de Yape o Plin, y te deja imprimir los rótulos. Te ahorra trabajo en todo el camino, del chat al despacho.",
  },
  {
    number: 5,
    question: "¿Mis clientes tienen que bajar otra app?",
    visibility: "published",
    answer:
      "Tus clientes no necesitan bajar nada. Te siguen escribiendo por WhatsApp y, cuando el pedido está listo, les mandas un link para confirmar sus datos y pagar desde el celular, sin crear cuenta.",
  },
  // 6. «¿Qué pasa con mis datos y los de mis clientes?» stays hidden until its answer is approved.
  { number: 6, question: "¿Qué pasa con mis datos y los de mis clientes?", visibility: "hidden" },
  {
    number: 7,
    question: "Vendo poco, todavía no lo necesito.",
    visibility: "published",
    answer:
      "Justo cuando empiezas es el mejor momento para ordenarte. Cada pedido que copias a mano del chat al cuaderno, cada dirección que vuelves a pedir y cada captura de Yape que buscas te quitan tiempo que podrías usar para vender. Y cuando un live te va bien, ya tienes todo listo para atender más pedidos sin enredarte.",
  },
  {
    number: 8,
    question: "¿Sirve con Yape y Plin?",
    visibility: "published",
    answer:
      "Sí. Puedes cobrar con Yape, Plin o transferencia bancaria. Tu cliente ve tus datos de pago en el link del pedido y sube su comprobante, y tú lo verificas.",
  },
  {
    number: 9,
    question: "¿Necesito una impresora especial para los rótulos?",
    visibility: "published",
    answer:
      "Yoyos imprime en impresoras de etiquetas y estamos sumando más modelos. En la demo te decimos cuál te conviene.",
  },
  {
    number: 10,
    question: "¿Funciona en iPhone?",
    visibility: "published",
    answer:
      "Yoyos está disponible para Android y en la web, y la app para iPhone viene en camino.",
  },
  {
    number: 11,
    question: "¿Me pueden bloquear el número?",
    visibility: "published",
    answer:
      "Yoyos se conecta a tu WhatsApp como un dispositivo vinculado, igual que WhatsApp Web, y solo lee los mensajes que te llegan: no envía mensajes, no hace envíos masivos ni escribe en grupos. Yoyos no es un servicio de WhatsApp ni de Meta, así que no podemos garantizar que WhatsApp nunca aplique restricciones, pero Yoyos no hace las acciones que suelen motivarlas, como el spam o los mensajes masivos. Puedes desvincular Yoyos cuando quieras desde la app o desde WhatsApp > Dispositivos vinculados.",
  },
];
