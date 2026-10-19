# Sistema de diseño de core (web)

Todo componente visual reutilizable de `apps/core` vive en `apps/core/app/components/ui/`. Rutas y features componen esas piezas; no copian clases ni usan controles nativos sin estilo (`<select>`, `<dialog>`, `<p role="alert">`, `<input type="checkbox">` sueltos).

## Origen de los componentes

1. **La base es shadcn/ui** (`components.json`: estilo `radix-nova`, base radix, iconos lucide). Si shadcn tiene el componente, se trae con la CLI desde `apps/core`: `pnpm dlx shadcn@latest add <componente>`.
2. **Una vez en el repo, el componente es nuestro**: se personaliza con nuestros tokens y estilo, sin cambiar su estructura ni su API. Por eso `add` **nunca** se corre con `--overwrite` sobre un archivo que ya existe (`button`, `field`, `select`, `input`, `card`, `sheet`…); para traer cambios de upstream se usa `--diff` y se fusiona a mano.
3. **Si shadcn no lo tiene**, se crea a mano siguiendo las mismas convenciones.

Personalización aplicada a todo lo traído de shadcn:

- Radios con token: `rounded-[var(--radius-control|card|overlay|badge)]` en vez de `rounded-lg/xl/4xl/[4px]`.
- Foco del proyecto: `focus-visible:ring-2 focus-visible:ring-ring` (con offset en controles pequeños) en vez de `ring-3 ring-ring/50`.
- Colores semánticos: variantes `success`, `warning`, `info` con `--*-surface` / `--*`; nada de `bg-black/…` ni paletas crudas.
- Sin textos fijos: se quitaron "Close", "Previous", "Next", "More pages" y `aria-label="pagination"`. El texto entra por `children` o por props explícitas (`closeLabel`, `aria-label`).
- Touch targets: `app.css` extiende la regla de `min-height: var(--touch-target-min-size)` a `pagination-link`, `tabs-trigger` y `toggle-group-item` en puntero grueso o pantallas angostas.

## Reglas de la API

- **Composición, no props-bolsa.** Cada parte es un subcomponente; nada de `labels={{...}}`, `options={[...]}` ni `footer={...}`.
- **`data-slot`** en cada parte; los estados van en atributos (`data-variant`, `data-orientation`, `data-state`) y el estilo se engancha a ellos.
- **Props nativas pasan tal cual** y `className` se combina con `cn`.
- **`asChild`** (Slot de radix) para renderizar el `<Link>` de react-router.

## Inventario

| Componente | Origen | Archivo |
|---|---|---|
| Alert, Badge, Checkbox, Dialog, Empty, Pagination, RadioGroup, Tabs, Toggle, ToggleGroup | shadcn (añadidos ahora) + tokens | `ui/<nombre>.tsx` |
| Button, Card, Field, Input, Label, Select, Sheet, Skeleton, Table, Textarea | shadcn ya personalizado en el repo (Field y Select usan base-ui) | sin cambios de API |
| Field: FieldSet, FieldLegend, FieldContent, FieldTitle, FieldDescription, `orientation` | partes de shadcn portadas al `field.tsx` existente | `ui/field.tsx` |
| TextLink, DescriptionList, FileUpload, AuthLayout | a mano (shadcn no los tiene) | `ui/<nombre>.tsx` |

## Componentes de shadcn

### Alert — `ui/alert.tsx`

```tsx
Alert: ComponentProps<"div"> & { variant?: "default" | "destructive" | "success" | "warning" | "info" }
AlertTitle, AlertDescription, AlertAction: ComponentProps<"div">
```

```tsx
<Alert variant="destructive">
  <CircleAlert aria-hidden="true" />
  <AlertTitle>{t("checkoutAppearance.uploadError")}</AlertTitle>
  <AlertAction><Button size="sm" variant="outline" onClick={retry}>{t("checkoutAppearance.retry")}</Button></AlertAction>
</Alert>
<Alert><AlertTitle>{t("products.uploading")}</AlertTitle></Alert>
```

Personalización: variantes `success/warning/info` y `role` según la gravedad. `destructive` usa `role="alert"` y las demás `status`; `role` se puede sobrescribir (`role="note"`). Reemplaza los ~50 `<p role="alert|status" className="text-sm text-destructive|…">`. Es una caja (borde y padding de shadcn); un mensaje corto bajo un botón usa `<AlertTitle>` solo. `FieldError` sigue siendo el error de un campo.

