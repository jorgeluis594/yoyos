import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Check,
  ChevronRight,
  Eye,
  House,
  LogOut,
  Menu,
  Moon,
  ShoppingBag,
  Sun,
  X,
} from "lucide-react";
import tokens from "../../../../docs/design-tokens.json";

const meta = { title: "Design System/Foundations" } satisfies Meta;
export default meta;

type Story = StoryObj<typeof meta>;

const themes = [
  { id: "light", label: "Claro", values: tokens.colors.light },
  { id: "dark", label: "Oscuro", values: tokens.colors.dark },
] as const;

function ColorsPanel() {
  return (
    <div className="flex flex-col gap-10">
      {themes.map((theme) => (
        <section key={theme.id}>
          <h2 className="text-lg font-semibold">{theme.label}</h2>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {Object.entries(theme.values).map(([name, value]) => (
              <div key={name} className="flex flex-col gap-2">
                <div
                  className="h-16 rounded-[var(--radius-control)] border border-border"
                  style={{ backgroundColor: value }}
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{name}</p>
                  <p className="font-mono text-xs text-muted-foreground">{value}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export const Colors: Story = {
  name: "Colores",
  render: () => <ColorsPanel />,
};

function TypographyPanel() {
  return (
    <div className="flex max-w-form flex-col gap-8">
      {Object.entries(tokens.typography.roles).map(([name, role]) => (
        <div key={name} className="border-b border-border pb-6 last:border-0">
          <p className="font-mono text-xs text-muted-foreground">
            {name} · {role.size}/{role.lineHeight} · {role.weight}
          </p>
          <p
            className="mt-2"
            style={{
              fontSize: `${role.size}px`,
              lineHeight: `${role.lineHeight}px`,
              fontWeight: role.weight,
            }}
          >
            Yoyos, un sistema de diseño para vender mejor
          </p>
        </div>
      ))}
    </div>
  );
}

export const Typography: Story = {
  name: "Tipografía",
  render: () => <TypographyPanel />,
};

function SpacingPanel() {
  return (
    <div className="flex max-w-form flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Unidad base: {tokens.spacing["1"]}px (<code>--space-unit</code>)
      </p>
      {Object.entries(tokens.spacing).map(([step, value]) => (
        <div key={step} className="flex items-center gap-4">
          <span className="w-16 font-mono text-xs text-muted-foreground">
            {step} · {value}px
          </span>
          <div
            className="h-4 rounded-full bg-primary"
            style={{ width: `${Math.max(value, 2)}px` }}
          />
        </div>
      ))}
    </div>
  );
}

export const Spacing: Story = {
  name: "Espaciado",
  render: () => <SpacingPanel />,
};

function RadiusPanel() {
  return (
    <div className="flex flex-wrap gap-6">
      {Object.entries(tokens.radius).map(([name, value]) => (
        <div key={name} className="flex flex-col items-center gap-2">
          <div
            className="size-20 border border-border bg-secondary"
            style={{ borderRadius: value > 40 ? "50%" : `${value}px` }}
          />
          <p className="text-sm font-medium">{name}</p>
          <p className="font-mono text-xs text-muted-foreground">
            {value > 40 ? "full" : `${value}px`}
          </p>
        </div>
      ))}
    </div>
  );
}

export const Radius: Story = {
  name: "Radios",
  render: () => <RadiusPanel />,
};

type Measure = { label: string; value: number; cssVar?: string };

function MeasureList({ title, measures }: { title: string; measures: Measure[] }) {
  return (
    <section>
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <dl className="mt-3 flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border">
        {measures.map((measure) => (
          <div key={measure.label} className="flex items-baseline justify-between gap-4 px-4 py-2.5 text-sm">
            <dt className="min-w-0">
              {measure.label}
              {measure.cssVar ? (
                <code className="ml-2 text-xs text-muted-foreground">{measure.cssVar}</code>
              ) : null}
            </dt>
            <dd className="shrink-0 font-mono tabular-nums text-muted-foreground">
              {measure.value}px
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function LayoutPanel() {
  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <MeasureList
        title="Diseño"
        measures={Object.entries(tokens.layout).map(([label, value]) => ({ label, value }))}
      />
      <MeasureList
        title="Dimensiones"
        measures={Object.entries(tokens.sizing).map(([label, value]) => ({ label, value }))}
      />
    </div>
  );
}

export const Layout: Story = {
  name: "Diseño y dimensiones",
  render: () => <LayoutPanel />,
};

const icons = [
  ["House", House],
  ["ShoppingBag", ShoppingBag],
  ["Menu", Menu],
  ["X", X],
  ["Sun", Sun],
  ["Moon", Moon],
  ["Check", Check],
  ["ChevronRight", ChevronRight],
  ["LogOut", LogOut],
  ["Eye", Eye],
] as const;

function IconsPanel() {
  return (
    <div className="flex flex-wrap gap-6">
      {icons.map(([name, Icon]) => (
        <div key={name} className="flex flex-col items-center gap-2">
          <Icon className="size-icon-navigation" aria-hidden="true" />
          <span className="font-mono text-xs text-muted-foreground">{name}</span>
        </div>
      ))}
    </div>
  );
}

export const Icons: Story = {
  name: "Iconos",
  render: () => <IconsPanel />,
};
