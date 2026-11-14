// src/utils/logRedact.js
// Paths are written to the request log. Some carry secrets in the path itself:
// each school's M-Pesa callback URL is /api/public/mpesa/<token>/..., and that
// token is the only thing that lets Safaricom (or anyone holding it) post a
// payment. Log lines must never contain it (audit 2, A2-SEC-03).

const SECRET_PATHS = [/^(\/api\/public\/mpesa\/)[^/]+/i];

/** The request path without its query string, with secret segments replaced. */
export function redactPath(url) {
  let p = String(url || "").split("?")[0];
  for (const re of SECRET_PATHS) p = p.replace(re, "$1[redacted]");
  return p;
}
