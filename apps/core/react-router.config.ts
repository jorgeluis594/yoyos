import type { Config } from "@react-router/dev/config";

export default {
  ssr: true,
  future: { v8_middleware: true },
  // With lazy discovery a form submit first fetches /__manifest for its own route, and that request fails without a connection: the seller would lose the form to the root error boundary before the action even runs.
  routeDiscovery: { mode: "initial" },
} satisfies Config;
