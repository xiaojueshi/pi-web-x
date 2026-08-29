import {
  isApiRequestAllowed,
  isApiRequestHostAllowed,
} from "@/lib/request-security";
import {
  isValidBasicAuthorization,
  isWebPasswordEnabled,
} from "@/lib/web-auth";

/** 对所有 pi-web-x HTTP 请求应用 Host、来源与 Basic Auth 策略。 */
export function authorizeRequest(request: Request): Response | null {
  const url = new URL(request.url);
  const trusted =
    url.pathname === "/api" || url.pathname.startsWith("/api/")
      ? isApiRequestAllowed(request)
      : isApiRequestHostAllowed(request);
  if (!trusted) {
    return url.pathname.startsWith("/api/")
      ? Response.json({ error: "Untrusted API request" }, { status: 403 })
      : new Response("Untrusted request", { status: 403 });
  }

  const password = process.env.PI_WEB_X_PASSWORD;
  if (
    isWebPasswordEnabled(password) &&
    !isValidBasicAuthorization(request.headers.get("authorization"), password)
  ) {
    return new Response("Authentication required", {
      status: 401,
      headers: {
        "Cache-Control": "no-store",
        "WWW-Authenticate": 'Basic realm="Pi Web X", charset="UTF-8"',
      },
    });
  }
  return null;
}
