// Audit 2, Phase 1: every-route sweeps (docs/AUDIT_PLAN.md section 2.1).
//
// Needs the demo school (Mwangaza) seeded into the test database, so it has
// every kind of record to aim at. Run it on its own, never alongside other
// test files (the "reads write nothing" check watches the whole database):
//
//   AUDIT2_SWEEP=1 TEST_DATABASE_URL=postgresql://audit:auditpass@127.0.0.1:55433/granite_audit2_demo_test \
//     npx vitest run tests/audit2/sweep.test.js
//
// It writes its findings to docs/audit-2/phase1-sweep.json and fails on any
// leak, any accepted request that should have been refused, and any 500.
import "./setup.js";
import { listRoutes, paramsOf } from "./routeMap.js";
import fs from "fs";
import path from "path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app, prisma, request, makeSchool, makeSystemAdmin, tokenFor } from "../helpers.js";

// Off unless asked for: a normal `npm test` skips this whole file.
const RUN = process.env.AUDIT2_SWEEP === "1";
const suite = describe.runIf(RUN);

const ROUTES = listRoutes(app);
const OUT = path.resolve(process.cwd(), "..", "docs", "audit-2", process.env.AUDIT2_OUT || "phase1-sweep.json");
const report = { generatedAt: new Date().toISOString(), routeCount: ROUTES.length, sections: {} };

const PUBLIC = [
  /^\/health/,
  /^\/favicon\.ico$/,
  /^\/api\/public\//,
  /^\/api\/auth\/(login|signup|demo-login)$/,
];
const isPublic = (p) => PUBLIC.some((re) => re.test(p));
const WRITE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Which record a route's :id means, by the path in front of it.
const ID_RULES = [
  [/\/attendance\/sessions\/:id/, "attendanceSession"],
  [/\/exams\/marksheets\/:id/, "markSheet"],
  [/\/exams\/sessions\/:id/, "examSession"],
  [/\/fees\/invoices\/:id/, "feeInvoice"],
  [/\/fees\/items\/:id/, "feeItem"],
  [/\/fees\/payments\/:id/, "feePayment"],
  [/\/fees\/plans\/:id/, "feePlan"],
  [/\/fees\/reversal-requests\/:id/, "feeReversalRequest"],
  [/\/grade-scales\/:id/, "gradeScale"],
  [/\/guardians\/:id/, "guardian"],
  [/\/mpesa\/transactions\/:id/, "mpesaTransaction"],
  [/\/notices\/:id/, "notice"],
  [/\/portal\/learners\/:id/, "student"],
  [/\/settings\/backup\/:id/, "backup"],
  [/\/settings\/export\/student\/:id/, "student"],
  [/\/students\/:id/, "student"],
  [/\/subjects\/:id/, "subject"],
  [/\/users\/:id/, "user"],
  [/\/classes\/:id/, "class"],
  [/\/assignments\/:id/, "teachingAssignment"],
  [/\/schools\/:id/, "school"],
];
const NAMED = { classId: "class", studentId: "student", linkId: "studentGuardian" };
const MISSING = "c0000000000000000000000000"; // well-formed id that matches nothing

function modelFor(p, param) {
  if (NAMED[param]) return NAMED[param];
  if (param !== "id") return null;
  const rule = ID_RULES.find(([re]) => re.test(p));
  return rule ? rule[1] : null;
}

function fill(p, ids) {
  let unresolved = false;
  const url = p.replace(/:([A-Za-z0-9_]+)/g, (_, name) => {
    const m = modelFor(p, name);
    const v = m && ids[m];
    if (!v) unresolved = true;
    return v || MISSING;
  });
  return { url, unresolved };
}

function send(method, url, { token, headers = {}, query = null, body = undefined } = {}) {
  let r = request(app)[method.toLowerCase()](url);
  if (token) r = r.set("Authorization", `Bearer ${token}`);
  for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
  if (query) r = r.query(query);
  if (body !== undefined && method !== "GET") r = r.send(body);
  return r;
}

const snippet = (res) => String(res.text || "").slice(0, 300);

