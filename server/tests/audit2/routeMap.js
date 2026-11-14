// Lists every route the Express app serves: method + full path.
// Express 5's router doesn't keep a mounted router's path, so this module
// records it when routers are mounted. It MUST be imported before src/app.js.
import Router from "router";

const origUse = Router.prototype.use;
Router.prototype.use = function patchedUse(...args) {
  const before = this.stack.length;
  const out = origUse.apply(this, args);
  const mount = typeof args[0] === "string" ? args[0] : "";
  for (let i = before; i < this.stack.length; i++) this.stack[i].__mount = mount;
  return out;
};

function join(a, b) {
  const p = `${a}/${b}`.replace(/\/+/g, "/");
  return p.length > 1 ? p.replace(/\/$/, "") : p;
}

function walk(stack, prefix, out) {
  for (const layer of stack) {
    if (layer.route) {
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      for (const p of paths) {
        if (typeof p !== "string") continue;
        for (const [m, on] of Object.entries(layer.route.methods)) {
          if (on && m !== "_all") out.push({ method: m.toUpperCase(), path: join(prefix, p) });
        }
      }
    } else if (layer.handle && Array.isArray(layer.handle.stack)) {
      walk(layer.handle.stack, join(prefix, layer.__mount || ""), out);
    }
  }
  return out;
}

/** All routes of an Express app, de-duplicated, sorted by path. */
export function listRoutes(app) {
  const seen = new Set();
  return walk(app.router.stack, "", [])
    .filter((r) => {
      const k = `${r.method} ${r.path}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

/** Route parameters in a path, e.g. "/api/students/:id/x/:subId" -> ["id", "subId"]. */
export function paramsOf(path) {
  return [...path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]);
}
