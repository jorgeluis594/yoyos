import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import resources from "@core/app/locales";
import type { PeruDistrictCode } from "@shared/peru-geography";
import { PeruDistrictMultiSelect } from "./peru-district-multi-select";

const i18n = createInstance();
void i18n.use(initReactI18next).init({ lng: "es", resources });

function Stateful({ initial }: { initial: readonly PeruDistrictCode[] }) {
  const [value, setValue] = useState(initial);
  return <I18nextProvider i18n={i18n}><div className="max-w-xl"><PeruDistrictMultiSelect value={value} onChange={setValue} /></div></I18nextProvider>;
}

const meta = {
  title: "Design System/Patterns/Peru District Multi Select",
  component: Stateful,
} satisfies Meta<typeof Stateful>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Lima: Story = {
  name: "Zona con distritos",
  args: { initial: ["150101", "150102", "150110", "150115", "150122", "040110"] as PeruDistrictCode[] },
};

export const Empty: Story = {
  name: "Sin distritos",
  args: { initial: [] },
};
