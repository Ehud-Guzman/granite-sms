// src/config/demo.js
//
// Demo mode: a copy of the system anyone can walk through and nobody can change.
//
// It exists so a visitor to the portfolio can see the real screens with sample
// data. It is a separate deployment with its own database, switched on by one
// variable, DEMO_MODE=true. Everything it changes is small and lives here,
// in middleware/demoGuard.js and in the demo-login route (routes/auth.js):
//
//   * every write is refused, apart from signing in and choosing a school;
//   * sign-in has a one-click door per role (POST /api/auth/demo-login),
//     because there is no password to hand out;
//   * the server refuses to start unless its database name contains "demo",
//     so a mistyped DATABASE_URL can never point the demo at real data.
//
// Read at call time, not at import, so a test can switch it on and off.

export function isDemo() {
  return String(process.env.DEMO_MODE || "").trim().toLowerCase() === "true";
}

// The seeded demo accounts. ".invalid" is a reserved domain: it can never
// receive mail or belong to a real person.
// prisma/seedDemo.js creates exactly these accounts; keep the two in step.
export const DEMO_ACCOUNTS = {
  SYSTEM_ADMIN: "platform@granite-demo.invalid",
  ADMIN: "admin@mwangaza.invalid",
  BURSAR: "rose.nduta@mwangaza.invalid",
  TEACHER: "grace.wanjiru@mwangaza.invalid",
  STUDENT: "zawadi.kiptoo@mwangaza.invalid",
};

// The database a Postgres URL points at:
// postgresql://user:pw@host:5432/granite_demo?sslmode=require -> "granite_demo"
export function dbNameOf(url) {
  const m = /^postgres(?:ql)?:\/\/[^/]+\/([^/?#]*)/i.exec(String(url || "").trim());
  return m ? decodeURIComponent(m[1]) : "";
}

// A demo database has "demo" in its name. Both the server (in demo mode) and
// the demo seed (which empties the database) refuse any other.
export function isDemoDatabase(url) {
  return /demo/i.test(dbNameOf(url));
}