### Checkbox — `ui/checkbox.tsx` + `Field orientation="horizontal"`

```tsx
Checkbox: ComponentProps<typeof CheckboxPrimitive.Root>   // radix: checked, defaultChecked, onCheckedChange, name, value
```

```tsx
<Controller name="enabled" control={form.control} render={({ field }) => (
  <Field orientation="horizontal">
    <Checkbox id="store-enabled" name={field.name} checked={field.value} onCheckedChange={field.onChange} ref={field.ref} />
    <FieldLabel htmlFor="store-enabled">{t("deliverySettings.enabled")}</FieldLabel>
  </Field>
)} />
```

Es el Checkbox de radix (un `button role="checkbox"`). Dentro de un `<form>` radix agrega un input oculto con `name`/`value`, así que sigue saliendo en el submit nativo. **No sirve con `register(...)`**, que espera eventos `change` de un input: con react-hook-form se usa `Controller` (delivery-settings ya lo hace). Con descripción: `<Field orientation="horizontal"><Checkbox/><FieldContent><FieldLabel/><FieldDescription/></FieldContent></Field>`. Un grupo es `FieldSet` + `FieldLegend variant="label"`.

### RadioGroup — `ui/radio-group.tsx`

```tsx
RadioGroup: ComponentProps<typeof RadioGroupPrimitive.Root>      // name → input oculto para formularios
RadioGroupItem: ComponentProps<typeof RadioGroupPrimitive.Item>  // el círculo
```

```tsx
<FieldSet>
  <FieldLegend variant="label">{t("buyerPaymentContent.paymentMethod")}</FieldLegend>
  <RadioGroup name="payment-method" value={method} onValueChange={setMethod} className="grid-cols-2">
    {settings.map(s => (
      <FieldLabel key={s.method} htmlFor={`pay-${s.method}`}>
        <Field orientation="horizontal"><RadioGroupItem value={s.method} id={`pay-${s.method}`} /><FieldContent><FieldTitle>{label(s)}</FieldTitle></FieldContent></Field>
      </FieldLabel>
    ))}
  </RadioGroup>
</FieldSet>
```

La tarjeta de opción es el patrón de shadcn: un `FieldLabel` que envuelve un `Field` se pinta como tarjeta y se marca al elegirla. Reemplaza los radios nativos de buyer-payment-content y el RadioGroup de radix armado a mano en appearance. Los swatches de `brand-color-dialog` siguen siendo `RadioGroupItem` con `className` propio; no se crea `ColorSwatch`.

### ToggleGroup — `ui/toggle-group.tsx` (+ `ui/toggle.tsx`)

```tsx
ToggleGroup: ComponentProps<typeof ToggleGroupPrimitive.Root> & { variant?: "default" | "outline"; size?: "default" | "sm" | "lg"; spacing?: number }
ToggleGroupItem: ComponentProps<typeof ToggleGroupPrimitive.Item>
```

```tsx
<ToggleGroup type="single" variant="outline" spacing={0} aria-label={t("checkoutPreview.device")}
  value={device} onValueChange={(value) => value && setDevice(value as Device)}>
  <ToggleGroupItem value="mobile">{t("checkoutPreview.mobile")}</ToggleGroupItem>
</ToggleGroup>
```

Reemplaza el `Segmented` local de checkout-preview-frame (shadcn: "2–7 opciones → ToggleGroup"). El seleccionado usa `bg-primary`, como hoy. Al migrar hay que tener en cuenta dos cosas:

- En modo `single`, radix permite deseleccionar y entonces `onValueChange` recibe `""`. Por eso se usa `value && set(value)`.
- Los ítems pasan de `aria-pressed` a `role="radio"` + `aria-checked`, así que `checkout-preview-frame.test.tsx:61` cambia a `getAttribute("aria-checked")`. El contrato está fijado en `ui/toggle-group.test.tsx`.

### Tabs — `ui/tabs.tsx`

```tsx
Tabs, TabsContent: primitivos radix; TabsList: { variant?: "default" | "line" }; TabsTrigger
```

