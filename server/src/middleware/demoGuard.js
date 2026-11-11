// src/middleware/demoGuard.js
import { isDemo } from "../config/demo.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// The only writes a demo visitor may make: signing in, and a SYSTEM_ADMIN
// choosing which school to look at (it only issues a new token).
const EXEMPT = new Set([
  "/api/auth/login",
  "/api/auth/demo-login",
  "/api/auth/select-school",
]);

export const DEMO_MESSAGE =
  "This is a read-only demo, so nothing can be saved here. Everything you see is sample data.";

// In a demo deployment, every request that could change something stops here.
// It decides on the HTTP method, not a list of routes, so a write route added
// later is refused too without anyone remembering to add it.
// 403 (not 401) so the client does not sign the visitor out.
export function demoGuard(req, res, next) {
  if (!isDemo()) return next();
  if (SAFE_METHODS.has(req.method)) return next();

  const path = String(req.originalUrl || "").split("?")[0].replace(/\/+$/, "");
  if (EXEMPT.has(path)) return next();

  return res.status(403).json({ message: DEMO_MESSAGE, code: "DEMO_READ_ONLY" });
}