// ---- Victim: the demo school, with one of every record ----
let V; // { schoolId, ids: {model: id}, users: {ROLE: user} }
let A; // attacker school from makeSchool()

async function loadVictim() {
  const school = await prisma.school.findFirst({ where: { name: { contains: "Mwangaza" } } });
  if (!school) throw new Error("Seed the demo school into the test DB first (see the header comment).");
  const w = { schoolId: school.id };
  const first = (model, extra = {}) => prisma[model].findFirst({ where: { ...w, ...extra }, select: { id: true } });
  const ids = { school: school.id };
  for (const m of [
    "attendanceSession", "markSheet", "feeInvoice", "feeItem", "feePayment", "feePlan",
    "feeReversalRequest", "gradeScale", "guardian", "mpesaTransaction", "notice", "backup",
    "student", "subject", "class", "teachingAssignment", "studentGuardian",
  ]) {
    ids[m] = (await first(m))?.id || null;
  }
  ids.examSession = (await first("examSession", { status: "PUBLISHED" }))?.id || null;
  const users = {};
  for (const role of ["ADMIN", "BURSAR", "TEACHER", "STUDENT", "PARENT"]) {
    users[role] = await prisma.user.findFirst({ where: { ...w, role, isActive: true } });
  }
  ids.user = users.ADMIN.id;
  return { schoolId: school.id, ids, users };
}

