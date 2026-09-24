import type { Preview } from "@storybook/react-vite";
import { themeCss } from "@/design-theme";
import "../app/app.css";

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
