// src/app.js
// Builds the Express app (middleware + routes) without starting a server,
// so tests can import it. index.js loads env, runs boot checks and listens.

import path from "path";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { fileURLToPath } from "url";

import { prisma } from "./lib/prisma.js";
import { getSchoolCalendar } from "./utils/schoolTime.js";

import authRoutes from "./routes/auth.js";

// Core modules
import studentRoutes from "./routes/students.js";
import classRoutes from "./routes/classes.js";
import settingsRoutes from "./routes/settings.js";
import subjectRoutes from "./routes/subjects.js";
import assignmentRoutes from "./routes/assignments.js";
import classTeacherRoutes from "./routes/classTeachers.js";

// Feature modules
import attendanceRoutes from "./modules/attendance/attendance.routes.js";
import examsRoutes from "./modules/exams/exams.routes.js";
import feesRoutes from "./routes/fees.js";
import reportsRoutes from "./modules/reports/reports.routes.js";
import dashboardRoutes from "./modules/dashboard/dashboard.routes.js";

// Platform control plane (SYSTEM_ADMIN)
import schoolsRoutes from "./routes/schools.js";
import usersRoutes from "./routes/users.js";

import { requireAuth } from "./middleware/auth.js";
import { tenantContext } from "./middleware/tenant.js";
import { demoGuard } from "./middleware/demoGuard.js";
import { ipLimiter, userLimiter, loginPerAccountLimiter, loginPerIpLimiter } from "./middleware/rateLimits.js";


const app = express();

/** Project root: two levels up from server/src */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

// If you're behind a proxy (Render, Nginx, etc.)
app.set("trust proxy", 1);

// ---- Allowed origins (single source of truth for both API CORS and /uploads) ----
const envOrigins = String(process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const allowedOrigins = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  ...envOrigins,
]);

// ---- Security headers ----
// crossOriginResourcePolicy relaxed so uploaded assets (branding logos) can be
// fetched cross-origin by the real frontend domain, not just same-origin.
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

/** ✅ Serve uploads with CORS headers matching the real allowlist (not a hardcoded localhost origin) */
const uploadsPath = path.join(PROJECT_ROOT, "uploads");
console.log("Serving static /uploads from:", uploadsPath);

app.use("/uploads", (req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
  }
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
}, express.static(uploadsPath));

// ---- CORS for API routes ----
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (allowedOrigins.has(origin)) return cb(null, true);
      return cb(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

app.use(express.json({ limit: "1mb" }));

// ---- Rate limiting (see middleware/rateLimits.js) ----
app.use("/api", ipLimiter);
// Only credential-checking routes get the sign-in limiters; changing a
// password or switching school is not a guessing target.
app.post(["/api/auth/login", "/api/auth/signup", "/api/auth/demo-login"], loginPerIpLimiter, loginPerAccountLimiter);

// A demo deployment refuses every write (config/demo.js). Mounted before all
// routes so nothing below can be reached by a write. No-op when DEMO_MODE is off.
app.use("/api", demoGuard);

// ---- Dev request logger ----
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - start;
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} - ${ms}ms`);
  });
  next();
});

// ---- Health ----
app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "School API running" });
});

app.get("/favicon.ico", (req, res) => res.status(204).end());

app.disable("etag");

// ===============================
// PUBLIC ROUTES
// ===============================
app.use("/api/auth", authRoutes);

// ===============================
// PLATFORM ROUTES (SYSTEM_ADMIN)
// ===============================
app.use("/api/schools", requireAuth, schoolsRoutes);

// Users routes handle their own middleware so SYSTEM_ADMIN platform-mode can work.
app.use("/api/users", usersRoutes);

// ===============================
// TENANT ROUTES (everything else)
// requireAuth + tenantContext
// ===============================
app.use("/api", requireAuth, tenantContext, userLimiter);

// Core
app.use("/api/students", studentRoutes);
app.use("/api/classes", classRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/subjects", subjectRoutes);
app.use("/api/assignments", assignmentRoutes);
app.use("/api/class-teachers", classTeacherRoutes);

// Features
app.use("/api/attendance", attendanceRoutes);
app.use("/api/exams", examsRoutes);
app.use("/api/fees", feesRoutes);

app.use("/api/reports", reportsRoutes);
app.use("/api/dashboard", dashboardRoutes);

// ===============================
// SINGLE SOURCE OF TRUTH: /api/me
// ===============================
app.get("/api/me", async (req, res) => {
  try {
    const base = req.user;
    if (!base?.id) return res.status(401).json({ message: "Unauthorized" });

    const schoolRow = req.schoolId
      ? await prisma.school.findUnique({
          where: { id: req.schoolId },
          select: { id: true, name: true },
        })
      : null;

    let teacherRow = null;
    if (base.teacherId) {
      teacherRow = await prisma.teacher.findUnique({
        where: { id: base.teacherId },
        select: { id: true, firstName: true, lastName: true },
      });
    }

    let studentRow = null;
    if (base.studentId) {
      studentRow = await prisma.student.findUnique({
        where: { id: base.studentId },
        select: { id: true, firstName: true, lastName: true, admissionNo: true },
      });
    }

    // The school calendar, so every screen can default to the current term
    // and to "today" in the school's time zone.
    let calendar = null;
    if (req.schoolId) {
      const c = await getSchoolCalendar(req.schoolId);
      const current = c.termDates.find((t) => t.year === c.currentYear && t.term === c.currentTerm);
      calendar = {
        timezone: c.timezone,
        today: c.today,
        currentYear: c.currentYear,
        currentTerm: c.currentTerm,
        termLabels: c.termLabels,
        currentTermDates: current
          ? { startsOn: current.startsOn.toISOString().slice(0, 10), endsOn: current.endsOn.toISOString().slice(0, 10) }
          : null,
      };
    }

    return res.json({
      calendar,
      user: {
        ...base,
        role: req.role,
        email: req.userEmail,
        schoolId: req.schoolId,
        school: schoolRow,
        teacher: teacherRow
          ? {
              id: teacherRow.id,
              name: `${teacherRow.firstName} ${teacherRow.lastName}`.trim(),
            }
          : null,
        student: studentRow
          ? {
              id: studentRow.id,
              name: `${studentRow.firstName} ${studentRow.lastName}`.trim(),
              admissionNo: studentRow.admissionNo,
            }
          : null,
      },
    });
  } catch (err) {
    console.error("ME ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// ---- 404 ----
app.use((req, res) => {
  res.status(404).json({
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

// ---- Global error handler ----
// Client mistakes get a 4xx with a usable message; only real faults are 500.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err?.message?.includes("CORS")) {
    return res.status(403).json({ message: "Blocked by CORS" });
  }
  // body-parser
  if (err?.type === "entity.too.large") {
    return res.status(413).json({ message: "Request is too large.", code: "PAYLOAD_TOO_LARGE" });
  }
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ message: "Request body is not valid JSON.", code: "BAD_JSON" });
  }
  // Prisma rejected a value (wrong type, unknown enum value, ...)
  if (err?.name === "PrismaClientValidationError") {
    return res.status(400).json({ message: "Some of the values sent are not valid.", code: "INVALID_INPUT" });
  }
  // Errors thrown on purpose with a status (e.g. Object.assign(new Error(..), { status: 400 }))
  const status = Number(err?.status || err?.statusCode);
  if (status >= 400 && status < 500) {
    return res.status(status).json({ message: err.message || "Bad request" });
  }

  console.error("GLOBAL ERROR:", err);
  return res.status(500).json({ message: "Server error" });
});

export default app;
