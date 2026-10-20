import { boxConfig, methodNotAllowed, validSession } from "../../lib/box-session.js";

export default async function handler(request, response) {
  if (request.method !== "GET") return methodNotAllowed(response, "GET");
  try {
    boxConfig();
    const session = await validSession(request, response);
    response.setHeader("Cache-Control", "no-store, private");
    response.setHeader("Pragma", "no-cache");
    if (!session) {
      return response.status(401).json({ error: "Box is not connected.", authorize_url: "/api/box/auth" });
    }
    return response.status(200).json({
      access_token: session.accessToken,
      folder_id: process.env.BOX_FOLDER_ID || "0",
    });
  } catch {
    return response.status(503).json({ error: "Box OAuth is not configured on this deployment." });
  }
}
