import { useId } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "@core/app/components/ui/button";
import { Field, FieldLabel } from "@core/app/components/ui/field";
import { Input } from "@core/app/components/ui/input";
import { checkoutBackgrounds, type CheckoutBackground, type CheckoutBrandColor } from "@core/src/features/checkout-appearance/domain/checkout-appearance";
import { checkoutBrandColorCatalog } from "@core/src/features/checkout-appearance/domain/checkout-colors";
import { CheckoutBrandHeader } from "@core/src/features/checkout-appearance/presentation/checkout-brand-header";
import { CheckoutTheme } from "@core/src/features/checkout-appearance/presentation/checkout-theme";

const svg = (markup: string) => `data:image/svg+xml;utf8,${encodeURIComponent(markup)}`;
const logos = {
  square: svg('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><rect width="240" height="240" fill="#2F6B4F"/><text x="120" y="160" font-family="Arial" font-size="120" font-weight="700" fill="#fff" text-anchor="middle">LS</text></svg>'),
  horizontal: svg('<svg xmlns="http://www.w3.org/2000/svg" width="720" height="160"><rect width="720" height="160" fill="#1F5A8C"/><text x="360" y="105" font-family="Arial" font-size="72" font-weight="700" fill="#fff" text-anchor="middle">LIMA STUDIO</text></svg>'),
  transparent: svg('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><circle cx="120" cy="120" r="90" fill="none" stroke="#242326" stroke-width="16"/><text x="120" y="148" font-family="Arial" font-size="80" font-weight="700" fill="#242326" text-anchor="middle">LS</text></svg>'),
  broken: "/missing-logo.png",
} as const;

type SampleProps = Readonly<{ brandColor: CheckoutBrandColor; background: CheckoutBackground; logoUrl?: string | null; companyName?: string }>;

/** A compact version of the buyer checkout: header, totals, form, selection and links. */
function CheckoutSample({ brandColor, background, logoUrl = null, companyName = "Lima Studio" }: SampleProps) {
  const id = useId();
  return (
    <CheckoutTheme appearance={{ logoUrl: null, brandColor, background }}>
      <div className="mx-auto flex max-w-lg flex-col gap-5 p-5">
        <CheckoutBrandHeader companyName={companyName} logoUrl={logoUrl} />
        <header>
          <h2 className="text-2xl font-semibold">Pedido #1001</h2>
          <p>Revisa los productos y el total de tu pedido.</p>
        </header>
        <dl className="flex flex-col gap-2">
          <div className="flex justify-between gap-4"><dt>Subtotal de productos</dt><dd>S/ 118,00</dd></div>
          <div className="flex justify-between gap-4 text-xl font-semibold"><dt>Total a pagar</dt><dd>S/ 128,00</dd></div>
        </dl>
        <p className="text-sm text-muted-foreground">Incluye el código de país, por ejemplo +51987654321.</p>
        <label className="flex items-center gap-3 rounded-[var(--radius-card)] border border-primary bg-accent p-3 text-accent-foreground">
          <input type="radio" name={`delivery-${id}`} defaultChecked /> Envío a domicilio
        </label>
        <Field><FieldLabel htmlFor={`name-${id}`}>Nombre</FieldLabel><Input id={`name-${id}`} defaultValue="Ana Pérez" /></Field>
        <div className="flex flex-wrap items-center gap-4">
          <Button>Confirmar pedido</Button>
          <Button variant="link" className="px-0">Cambiar entrega</Button>
        </div>
      </div>
    </CheckoutTheme>
  );
}

const meta = {
  title: "Checkout/Apariencia",
  component: CheckoutSample,
  parameters: { layout: "fullscreen" },
  // The color stories show every background of one color; these controls would change nothing.
  argTypes: { brandColor: { table: { disable: true } }, background: { table: { disable: true } } },
} satisfies Meta<typeof CheckoutSample>;
export default meta;

type Story = StoryObj<typeof meta>;
type Mode = "light" | "dark";

const backgroundNames: Record<CheckoutBackground, string> = { white: "Blanco", neutral: "Neutro", brand_tint: "De marca" };

/** One color combined with the three backgrounds, in the mode chosen in the toolbar. */
function colorStory(brandColor: CheckoutBrandColor, theme: Mode): Story {
  return {
    name: `${checkoutBrandColorCatalog[brandColor].name} · ${theme === "light" ? "claro" : "oscuro"}`,
    args: { brandColor, background: "neutral" },
    globals: { theme },
    render: ({ logoUrl }) => (
      <div className="grid gap-4 lg:grid-cols-3">
        {checkoutBackgrounds.map((background) => (
          <section key={background} aria-label={`Fondo ${backgroundNames[background]}`} className="overflow-hidden rounded-lg border [&_[data-checkout-theme]]:min-h-0">
            <CheckoutSample brandColor={brandColor} background={background} logoUrl={logoUrl} />
          </section>
        ))}
      </div>
    ),
  };
}

export const YoyosLight = colorStory("yoyos", "light");
export const YoyosDark = colorStory("yoyos", "dark");
export const ForestLight = colorStory("forest", "light");
export const ForestDark = colorStory("forest", "dark");
export const PetrolLight = colorStory("petrol", "light");
export const PetrolDark = colorStory("petrol", "dark");
export const OceanLight = colorStory("ocean", "light");
export const OceanDark = colorStory("ocean", "dark");
export const PlumLight = colorStory("plum", "light");
export const PlumDark = colorStory("plum", "dark");
export const RaspberryLight = colorStory("raspberry", "light");
export const RaspberryDark = colorStory("raspberry", "dark");
export const TerracottaLight = colorStory("terracotta", "light");
export const TerracottaDark = colorStory("terracotta", "dark");
export const MustardLight = colorStory("mustard", "light");
export const MustardDark = colorStory("mustard", "dark");
export const GraphiteLight = colorStory("graphite", "light");
export const GraphiteDark = colorStory("graphite", "dark");

/** Every logo shape on the same brand, to check the header box keeps the full image. */
function logoStory(name: string, theme: Mode): Story {
  return {
    name,
    args: { brandColor: "forest", background: "brand_tint" },
    globals: { theme },
    render: ({ brandColor, background }) => (
      <div className="grid gap-4 lg:grid-cols-2">
        {([["Cuadrado", logos.square], ["Horizontal", logos.horizontal], ["Transparente", logos.transparent], ["Roto", logos.broken], ["Sin logo", null]] as const).map(([label, logoUrl]) => (
          <section key={label} aria-label={`Logo ${label}`} className="overflow-hidden rounded-lg border [&_[data-checkout-theme]]:min-h-0">
            <CheckoutSample brandColor={brandColor} background={background} logoUrl={logoUrl} />
          </section>
        ))}
        <section aria-label="Nombre largo" className="overflow-hidden rounded-lg border [&_[data-checkout-theme]]:min-h-0">
          <CheckoutSample brandColor={brandColor} background={background} logoUrl={logos.horizontal} companyName="Taller de cerámica y accesorios artesanales Lima Studio" />
        </section>
      </div>
    ),
  };
}

export const LogosLight = logoStory("Logos · claro", "light");
export const LogosDark = logoStory("Logos · oscuro", "dark");
