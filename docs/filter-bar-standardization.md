# Estandarizar los filtros de Productos y Ventas

## Objetivo

Usar una sola barra de filtros en las listas de Productos y Ventas. El aspecto de la búsqueda de Productos es la referencia: etiqueta visible, campo amplio, botón de búsqueda con texto y separación clara antes de la tabla. Ventas conserva el drawer para los filtros de cliente y fecha.

## Diferencias actuales

| Aspecto | Productos | Ventas |
| --- | --- | --- |
| Encabezado | `PageHeader`, con la cantidad junto al título. | Encabezado escrito en la ruta, con la cantidad debajo. |
| Barra | Formulario sin contenedor adicional: `Field`, `FieldLabel`, `Input` y botón «Buscar». | `FilterBar` con borde y fondo de tarjeta; campo con etiqueta oculta, búsqueda por icono y botón «Filtros». |
| Uso del componente compartido | No usa `FilterBar`. | Es el único consumidor de `FilterBar`. |
| Móvil | La etiqueta sigue visible y el campo ocupa el ancho disponible. | El texto del campo se corta al compartir la fila con dos botones. |
| Acción de búsqueda | Filtra directamente las filas por nombre o SKU. | Busca opciones de contacto; las filas cambian cuando se selecciona un contacto en el drawer y se aplican los filtros. |
| Tabla | `DataTable` con nombre, SKU, precio y stock. | El mismo `DataTable` con cliente, fecha e importe. |
| Paginación y vacío | Páginas numeradas solo cuando hacen falta; vacío distinto para catálogo sin productos y búsqueda sin resultados. | «Página 1» siempre visible y un solo mensaje de vacío. |

Código actual: [Productos](../apps/core/app/routes/product-list.tsx), [Ventas](../apps/core/app/routes/order-list.tsx) y [FilterBar](../apps/core/app/components/ui/filter-bar.tsx).

## Interfaz objetivo

`FilterBar` debe representar la búsqueda completa en ambas páginas. Recibe el nombre y valor del parámetro de búsqueda, una etiqueta visible, el texto del botón y, opcionalmente, campos ocultos y una acción adicional. Renderiza un formulario GET con los componentes `Field`, `FieldLabel`, `Input` y `Button` que ya usa Productos. La acción adicional queda fuera del formulario para que «Filtros» no envíe la búsqueda. El estado de los filtros, las consultas y la construcción de la URL permanecen en cada ruta.

```tsx
<FilterBar
  searchName="search"
  searchValue={search}
  searchLabel="Buscar por nombre o SKU"
  submitLabel="Buscar"
/>

<FilterBar
  searchName="customerSearch"
  searchValue={customerSearch}
  searchLabel="Buscar contacto para filtrar"
  submitLabel="Buscar contacto"
  hiddenFields={activeFilterInputs}
  action={<OrderFilterSheet />}
/>
```

La barra no necesita variantes visuales por página: sin borde de tarjeta, con el espaciado actual de Productos. El botón adicional «Filtros» usa la variante `outline`; el drawer conserva su título, controles de cliente y fechas, acciones «Limpiar» y «Aplicar filtros», y contador de filtros activos. En móvil, el formulario y la acción pueden pasar a otra fila cuando no quepan, manteniendo el campo legible y los objetivos táctiles del sistema.

## Implementación propuesta

1. Actualizar `app/components/ui/filter-bar.tsx` para que componga el formulario y acepte la acción opcional. Mantenerlo sin conocimiento de productos, ventas o del drawer.
2. Sustituir el formulario de búsqueda de `product-list.tsx` por `FilterBar`. Conservar `search`, su operación de catálogo, el botón «Buscar» y el resultado visual actual como referencia de regresión.
3. Usar `PageHeader` en `order-list.tsx` para mostrar «Ventas» y el total en la misma línea que Productos. Sustituir la barra con borde por el `FilterBar` compartido y mantener `OrderFilterSheet` como acción adicional.
4. En el drawer de Ventas, componer las etiquetas y campos con los controles compartidos donde corresponda. Mantener la búsqueda de contactos, los parámetros de fecha y cliente, la validación y la paginación existentes.
5. Conservar las columnas propias de cada dominio. `DataTable` ya proporciona la misma estructura y adaptación móvil para ambas listas; no requiere otra abstracción.

La búsqueda de contacto en Ventas **no filtra ventas por texto** hoy. Su etiqueta y botón deben decir «contacto» para no prometer el comportamiento de Productos. Si se desea búsqueda directa de ventas por nombre o teléfono, eso requiere ampliar el criterio de `listOrders` y la consulta del repositorio en un cambio funcional separado.

## Criterios de aceptación

- Productos y Ventas usan el mismo `FilterBar` y muestran la misma jerarquía de etiqueta, campo y botón.
- Productos conserva sus resultados y parámetros de búsqueda; Ventas conserva los filtros activos al buscar contactos y al cambiar de página.
- El botón «Filtros» abre el drawer, muestra el número de filtros aplicados y permite aplicar o limpiar sin perder el estado visual.
- A 390 px y en escritorio, las dos barras mantienen campo, botones y etiquetas legibles sin desbordamiento horizontal.
- Pasan `lint`, `typecheck` y las pruebas afectadas de core. Después de cada vista ajustada, Playwright CLI valida escritorio y móvil, la búsqueda y la apertura, aplicación y limpieza del drawer. El commit incluye solo los archivos de esta estandarización.
