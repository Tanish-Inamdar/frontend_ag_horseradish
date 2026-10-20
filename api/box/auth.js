import crypto from "node:crypto";
import { boxConfig, methodNotAllowed, setOAuthStateCookie } from "../../lib/box-session.js";

export default function handler(request, response) {
  if (request.method !== "GET") return methodNotAllowed(response, "GET");

  let config;
  try {
    config = boxConfig();
  } catch {
    return response.status(503).json({ error: "Box OAuth is not configured on this deployment." });
  }

  const state = crypto.randomBytes(24).toString("base64url");
  setOAuthStateCookie(request, response, state);
  const authorizeUrl = new URL("https://account.box.com/api/oauth2/authorize");
  authorizeUrl.search = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    state,
  }).toString();
  response.setHeader("Cache-Control", "no-store");
  return response.redirect(302, authorizeUrl.toString());
}
