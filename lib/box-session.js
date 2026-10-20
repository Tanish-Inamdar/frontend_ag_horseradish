import crypto from "node:crypto";

export const SESSION_COOKIE = "fieldwise_box_session";
export const STATE_COOKIE = "fieldwise_box_oauth_state";
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

export function boxConfig() {
  const clientId = process.env.BOX_CLIENT_ID;
  const clientSecret = process.env.BOX_CLIENT_SECRET;
  const redirectUri = process.env.BOX_REDIRECT_URI;
  const encodedKey = process.env.BOX_SESSION_SECRET;
  if (!clientId || !clientSecret || !redirectUri || !encodedKey) {
    throw new Error("Box OAuth is not fully configured.");
  }
  if (!/^[a-f0-9]{64}$/i.test(encodedKey)) {
    throw new Error("BOX_SESSION_SECRET must be a 64-character hex key.");
  }
  return { clientId, clientSecret, redirectUri, key: Buffer.from(encodedKey, "hex") };
}

export function cookieValue(request, name) {
  const header = String(request.headers.cookie || "");
  for (const pair of header.split(";")) {
    const separator = pair.indexOf("=");
    if (separator < 0) continue;
    if (pair.slice(0, separator).trim() === name) return pair.slice(separator + 1).trim();
  }
  return "";
}

function appendCookie(response, value) {
  const current = response.getHeader("Set-Cookie");
  response.setHeader("Set-Cookie", current ? [...(Array.isArray(current) ? current : [current]), value] : value);
}

function secureCookie(request) {
  return process.env.NODE_ENV === "production" || request.headers["x-forwarded-proto"] === "https";
}

export function setOAuthStateCookie(request, response, state) {
  const secure = secureCookie(request) ? "; Secure" : "";
  appendCookie(response, `${STATE_COOKIE}=${state}; Path=/api/box/callback; Max-Age=600; HttpOnly; SameSite=Lax${secure}`);
}

export function clearOAuthStateCookie(request, response) {
  const secure = secureCookie(request) ? "; Secure" : "";
  appendCookie(response, `${STATE_COOKIE}=; Path=/api/box/callback; Max-Age=0; HttpOnly; SameSite=Lax${secure}`);
}

function seal(value, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString("base64url")).join(".");
}

function unseal(value, key) {
  const [ivText, tagText, encryptedText] = String(value).split(".");
  if (!ivText || !tagText || !encryptedText) return null;
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivText, "base64url"));
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encryptedText, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    return JSON.parse(plaintext);
  } catch {
    return null;
  }
}

export function setSessionCookie(request, response, session) {
  const { key } = boxConfig();
  const value = seal(session, key);
  const secure = secureCookie(request) ? "; Secure" : "";
  appendCookie(response, `${SESSION_COOKIE}=${value}; Path=/; Max-Age=${SESSION_MAX_AGE}; HttpOnly; SameSite=Lax${secure}`);
}

export function clearSessionCookie(request, response) {
  const secure = secureCookie(request) ? "; Secure" : "";
  appendCookie(response, `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`);
}

export function readSession(request) {
  try {
    const { key } = boxConfig();
    return unseal(cookieValue(request, SESSION_COOKIE), key);
  } catch {
    return null;
  }
}

export async function validSession(request, response) {
  const session = readSession(request);
  if (!session?.accessToken) return null;
  if (session.expiresAt > Date.now() + 60_000) return session;
  if (!session.refreshToken) {
    clearSessionCookie(request, response);
    return null;
  }

  const { clientId, clientSecret } = boxConfig();
  const form = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: session.refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });
  try {
    const tokenResponse = await fetch("https://api.box.com/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
      cache: "no-store",
    });
    if (!tokenResponse.ok) {
      clearSessionCookie(request, response);
      return null;
    }
    const tokens = await tokenResponse.json();
    const refreshed = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || session.refreshToken,
      expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000,
    };
    if (!refreshed.accessToken) {
      clearSessionCookie(request, response);
      return null;
    }
    setSessionCookie(request, response, refreshed);
    return refreshed;
  } catch {
    return null;
  }
}

export function methodNotAllowed(response, allowed) {
  response.setHeader("Allow", allowed);
  return response.status(405).json({ error: "Method not allowed" });
}