// Rows of every school-owned table, hashed per table, for one school.
const SCHOOL_TABLES = [
  "User", "Teacher", "Class", "Student", "SchoolSettings", "ClassTeacher", "Subject", "TeachingAssignment",
  "Guardian", "StudentGuardian", "MpesaConfig", "MpesaTransaction", "MpesaStkRequest", "SmsMessage", "Notice",
  "SchoolLogo", "TermDate", "Subscription", "FeeItem", "FeePlan", "FeeInvoice", "FeePayment",
  "FeePaymentAllocation", "DocumentCounter", "FeeReversalRequest", "AttendanceSession", "AttendanceRecord",
  "AttendanceEditLog", "ExamType", "ExamSession", "MarkSheet", "Mark", "GradeScale", "GradeBand",
  "ResultPublish", "StudentResult", "SubjectResult", "ReportCardComment", "ExamAuditLog", "AuditLog", "Backup",
];
async function schoolHash(schoolId) {
  const out = {};
  for (const t of SCHOOL_TABLES) {
    const [row] = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n, md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS h FROM "${t}" t WHERE t."schoolId" = $1`,
      schoolId
    );
    out[t] = `${row.n}:${row.h}`;
  }
  return out;
}

// Every reference whose target belongs to a different school than the row.
const LINKS = [
  ["Teacher", "userId", "User"], ["Student", "userId", "User"], ["Student", "classId", "Class"],
  ["Class", "gradeScaleId", "GradeScale"], ["SchoolSettings", "defaultGradeScaleId", "GradeScale"],
  ["ClassTeacher", "classId", "Class"], ["ClassTeacher", "teacherId", "Teacher"],
  ["TeachingAssignment", "teacherId", "Teacher"], ["TeachingAssignment", "classId", "Class"],
  ["TeachingAssignment", "subjectId", "Subject"], ["Guardian", "userId", "User"],
  ["StudentGuardian", "studentId", "Student"], ["StudentGuardian", "guardianId", "Guardian"],
  ["MpesaTransaction", "paymentId", "FeePayment"], ["MpesaTransaction", "studentId", "Student"],
  ["MpesaStkRequest", "studentId", "Student"], ["MpesaStkRequest", "requestedById", "User"],
  ["SmsMessage", "studentId", "Student"], ["SmsMessage", "guardianId", "Guardian"], ["SmsMessage", "createdById", "User"],
  ["Notice", "createdById", "User"], ["FeePlan", "classId", "Class"],
  ["FeeInvoice", "studentId", "Student"], ["FeeInvoice", "classId", "Class"],
  ["FeePayment", "studentId", "Student"], ["FeePayment", "invoiceId", "FeeInvoice"],
  ["FeePaymentAllocation", "paymentId", "FeePayment"], ["FeePaymentAllocation", "invoiceId", "FeeInvoice"],
  ["FeeReversalRequest", "paymentId", "FeePayment"],
  ["AttendanceSession", "classId", "Class"], ["AttendanceSession", "takenByUserId", "User"],
  ["AttendanceRecord", "sessionId", "AttendanceSession"], ["AttendanceRecord", "studentId", "Student"],
  ["AttendanceEditLog", "sessionId", "AttendanceSession"], ["AttendanceEditLog", "editedByUserId", "User"],
  ["ExamSession", "classId", "Class"], ["ExamSession", "examTypeId", "ExamType"],
  ["ExamSession", "createdByUserId", "User"], ["ExamSession", "publishedById", "User"],
  ["MarkSheet", "examSessionId", "ExamSession"], ["MarkSheet", "subjectId", "Subject"], ["MarkSheet", "teacherId", "Teacher"],
  ["Mark", "markSheetId", "MarkSheet"], ["Mark", "studentId", "Student"],
  ["GradeBand", "gradeScaleId", "GradeScale"],
  ["ResultPublish", "examSessionId", "ExamSession"], ["ResultPublish", "gradeScaleId", "GradeScale"],
  ["StudentResult", "resultPublishId", "ResultPublish"], ["StudentResult", "studentId", "Student"],
  ["SubjectResult", "studentResultId", "StudentResult"], ["SubjectResult", "subjectId", "Subject"],
  ["ReportCardComment", "studentId", "Student"], ["ReportCardComment", "updatedById", "User"],
];
async function crossSchoolLinks() {
  const found = [];
  for (const [t, col, ref] of LINKS) {
    const [row] = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM "${t}" t JOIN "${ref}" r ON r.id = t."${col}"
        WHERE r."schoolId" IS NOT NULL AND r."schoolId" <> t."schoolId"`
    );
    if (row.n) found.push({ link: `${t}.${col} -> ${ref}`, rows: row.n });
  }
  for (const [t, parent, col, ref] of [
    ["FeePlanItem", "FeePlan", "feePlanId", "FeeItem"],
    ["FeeInvoiceLine", "FeeInvoice", "invoiceId", "FeeItem"],
  ]) {
    const [row] = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM "${t}" t JOIN "${parent}" p ON p.id = t."${col}" JOIN "${ref}" r ON r.id = t."feeItemId"
        WHERE r."schoolId" <> p."schoolId"`
    );
    if (row.n) found.push({ link: `${t}.feeItemId -> ${ref} (via ${parent})`, rows: row.n });
  }
  return found;
}

const LEAK = /mwangaza|MWA-\d/i;

beforeAll(async () => {
  if (!RUN) return;
  V = await loadVictim();
  A = await makeSchool();
  report.victim = { school: V.schoolId, missingRecords: Object.entries(V.ids).filter(([, v]) => !v).map(([k]) => k) };
  report.preexistingCrossSchoolLinks = await crossSchoolLinks();
}, 120_000);

afterAll(() => {
  if (!RUN) return;
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
});

// ---------------------------------------------------------------
suite("H1/H2: every protected route refuses bad sessions", () => {
  it("signed out: 401 everywhere except the public routes", async () => {
    const bad = [];
    for (const r of ROUTES) {
      if (isPublic(r.path)) continue;
      const { url } = fill(r.path, {});
      const res = await send(r.method, url, { body: {} });
      if (res.status !== 401) bad.push({ route: `${r.method} ${r.path}`, status: res.status, body: snippet(res) });
    }
    report.sections.signedOut = { checked: ROUTES.filter((r) => !isPublic(r.path)).length, problems: bad };
    expect.soft(bad).toEqual([]);
  }, 300_000);

  it("password change required (ADMIN and SYSTEM_ADMIN): nothing but /api/me and change-password works", async () => {
    const allowed = new Set(["GET /api/me", "POST /api/auth/change-password"]);
    const admin = await prisma.user.update({ where: { id: A.admin2.id }, data: { mustChangePassword: true } });
    const sys = await makeSystemAdmin();
    const sysFlag = await prisma.user.update({ where: { id: sys.id }, data: { mustChangePassword: true } });
    const ids = { student: A.students[0].id, class: A.klass.id, feeInvoice: A.invoice.id, feeItem: A.feeItem.id, feePlan: A.plan.id, user: A.teacher.id, school: A.school.id };
    const accepted = [];
    const otherCode = [];
    for (const [who, user, headers] of [["ADMIN", admin, {}], ["SYSTEM_ADMIN", sysFlag, { "x-school-id": A.school.id }]]) {
      const token = tokenFor(user);
      for (const r of ROUTES) {
        const key = `${r.method} ${r.path}`;
        if (isPublic(r.path) || allowed.has(key)) continue;
        const { url } = fill(r.path, ids);
        const res = await send(r.method, url, { token, headers, body: {} });
        if (res.status < 400 || res.status >= 500) accepted.push({ as: who, route: key, status: res.status, body: snippet(res) });
        else if (res.body?.code !== "PASSWORD_CHANGE_REQUIRED") otherCode.push({ as: who, route: key, status: res.status, code: res.body?.code || null });
      }
    }
    report.sections.passwordChangeRequired = { accepted, refusedWithOtherCode: otherCode };
    expect.soft(accepted).toEqual([]);
  }, 300_000);

  it("revoked session (tokenVersion bumped): 401 everywhere", async () => {
    const user = await prisma.user.findUnique({ where: { id: A.bursar.id } });
    const token = tokenFor(user); // tv = current version
    await prisma.user.update({ where: { id: user.id }, data: { tokenVersion: { increment: 1 } } });
    const ids = { student: A.students[0].id, class: A.klass.id, feeInvoice: A.invoice.id };
    const bad = [];
    for (const r of ROUTES) {
      if (isPublic(r.path)) continue;
      const { url } = fill(r.path, ids);
      const res = await send(r.method, url, { token, body: {} });
      if (res.status !== 401) bad.push({ route: `${r.method} ${r.path}`, status: res.status, body: snippet(res) });
    }
    report.sections.revokedSession = { problems: bad };
    expect.soft(bad).toEqual([]);
  }, 300_000);
});

// ---------------------------------------------------------------
suite("cross-school: another school's staff aimed at Mwangaza's records", () => {
  it("never leaks, never changes Mwangaza, never links records across schools", async () => {
    const before = await schoolHash(V.schoolId);
    const victimRefs = {
      studentId: V.ids.student, classId: V.ids.class, invoiceId: V.ids.feeInvoice, paymentId: V.ids.feePayment,
      examSessionId: V.ids.examSession, sessionId: V.ids.examSession, markSheetId: V.ids.markSheet,
      subjectId: V.ids.subject, feeItemId: V.ids.feeItem, feePlanId: V.ids.feePlan, planId: V.ids.feePlan,
      guardianId: V.ids.guardian, userId: V.ids.user, gradeScaleId: V.ids.gradeScale, noticeId: V.ids.notice,
    };
    const body = { ...victimRefs, amount: 100, method: "CASH", reason: "audit probe", year: 2026, term: "TERM3", studentIds: [V.ids.student], classIds: [V.ids.class] };
    const leaks = [];
    const writesAccepted = [];
    const errors = [];
    const unresolved = new Set();
    const changedBy = [];
    let prev = before;
    for (const role of ["admin", "bursar", "teacher", "studentUser"]) {
      const token = tokenFor(A[role]);
      for (const r of ROUTES) {
        if (isPublic(r.path) || r.path.startsWith("/api/schools") || r.path.startsWith("/api/auth/")) continue;
        const hasParams = paramsOf(r.path).length > 0;
        const { url, unresolved: u } = fill(r.path, V.ids);
        if (u) unresolved.add(`${r.method} ${r.path}`);
        const tries = [];
        if (hasParams) tries.push({ query: null });
        if (r.method === "GET") tries.push({ query: victimRefs });
        else if (!hasParams) tries.push({ query: null }); // a write without ids in the path: ids go in the body
        for (const t of tries) {
          const res = await send(r.method, url, { token, query: t.query, body });
          const where = { as: role, route: `${r.method} ${r.path}`, query: !!t.query, status: res.status };
          if (LEAK.test(res.text || "")) leaks.push({ ...where, body: snippet(res) });
          if (res.status >= 500) errors.push({ ...where, body: snippet(res) });
          if (WRITE.has(r.method) && res.status < 300) writesAccepted.push({ ...where, body: snippet(res) });
        }
        const now = await schoolHash(V.schoolId);
        const diff = SCHOOL_TABLES.filter((t) => prev[t] !== now[t]);
        if (diff.length) changedBy.push({ as: role, route: `${r.method} ${r.path}`, tables: diff });
        prev = now;
      }
    }
    const after = await schoolHash(V.schoolId);
    const victimChanged = SCHOOL_TABLES.filter((t) => before[t] !== after[t]);
    const links = await crossSchoolLinks();
    report.sections.crossSchool = {
      leaks, victimTablesChanged: victimChanged, victimChangedBy: changedBy, crossSchoolLinksAfter: links,
      writesAcceptedForReview: writesAccepted, serverErrors: errors, routesWithoutVictimRecord: [...unresolved],
    };
    expect.soft(leaks).toEqual([]);
    expect.soft(victimChanged).toEqual([]);
    expect.soft(links).toEqual(report.preexistingCrossSchoolLinks);
  }, 7_200_000);
});

// ---------------------------------------------------------------
suite("M9: reading writes nothing", () => {
  it("no GET changes a row (Mwangaza staff, on their own records)", async () => {
    // Statement-level triggers on every table record which tables a request touched.
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS audit2_writes (tbl text, op text)`);
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION audit2_note() RETURNS trigger AS $$
      BEGIN INSERT INTO audit2_writes VALUES (TG_TABLE_NAME, TG_OP); RETURN NULL; END $$ LANGUAGE plpgsql`);
    const tables = await prisma.$queryRawUnsafe(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('audit2_writes', '_prisma_migrations')`
    );
    for (const { tablename } of tables) {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS audit2_t ON "${tablename}"`);
      await prisma.$executeRawUnsafe(
        `CREATE TRIGGER audit2_t AFTER INSERT OR UPDATE OR DELETE ON "${tablename}" FOR EACH STATEMENT EXECUTE FUNCTION audit2_note()`
      );
    }
    const writes = [];
    try {
      for (const role of ["ADMIN", "BURSAR", "TEACHER", "STUDENT", "PARENT"]) {
        const user = V.users[role];
        if (!user) continue;
        const token = tokenFor(user);
        for (const r of ROUTES) {
          if (r.method !== "GET" || isPublic(r.path) || r.path.startsWith("/api/schools")) continue;
          await prisma.$executeRawUnsafe(`DELETE FROM audit2_writes`);
          const { url } = fill(r.path, V.ids);
          const res = await send("GET", url, { token, query: { year: 2026, term: "TERM3", classId: V.ids.class, sessionId: V.ids.examSession } });
          // Some writes (audit rows) are not awaited by the handler; give them a moment to land.
          await new Promise((r) => setTimeout(r, 40));
          const rows = await prisma.$queryRawUnsafe(`SELECT tbl, op, count(*)::int AS n FROM audit2_writes GROUP BY 1, 2`);
          const touched = rows.filter((x) => x.tbl !== "audit2_writes");
          if (touched.length) writes.push({ as: role, route: `GET ${r.path}`, status: res.status, wrote: touched.map((x) => `${x.op} ${x.tbl}`) });
        }
      }
    } finally {
      for (const { tablename } of tables) await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS audit2_t ON "${tablename}"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS audit2_note() CASCADE`);
      await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS audit2_writes`);
    }
    const nonAudit = writes.filter((w) => w.wrote.some((x) => !/AuditLog$/.test(x)));
    report.sections.getWrites = { all: writes, beyondAuditLog: nonAudit };
    expect.soft(nonAudit).toEqual([]);
  }, 7_200_000);
});

// ---------------------------------------------------------------
suite("M1: bad input gets a 4xx, never a 500", () => {
  it("junk query strings and bodies on every route (Mwangaza admin and bursar)", async () => {
    const junkQuery = {
      page: "-1", pageSize: "abc", term: "TERM9", year: "notayear", status: ["A", "B"], from: "2026-13-45", to: "x",
      q: "%' OR 1=1 --", classId: ["a", "b"], studentId: "../..", sessionId: "{}", format: "exe", limit: "1e309",
    };
    const junkBodies = [
      { amount: "1e309", invoiceId: ["a"], studentId: { gt: "" }, classId: 7, term: "TERM9", year: "x", date: "not-a-date",
        name: "x".repeat(20_000), email: 5, items: "notarray", records: {}, marks: "x", role: "SYSTEM_ADMIN", isActive: "yes" },
      [],
      { amount: -500, studentIds: "all", records: [{ studentId: null, status: "MAYBE" }], marks: [{ studentId: 1, score: "lots" }] },
    ];
    const errors = [];
    for (const role of ["ADMIN", "BURSAR"]) {
      const token = tokenFor(V.users[role]);
      for (const r of ROUTES) {
        if (isPublic(r.path) || r.path.startsWith("/api/schools") || r.path.startsWith("/api/auth/")) continue;
        const { url } = fill(r.path, V.ids);
        const attempts = r.method === "GET" ? [{ query: junkQuery }] : junkBodies.map((b) => ({ body: b, query: junkQuery }));
        for (const t of attempts) {
          const res = await send(r.method, url, { token, query: t.query, body: t.body });
          if (res.status >= 500) {
            errors.push({ as: role, route: `${r.method} ${r.path}`, status: res.status, body: snippet(res), sent: t.body === undefined ? "query" : JSON.stringify(t.body).slice(0, 80) });
          }
        }
      }
    }
    report.sections.badInput = { serverErrors: errors };
    expect.soft(errors).toEqual([]);
  }, 7_200_000);
});

// ---------------------------------------------------------------
// Phase 2 (plan 3.2): who can reach what. Every route as every Mwangaza role,
// on Mwangaza's own records, least privileged first (writes may succeed).
suite("role matrix", () => {
  it("records allowed / denied for every route and role", async () => {
    const ROLES = ["PARENT", "STUDENT", "TEACHER", "BURSAR", "ADMIN", "SYSTEM_ADMIN"];
    const sys = await makeSystemAdmin();
    const matrix = [];
    for (const r of ROUTES) {
      if (isPublic(r.path)) continue;
      const row = { route: `${r.method} ${r.path}` };
      for (const role of ROLES) {
        const user = role === "SYSTEM_ADMIN" ? sys : V.users[role];
        if (!user) { row[role] = "n/a"; continue; }
        const headers = role === "SYSTEM_ADMIN" ? { "x-school-id": V.schoolId } : {};
        const { url } = fill(r.path, V.ids);
        const res = await send(r.method, url, { token: tokenFor(user), headers, body: {}, query: r.method === "GET" ? { year: 2026, term: "TERM3", classId: V.ids.class, sessionId: V.ids.examSession } : null });
        row[role] = res.status === 401 || res.status === 403 || res.status === 402 ? `no ${res.status}` : `yes ${res.status}`;
      }
      matrix.push(row);
    }
    report.sections.roleMatrix = matrix;
    const md = ["| Route | " + ROLES.join(" | ") + " |", "|---|" + ROLES.map(() => "---").join("|") + "|"]
      .concat(matrix.map((m) => `| \`${m.route}\` | ` + ROLES.map((k) => m[k]).join(" | ") + " |"));
    fs.writeFileSync(path.resolve(process.cwd(), "..", "docs", "audit-2", "role-matrix.md"), "# Role × route matrix (generated)\n\n`yes` = got past the access checks (any status but 401/402/403). `no` = refused.\n\n" + md.join("\n") + "\n");
  }, 7_200_000);
});
