import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { boxConfig, methodNotAllowed, validSession } from "../../lib/box-session.js";

export default async function handler(request, response) {
  if (request.method !== "GET") return methodNotAllowed(response, "GET");

  const fileId = request.query?.file_id;
  if (typeof fileId !== "string" || !/^\d{1,30}$/.test(fileId)) {
    return response.status(400).json({ error: "A valid Box file_id is required." });
  }

  try {
    boxConfig();
    const session = await validSession(request, response);
    if (!session) {
      response.setHeader("Cache-Control", "no-store");
      return response.status(401).json({ error: "Box is not connected.", authorize_url: "/api/box/auth" });
    }

    const authHeaders = { Authorization: `Bearer ${session.accessToken}` };
    const metadataResponse = await fetch(
      `https://api.box.com/2.0/files/${encodeURIComponent(fileId)}?fields=id,name,type,extension,size`,
      { headers: authHeaders, cache: "no-store" },
    );
    if (!metadataResponse.ok) {
      return response.status(metadataResponse.status === 404 ? 404 : 502).json({
        error: "Could not read this file from Box. Check the app's file read permissions.",
      });
    }
    const metadata = await metadataResponse.json();
    const extension = String(metadata.extension || "").toLowerCase();
    if (metadata.type !== "file" || !["jpg", "jpeg", "png"].includes(extension)) {
      return response.status(415).json({ error: "Only JPEG and PNG files can be imported." });
    }

    const fileResponse = await fetch(
      `https://api.box.com/2.0/files/${encodeURIComponent(fileId)}/content`,
      { headers: authHeaders, cache: "no-store" },
    );
    if (!fileResponse.ok || !fileResponse.body) {
      return response.status(502).json({ error: "Box could not provide the selected image." });
    }

    const safeName = String(metadata.name || `box-image.${extension}`).replace(/[\r\n]/g, "_");
    const contentType = extension === "png" ? "image/png" : "image/jpeg";
    response.statusCode = 200;
    response.setHeader("Content-Type", contentType);
    response.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}`);
    response.setHeader("Cache-Control", "no-store, private");
    response.setHeader("X-Content-Type-Options", "nosniff");
    if (/^\d+$/.test(String(metadata.size || ""))) response.setHeader("Content-Length", String(metadata.size));
    await pipeline(Readable.fromWeb(fileResponse.body), response);
  } catch (error) {
    if (!response.headersSent) return response.status(503).json({ error: "Box download is temporarily unavailable." });
    response.destroy(error);
  }
}
