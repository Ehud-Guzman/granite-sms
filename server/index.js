
import path from "path";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { fileURLToPath } from "url";

import { prisma } from "./src/lib/prisma.js";

import authRoutes from "./src/routes/auth.js";

// Core modules
import studentRoutes from "./src/routes/students.js";
import classRoutes from "./src/routes/classes.js";
import teacherRoutes from "./src/routes/teachers.js";
import settingsRoutes from "./src/routes/settings.js";
import subjectRoutes from "./src/routes/subjects.js";
import assignmentRoutes from "./src/routes/assignments.js";
import classTeacherRoutes from "./src/routes/classTeachers.js";

// Feature modules
import attendanceRoutes from "./src/modules/attendance/attendance.routes.js";
import examsRoutes from "./src/modules/exams/exams.routes.js";
import feesRoutes from "./src/routes/fees.js";
import reportsRoutes from "./src/modules/reports/reports.routes.js";
import dashboardRoutes from "./src/modules/dashboard/dashboard.routes.js";

// Platform control plane (SYSTEM_ADMIN)
import schoolsRoutes from "./src/routes/schools.js";
import usersRoutes from "./src/routes/users.js";

import { requireAuth } from "./src/middleware/auth.js";
import { tenantContext } from "./src/middleware/tenant.js";
import { assertJwtSecretStrong } from "./src/utils/jwt.js";

dotenv.config();

// Fail loud at boot if the signing secret is missing/weak (auth bypass otherwise).
assertJwtSecretStrong();

const app = express();
const PORT = process.env.PORT || 5000;

/** ✅ Correct project root: go UP one level from server/ folder */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");

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

// ---- Rate limiting ----
// Global safety net across the API.
const globalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 300, // per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests. Please slow down.", code: "RATE_LIMITED" },
});

// Tighter limiter for auth endpoints (credential stuffing / brute force).
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many auth attempts. Try again later.", code: "AUTH_RATE_LIMITED" },
});

app.use("/api", globalLimiter);

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
app.use("/api/auth", authLimiter, authRoutes);

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
app.use("/api", requireAuth, tenantContext);

// Core
app.use("/api/students", studentRoutes);
app.use("/api/classes", classRoutes);
app.use("/api/teachers", teacherRoutes);
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

    return res.json({
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
app.use((err, req, res, next) => {
  console.error("GLOBAL ERROR:", err);

  if (err?.message?.includes("CORS")) {
    return res.status(403).json({ message: "Blocked by CORS" });
  }

  return res.status(500).json({ message: "Server error" });
});

// ---- Start ----
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});