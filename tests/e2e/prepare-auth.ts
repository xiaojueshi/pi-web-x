import {
  getSetupTokenForTests,
  initializeAuth,
} from "../../lib/pi-web-auth.ts";

const password = process.env.PI_WEB_X_PASSWORD;
if (!password) {
  throw new Error("PI_WEB_X_PASSWORD is required for the E2E auth fixture");
}

await initializeAuth(getSetupTokenForTests(), password);