`default` es la píldora sobre `bg-muted` (sustituye `tabClass` de checkout-appearance-settings). `line` es el subrayado `primary` (sustituye las pestañas de delivery-settings). Los íconos llevan `data-icon="inline-start"`. Para conservar el estado del formulario, delivery-settings mantiene `forceMount` y agrega `className="data-[state=inactive]:hidden"` en su `TabsContent`.

### Dialog — `ui/dialog.tsx`

```tsx
Dialog, DialogTrigger, DialogClose, DialogPortal, DialogOverlay
DialogContent: ComponentProps<typeof Content> & { closeLabel?: string }   // con closeLabel aparece la X
DialogHeader, DialogFooter: ComponentProps<"div">; DialogTitle, DialogDescription
```

```tsx
<Dialog>
  <DialogTrigger asChild><Button variant="destructive">{t("orderCancellation.cancel")}</Button></DialogTrigger>
  <DialogContent>
    <DialogHeader><DialogTitle>{t("orderCancellation.confirm")}</DialogTitle><DialogDescription>{t("orderCancellation.effects")}</DialogDescription></DialogHeader>
    <DialogFooter>
      <DialogClose asChild><Button variant="outline">{t("orderCancellation.keep")}</Button></DialogClose>
      <Form method="post">…</Form>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

Personalización: `showCloseButton` (con "Close" fijo) se cambió por `closeLabel`. Se quitó `DialogFooter showCloseButton`; el botón de cerrar se compone con `DialogClose`. Usa `--radius-overlay`, un overlay `bg-foreground/40` y un título `text-lg`. Reemplaza el `<dialog>` nativo de order-detail y los `Dialog.Overlay`/`Content` armados a mano. El drawer de `private-layout` usa `Sheet`.

### Pagination — `ui/pagination.tsx`

```tsx
Pagination: ComponentProps<"nav">                 // aria-label lo pasa la ruta
PaginationContent, PaginationItem, PaginationEllipsis
PaginationLink: ComponentProps<"a"> & { isActive?: boolean; asChild?: boolean; size?: ButtonSize }
PaginationPrevious, PaginationNext: como PaginationLink; el texto va en children
```

```tsx
<Pagination aria-label={t("orders.pages")} className="mt-6">
  <PaginationContent className="w-full justify-end">
    <PaginationItem className="mr-auto text-sm text-muted-foreground">{t("orders.page", { page })}</PaginationItem>
    {page > 1 && <PaginationItem><PaginationPrevious asChild><Link to={buildHref(page - 1)}>{t("orders.previous")}</Link></PaginationPrevious></PaginationItem>}
    {hasNext && <PaginationItem><PaginationNext asChild><Link to={buildHref(page + 1)}>{t("orders.next")}</Link></PaginationNext></PaginationItem>}
  </PaginationContent>
