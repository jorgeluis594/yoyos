import type { Preview } from "@storybook/react-vite";
import designTokens from "../../../docs/design-tokens.json";
import "../app/app.css";

const cssVariables = (colors: Record<string, string>) =>
  Object.entries(colors).map(([name, value]) => `--${name}:${value};`).join("");

const themeCss = `:root{${cssVariables(designTokens.colors.light)}--radius-control:${designTokens.radius.control}px;--radius-card:${designTokens.radius.card}px;--radius-overlay:${designTokens.radius.overlay}px}.dark{${cssVariables(designTokens.colors.dark)}}`;

const preview: Preview = {
  globalTypes: {
    theme: {
      description: "Tema de color",
      defaultValue: "light",
      toolbar: {
        title: "Tema",
        icon: "circlehollow",
        items: [
          { value: "light", title: "Claro", icon: "sun" },
          { value: "dark", title: "Oscuro", icon: "moon" },
        ],
      },
    },
  },
  decorators: [
    (Story, { globals }) => {
      document.documentElement.classList.toggle("dark", globals.theme === "dark");
      return (
        <>
          <style>{themeCss}</style>
          <main className="min-h-screen bg-background p-8 text-foreground">
            <Story />
          </main>
        </>
      );
    },
  ],
};

export default preview;
