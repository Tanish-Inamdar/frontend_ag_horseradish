/* Same-origin Vercel routes; all Box credentials and refresh tokens stay server-side. */
window.FIELDWISE_BOX_CONFIG = {
  authUrl: "/api/box/auth",
  tokenUrl: "/api/box/token",
  downloadUrl: "/api/box/download",
};