</Pagination>
```

Personalización: `asChild` para el `<Link>` del router (el ícono y el texto se insertan en el link con `Slot.Slottable`), página activa `default` y resto `outline` (como hoy en product-list), y sin textos en inglés. `page`, `hasNext` y `buildHref` quedan en la ruta.

### Badge — `ui/badge.tsx`

```tsx
Badge: ComponentProps<"span"> & { variant?: "default" | "secondary" | "destructive" | "outline" | "ghost" | "link" | "success" | "warning" | "info"; asChild?: boolean }
<Badge variant="success"><CircleCheck data-icon="inline-start" aria-hidden="true" />{t("orders.status.completed")}</Badge>
```

Personalización: variantes `success/warning/info` y radio `--radius-badge`. Reemplaza los `const badge = …` de order-detail (con `className="h-auto py-1.5 text-sm"` donde se necesite más grande) y la píldora "Sin guardar" (`secondary`). El avatar redondo de private-layout:64 no es un Badge.

### Empty — `ui/empty.tsx`

```tsx
Empty, EmptyHeader, EmptyMedia ({ variant?: "default" | "icon" }), EmptyTitle, EmptyDescription, EmptyContent
<Empty><EmptyHeader><EmptyTitle>{t("orders.empty")}</EmptyTitle><EmptyDescription>{t("orders.emptyHint")}</EmptyDescription></EmptyHeader></Empty>
```

Va dentro de secciones, carritos y el `emptyMessage` de `DataTable`. `ErrorState` sigue siendo la pantalla completa de error.

### Field (existente, ampliado) — `ui/field.tsx`

Se mantiene sobre base-ui (`Field.Root`/`Field.Label`), con su API y `controlClass`. Se portaron de shadcn `FieldSet`, `FieldLegend`, `FieldContent`, `FieldTitle`, `FieldDescription`, la variante `orientation` (`vertical | horizontal`, esta última a `min-h-touch`) y el estilo de tarjeta de opción en `FieldLabel`. No se trajo `FieldSeparator` porque no tiene uso, ni `FieldError errors=[]` porque las rutas ya resuelven sus mensajes con i18n.

### Select (existente, único select) — `ui/select.tsx`

La API se mantiene (`Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectGroup`, `SelectItem`) y es la única forma de hacer un select. No se crea `NativeSelect`.

- **Formulario nativo / GET:** `name` en `Select` genera un `<input type="hidden" name=… value=…>`, así que el valor sale en el submit (filtros de `order-list`, `auth-form`).
- **Etiqueta visible del valor:** pasa `items={[{ value, label }]}` a `Select` para que `SelectValue` muestre la etiqueta y no el código.
- **Sin selección:** `value={null}` + `<SelectValue placeholder=…>`. No uses `""` como opción vacía.
- **react-hook-form:**

  ```tsx
  <Controller name="courier" control={form.control} render={({ field, fieldState }) => (
    <Select name={field.name} value={field.value} onValueChange={field.onChange} inputRef={field.ref} items={courierItems}>
      <SelectTrigger id="courier" aria-invalid={fieldState.invalid}><SelectValue placeholder={t("…")} /></SelectTrigger>
      <SelectContent>{couriers.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
    </Select>
  )} />
  ```

  `onValueChange` recibe el valor como primer argumento, así que `field.onChange` sirve directo. `inputRef` permite que RHF enfoque el campo con error.

- **No se agrega `SelectField`/`options`:** sería una props-bolsa y la composición ya cabe en pocas líneas. Si un mismo select se repite (departamento/provincia), se crea un componente de feature que componga `Select`.

**Migración de tests:**

| Antes | Después |
|---|---|
| Vitest jsdom: `select.value = "PE"; dispatchEvent(change)` | `click()` en `[data-slot="select"]` (el trigger) y luego `click()` en el `[role="option"]` con ese texto, dentro de `act` (ver `ui/select.test.tsx`). |
| `renderToStaticMarkup`: `value="15" selected=""` | Verifica el input oculto (`name="…" value="15"`) y la etiqueta en el trigger. Las opciones no se renderizan en SSR porque el popup está cerrado. |
| Playwright: `getByLabel("Departamento").selectOption("04")` | `getByLabel("Departamento").click(); getByRole("option", { name: "Arequipa" }).click()`. Se elige por etiqueta, no por valor. |

Los tests que hoy dependen de `<select>`/`<option>` están en: `peru-district-select.test.tsx`, `peru-district-multi-select.test.tsx` y los e2e `orders`, `checkout`, `mobile-checkout`, `delivery-settings`, `checkout-appearance-buyer`, `buyer-payment`, `store-delivery`, `agency-delivery` y `rated-order-delivery-action`.

## Componentes hechos a mano (no existen en shadcn)

### TextLink — `ui/text-link.tsx`

```tsx
TextLink: ComponentProps<"a"> & { asChild?: boolean }
<TextLink asChild><Link to={path("/register")}>{t("auth.register")}</Link></TextLink>
<TextLink href={receiptUrl} target="_blank" rel="noreferrer">{t("…")}</TextLink>
```

Reemplaza `font-medium text-primary underline underline-offset-4` y los `className="underline"` sueltos. Los botones que parecen enlace siguen siendo `Button variant="link"`.

### DescriptionList — `ui/description-list.tsx`

```tsx
DescriptionList: ComponentProps<"dl"> & { orientation?: "horizontal" | "vertical" }  // default horizontal
DescriptionItem: ComponentProps<"div">; DescriptionTerm: ComponentProps<"dt">; DescriptionDetails: ComponentProps<"dd">
```

```tsx
<DescriptionList>
  <DescriptionItem><DescriptionTerm>{t("…subtotal")}</DescriptionTerm><DescriptionDetails>{money(subtotal)}</DescriptionDetails></DescriptionItem>
</DescriptionList>
<DescriptionList orientation="vertical">…</DescriptionList>   {/* datos de cuenta: valor debajo del término */}
```

`horizontal` sirve para resúmenes de montos (término a la izquierda, valor a la derecha con `tabular-nums`). `vertical` sirve para datos de pago o de entrega.

### FileUpload — `ui/file-upload.tsx`

```tsx
FileUpload: ComponentProps<"div"> & { accept?: string; name?: string; disabled?: boolean; onFileSelect: (file: File) => void }
FileUploadTrigger: ComponentProps<typeof Button>          // variant "outline" por defecto
FileUploadDropzone: ComponentProps<"button">              // zona punteada grande
FileUploadPreview: ComponentProps<"img">
FileUploadActions: ComponentProps<"div">
```

```tsx
<FileUpload accept="image/jpeg,image/png,image/webp" disabled={uploading} onFileSelect={upload}>
  {photo && <FileUploadPreview src={photo.url} alt={t("products.preview")} />}
  <FileUploadActions>
    <FileUploadTrigger id="photo" aria-invalid={!!error} aria-describedby={error ? "photo-error" : undefined}>{t("products.choosePhoto")}</FileUploadTrigger>
    {photo && <Button type="button" variant="ghost" onClick={removePhoto}>{t("products.removePhoto")}</Button>}
  </FileUploadActions>
  {uploading && <Alert>{t("products.uploading")}</Alert>}
  {error && <Alert variant="destructive" id="photo-error"><AlertDescription>{error}</AlertDescription><AlertAction>…Reintentar…</AlertAction></Alert>}
</FileUpload>
```

El input nativo queda oculto (`data-slot="file-upload-input"`, fuera del orden de tabulación) y se resetea después de cada selección, así que elegir el mismo archivo otra vez vuelve a disparar `onFileSelect`. Los controles accesibles son el trigger o la dropzone. `FieldLabel htmlFor` apunta al `id` del trigger. En e2e, `setInputFiles` se usa sobre `[data-slot="file-upload-input"]` en lugar de `data-testid="logo-input"`. Subida, error y reintento los compone la ruta con `Alert`. `products/presentation/product-photo-field.tsx` es código muerto y se borra en la migración.

### AuthLayout — `ui/auth-layout.tsx`

```tsx
AuthLayout: ComponentProps<"div">            // <main> centrado + panel tipo card; className va al panel
AuthLayoutHeader: <header>; AuthLayoutTitle: <h1>; AuthLayoutDescription: <p>; AuthLayoutFooter: <footer>
```

```tsx
<AuthLayout>
  <AuthLayoutHeader><TextLink asChild><Link to={path("/")}>{brand}</Link></TextLink><AuthLayoutTitle>{t("common.login")}</AuthLayoutTitle><AuthLayoutDescription>…</AuthLayoutDescription></AuthLayoutHeader>
  <form>…</form>
  <AuthLayoutFooter>…</AuthLayoutFooter>
</AuthLayout>
```

Unifica los dos anchos (`max-w-sm` con card en auth-form y `max-w-lg` sin card en check-email, forgot y reset) en una sola variante: card `max-w-sm` con `--radius-card` en vez de `rounded-xl`. Si una pantalla necesita más ancho, se le pasa `className="max-w-lg"`.

## Ya existen: usar, no crear

- `Card` (`CardHeader`/`CardTitle`/`CardContent`) para las secciones con borde de order-new, order-detail, buyer-payment-content y settings.
- `PageContainer` y `PageHeader` en order-new, order-detail, checkout, buyer-payment, private-layout, product-list y appearance-settings.
- `Field` + `FieldLabel` en lugar de `<label>` + `Input`.
- `DataTable`/`Table` para la tabla de productos de order-detail.
- `Sheet` para el drawer de navegación.

## No se crea (por ahora)

| Pedido | Decisión |
|---|---|
| `NativeSelect` | El usuario decidió que `ui/select` sea el único select. |
| Select de shadcn (radix) | El `ui/select` del repo (base-ui) ya es nuestro y se mantiene. No se sobrescribe. |
| `SelectField` / `options` | Sería una props-bolsa; la composición es corta (ver Select). |
| Collapsible / Accordion de shadcn | Hay 2 usos de `<details>` con estilos distintos y el nativo ya es accesible. Si aparece un tercero: `pnpm dlx shadcn@latest add collapsible`. |
| CheckboxGroup | `FieldSet` + varios `Field orientation="horizontal"`. |
| Combobox (distritos) | Por ahora `Input` de búsqueda + `ui/select`. Si hace falta autocompletar: `shadcn add combobox`. |
| SegmentedControl / EmptyState propios | Se reemplazaron por `ToggleGroup` y `Empty` de shadcn. |
| ColorSwatch, LogoFrame, TagList | Un solo uso cada uno; se resuelven con `RadioGroupItem` y `className`. |
| StickyActionBar, BackLink, Avatar, ThemeToggle, Nav/Sidebar/Breadcrumb, SkipLink | Un solo uso en `private-layout` u `order-new`. Si se estandarizan, se toman de shadcn (`avatar`, `sidebar`, `breadcrumb`). |
| Toast (sonner) | No hay ningún uso; los avisos son `Alert`. |

## Hallazgos a corregir durante la migración

- `text-success` no existe como color de Tailwind (no hay `--color-success`), así que el aviso "Guardado" de checkout-appearance-settings:187 sale sin color. Se corrige con `<Alert variant="success">`.
- `bg-white` fijo en checkout-brand-header:13 y en el marco del logo de checkout-appearance-settings:170 es intencional: el logo necesita un fondo neutro. Se mantiene.
- Hay textos sin i18n: "Yoyos" (buyer-payment:56, auth-form:66), "Total:" (rated-delivery-form) y "CCI" (buyer-payment-content).
- Valores fuera de escala (`rounded-xl/lg`, `p-5`, `gap-5`, `gap-1.5`): pasar a radios de token y a la escala de espaciado al migrar cada archivo.

## Tabla de migración (archivo:línea → componente)

Las líneas son del 2026-10-12 (rama `preparacion-despachos-rotulos`, con cambios sin commit en componentes de checkout). Rutas relativas a `apps/core/`.

| Archivo:línea | Componente |
|---|---|
| app/components/checkout-delivery-fields.tsx:78, 90, 96, 102 | Select |
| app/components/checkout-delivery-fields.tsx:87-89 | Alert |
| app/components/checkout-sections.tsx:46 | DescriptionList |
| app/components/checkout-sections.tsx:45, 66 | FieldDescription / Alert |
| app/components/checkout-sections.tsx:62 | Alert |
| app/components/agency-picker.tsx:55 | Select |
| app/components/agency-picker.tsx:60-63 | Alert |
| app/components/agency-picker.tsx:66 | Checkbox + Field horizontal |
| app/components/agency-picker.tsx:46, 53, 68 | FieldDescription |
| app/components/delivery-zones-section.tsx:111, 136 | Checkbox + Field horizontal |
| app/components/delivery-zones-section.tsx:120 | Select |
| app/components/delivery-zones-section.tsx:146, 148 | Alert |
| app/components/delivery-zones-section.tsx:80, 83, 88, 115, 130 | FieldDescription |
| app/components/peru-district-select.tsx:28, 33, 42 | Select |
| app/components/peru-district-select.tsx:45 | Alert (o FieldDescription) |
| app/components/peru-district-multi-select.tsx:33, 38 | Select |
| app/components/peru-district-multi-select.tsx:46 | Alert |
| app/components/peru-district-multi-select.tsx:49 | Checkbox + Field horizontal |
| app/components/auth-form.tsx:65 | AuthLayout |
| app/components/auth-form.tsx:79 | Alert |
| app/components/auth-form.tsx:66, 82, 83 | TextLink |
| app/routes/check-email.tsx:28 | AuthLayout + Alert + TextLink |
| app/routes/forgot-password.tsx:27 | AuthLayout + Alert |
| app/routes/reset-password.tsx:41 | AuthLayout + Alert + TextLink |
| app/routes/account-verified.tsx:11 | AuthLayout + TextLink |
| app/routes/product-list.tsx:48, 96 | TextLink |
| app/routes/product-list.tsx:98 | Pagination |
| app/routes/product-detail.tsx:99 | Alert |
| app/routes/product-detail.tsx:104 | DescriptionList |
| src/features/products/presentation/product-form.tsx:101-106 | FileUpload + Alert |
| src/features/products/presentation/product-form.tsx:115 | Alert |
| src/features/products/presentation/product-photo-field.tsx | borrar (código muerto) |
| app/routes/order-list.tsx:66, 74 | TextLink |
| app/routes/order-list.tsx:109 | Empty (en `emptyMessage`) |
| app/routes/order-list.tsx:110 | Pagination |
| app/routes/order-list.tsx:116 | `<details>` se mantiene |
| app/routes/order-list.tsx:138, 139 | Select (filtro GET: `name`) |
| app/routes/order-detail.tsx:228-230 | Badge |
| app/routes/order-detail.tsx:234 | Dialog |
| app/routes/order-detail.tsx:244-248, 279-280, 303-304, 328-329, 341-342 | Alert |
| app/routes/order-detail.tsx:258 | Table/DataTable |
| app/routes/order-detail.tsx:271, 313, 339 | DescriptionList |
| app/routes/order-detail.tsx:289, 305, 344 | TextLink |
| app/routes/order-detail.tsx:349 | `<details>` se mantiene |
| app/routes/order-new.tsx:143, 149 | Empty |
| app/routes/order-new.tsx:145, 182 | TextLink |
| app/routes/order-new.tsx:150, 154, 195 | Alert |
| app/routes/order-new.tsx:177, 183 | Checkbox + Field horizontal |
| src/features/orders/presentation/payment-fields.tsx:10 | Select |
| src/features/orders/presentation/payment-fields.tsx:12 | Checkbox + Field horizontal |
| src/features/orders/presentation/rated-delivery-form.tsx:77, 86, 91, 95 | Select |
| src/features/orders/presentation/rated-delivery-form.tsx:83-85 | Alert |
| src/features/orders/presentation/buyer-payment-content.tsx:73 | RadioGroup + FieldLabel (tarjeta de opción) |
| src/features/orders/presentation/buyer-payment-content.tsx:75 | DescriptionList vertical |
| src/features/orders/presentation/buyer-payment-content.tsx:78, 88, 90, 91 | Alert |
| src/features/orders/presentation/buyer-payment-content.tsx:82-87 | FileUpload + FileUploadDropzone |
| src/features/orders/presentation/buyer-payment-content.tsx:95 | TextLink |
| app/routes/buyer-payment.tsx:50, 56 | PageContainer (+ i18n de "Yoyos") |
| app/routes/delivery-settings.tsx:178-189 | Tabs `variant="line"` |
| app/routes/delivery-settings.tsx:194, 208, 218, 225 | Checkbox + Field horizontal |
| app/routes/delivery-settings.tsx:195, 209, 221, 222, 245 | FieldDescription |
| app/routes/delivery-settings.tsx:230 | Select |
| app/routes/delivery-settings.tsx:243, 244 | Alert |
| app/routes/payment-settings.tsx:79, 86 | Checkbox + Field horizontal |
| app/routes/payment-settings.tsx:95-97, 108 | Alert |
| app/routes/payment-settings.tsx:106 | FileUpload |
| app/routes/checkout-appearance-settings.tsx:163, 249-256 | Tabs (default) |
| app/routes/checkout-appearance-settings.tsx:178 | FileUpload (e2e: `data-testid="logo-input"` → `[data-slot="file-upload-input"]`) |
| app/routes/checkout-appearance-settings.tsx:187, 188, 238, 239 | Alert (+ AlertAction para Reintentar) |
| app/routes/checkout-appearance-settings.tsx:207 | RadioGroup + FieldLabel (tarjeta de opción) |
| app/routes/checkout-appearance-settings.tsx:233 | Badge |
| app/routes/checkout-appearance-settings.tsx:258-272 | Dialog |
| src/features/checkout-appearance/presentation/brand-color-dialog.tsx:35-79 | Dialog + RadioGroup (swatches con `className`) |
| src/features/checkout-appearance/presentation/checkout-preview-frame.tsx:23, 75, 77, 79 | ToggleGroup |
| src/features/checkout-appearance/presentation/checkout-preview-page.tsx:50 | Alert `role="note"` (conserva el recuadro punteado con `className`) |
| app/routes/private-layout.tsx:74 | Alert |
| app/routes/private-layout.tsx:138 | Sheet |
