import {
  boxConfig,
  clearOAuthStateCookie,
  cookieValue,
  methodNotAllowed,
  setSessionCookie,
  STATE_COOKIE,
} from "../../lib/box-session.js";

export default async function handler(request, response) {
  if (request.method !== "GET") return methodNotAllowed(response, "GET");

  const { code, state, error } = request.query || {};
  clearOAuthStateCookie(request, response);
  if (error) return response.redirect(302, "/?box=access-denied");
  const expectedState = cookieValue(request, STATE_COOKIE);
  if (!code || !state || !expectedState || state !== expectedState) {
    return response.status(400).send("Box authorization could not be verified. Return to Fieldwise and try connecting again.");
  }

  let config;
  try {
    config = boxConfig();
  } catch {
    return response.status(503).send("Box OAuth is not configured on this deployment.");
  }

  try {
    const form = new URLSearchParams({
      grant_type: "authorization_code",
      code: String(code),
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
    });
    const tokenResponse = await fetch("https://api.box.com/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
      cache: "no-store",
    });
    if (!tokenResponse.ok) {
      return response.status(502).send("Box sign-in succeeded, but Fieldwise could not complete the token exchange. Check the Box app redirect URI and OAuth configuration.");
    }
    const tokens = await tokenResponse.json();
    if (!tokens.access_token) {
      return response.status(502).send("Box did not return an access token. Check the Box app OAuth settings.");
    }
    setSessionCookie(request, response, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || "",
      expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000,
    });
    response.setHeader("Cache-Control", "no-store");
    return response.redirect(302, "/?box=connected");
  } catch {
    return response.status(502).send("Could not connect to Box. Please retry the sign-in.");
  }
}
