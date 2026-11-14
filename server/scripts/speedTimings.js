// scripts/speedTimings.js
// Times the slow endpoints from audit 2 (A2-PERF-01, A2-PERF-03) against a
// running server, and saves each response body so before/after can be
// compared. Read-only: it signs in through the demo's one-click sign-in.
//
// The server must run with DEMO_MODE=true and QUERY_STATS=1 (for the
// X-Query-Count and Server-Timing headers), on a database whose name has
// "demo" in it. Built for the large-school seed:
//   node prisma/seedDemo.js --confirm-write --reset
//   node scripts/audit2ScaleSeed.js --factor=7 --history=2 --schools=200
//
//   DATABASE_URL=... node scripts/speedTimings.js --base=http://127.0.0.1:5055 --out=../speed-before
//
// --runs=20 timed calls after --warm=3 warm-up calls. Prints p50/p95 server
// time (ms), size (KB) and SQL statements per call.
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
}
const BASE = arg("base", "http://127.0.0.1:5055");
const OUT = arg("out", "");
const RUNS = Number(arg("runs", 20));
const WARM = Number(arg("warm", 3));

if (!/audit/i.test(String(process.env.DATABASE_URL || ""))) {
  console.error('DATABASE_URL must point at an audit database (name containing "audit").');
  process.exit(1);
}

const prisma = new PrismaClient();

async function login(role) {
  const r = await fetch(`${BASE}/api/auth/demo-login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ role }),
  });
  if (!r.ok) throw new Error(`demo-login ${role}: ${r.status} ${await r.text()}`);
  return (await r.json()).token;
}

function pct(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

// Values that change on every call.
function stable(body) {
  return JSON.parse(JSON.stringify(body), (k, v) => (k === "computedAt" ? undefined : v));
}

async function call(token, url, retry = true) {
  const t0 = performance.now();
  let r;
  try {
    r = await fetch(`${BASE}${url}`, { headers: { authorization: `Bearer ${token}` } });
  } catch (e) {
    // A kept-alive socket the server has just closed: try once more.
    if (retry && e?.cause?.code === "ECONNRESET") return call(token, url, false);
    throw e;
  }
  const text = await r.text();
  const clientMs = performance.now() - t0;
  const timing = r.headers.get("server-timing") || "";
  const appMs = Number((/app;dur=([\d.]+)/.exec(timing) || [])[1]);
  return {
    status: r.status,
    ms: Number.isFinite(appMs) ? appMs : clientMs,
    bytes: Buffer.byteLength(text),
    queries: r.headers.get("x-query-count") ?? "?",
    text,
  };
}

async function main() {
  const school = await prisma.school.findFirst({ where: { code: "MWA" }, select: { id: true } });
  if (!school) throw new Error("No Mwangaza school: run the demo seed first.");
  const settings = await prisma.schoolSettings.findUnique({ where: { schoolId: school.id } });
  const year = parseInt(settings?.currentAcademicYear, 10) || new Date().getFullYear();
  const term = settings?.currentTerm || "TERM1";

  // The published exam session with the most marks (frozen copy or not).
  const sessions = await prisma.examSession.findMany({
    where: { schoolId: school.id, status: "PUBLISHED" },
    select: { id: true, _count: { select: { markSheets: true } } },
  });
  const marks = await prisma.mark.groupBy({
    by: ["markSheetId"],
    where: { schoolId: school.id, markSheet: { examSessionId: { in: sessions.map((s) => s.id) } } },
    _count: { _all: true },
  });
  const sheets = await prisma.markSheet.findMany({
    where: { id: { in: marks.map((m) => m.markSheetId) } },
    select: { id: true, examSessionId: true },
  });
  const perSession = new Map();
  const sheetSession = new Map(sheets.map((s) => [s.id, s.examSessionId]));
  for (const m of marks) {
    const sid = sheetSession.get(m.markSheetId);
    perSession.set(sid, (perSession.get(sid) || 0) + m._count._all);
  }
  const sessionId = arg("session", "") || [...perSession.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!sessionId) throw new Error("No published exam session.");

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: settings?.timezone || "Africa/Nairobi" }).format(new Date());
  const from = `${today.slice(0, 4)}-01-01`;

  const tokens = { ADMIN: await login("ADMIN"), BURSAR: await login("BURSAR"), TEACHER: await login("TEACHER") };

  const endpoints = [
    ["dashboard-admin", "ADMIN", "/api/dashboard/summary"],
    ["dashboard-bursar", "BURSAR", "/api/dashboard/summary"],
    ["dashboard-teacher", "TEACHER", "/api/dashboard/summary"],
    ["class-performance", "ADMIN", `/api/reports/class-performance?sessionId=${sessionId}`],
    ["fees-class-summary", "BURSAR", `/api/fees/reports/class-summary?year=${year}&term=${term}`],
    ["fees-collections", "BURSAR", `/api/fees/reports/collections?from=${from}&to=${today}`],
  ];
  const extra = arg("extra", "");
  if (extra) for (const u of extra.split(",")) endpoints.push([u.replace(/\W+/g, "-").slice(1, 60), "BURSAR", u]);

  if (OUT) fs.mkdirSync(OUT, { recursive: true });
  console.log(`school ${school.id} · year ${year} ${term} · session ${sessionId} · collections ${from}..${today}`);
  console.log("endpoint".padEnd(22), "p50".padStart(7), "p95".padStart(7), "KB".padStart(8), "SQL".padStart(5));

  for (const [name, role, url] of endpoints) {
    const token = tokens[role];
    let last;
    for (let i = 0; i < WARM; i++) last = await call(token, url);
    const times = [];
    for (let i = 0; i < RUNS; i++) {
      last = await call(token, url);
      times.push(last.ms);
    }
    times.sort((a, b) => a - b);
    console.log(
      name.padEnd(22),
      pct(times, 50).toFixed(0).padStart(7),
      pct(times, 95).toFixed(0).padStart(7),
      (last.bytes / 1024).toFixed(1).padStart(8),
      String(last.queries).padStart(5),
      last.status === 200 ? "" : `status ${last.status}`
    );
    if (OUT) {
      let body;
      try {
        body = stable(JSON.parse(last.text));
      } catch {
        body = last.text;
      }
      fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(body, null, 2));
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
