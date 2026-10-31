import { createAuthClient } from "better-auth/react";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";

// oauthProviderClient adds the signed authorization query of the page to every auth request, so the sign-in continues the agent's request.
export const authClient = createAuthClient({ plugins: [oauthProviderClient()] });
