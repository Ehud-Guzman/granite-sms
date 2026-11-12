// src/routes/settings/academics.routes.js
// Academic year, current term, time zone, term labels and term dates.
import { Router } from "express";
import { Term } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { requireAuth } from "../../middleware/auth.js";
import { resolveSchoolScope } from "../../utils/roleScope.js";
import { clearSettingsCache } from "../../middleware/features.js";
import { logAudit, actorCtx } from "../../utils/audit.js";
import { isValidTimeZone, isDateString, invalidateSchoolCalendar } from "../../utils/schoolTime.js";

const router = Router();

const ALLOWED_KEYS = ["currentAcademicYear", "currentTerm", "timezone", "term1Label", "term2Label", "term3Label"];
const TERMS = Object.values(Term);

const SELECT = {
  id: true,
  schoolId: true,
  currentAcademicYear: true,
  currentTerm: true,
  timezone: true,
  term1Label: true,
  term2Label: true,
  term3Label: true,
  createdAt: true,
  updatedAt: true,
};

function isNullableString(v, max = 80) {
  if (v === null) return true;
  return typeof v === "string" && v.trim().length > 0 && v.trim().length <= max;
}

function isYearLike(v) {
  if (v === null) return true;
  if (typeof v !== "string") return false;
  return /^(\d{4})(\/\d{4})?$/.test(v.trim());
}

async function ensureSettings(schoolId) {
  return (
    (await prisma.schoolSettings.findUnique({ where: { schoolId }, select: SELECT })) ||
    prisma.schoolSettings.create({ data: { schoolId }, select: SELECT })
  );
}

const dateOut = (d) => d.toISOString().slice(0, 10);
const termDateOut = (t) => ({ id: t.id, year: t.year, term: t.term, startsOn: dateOut(t.startsOn), endsOn: dateOut(t.endsOn) });

router.get("/", requireAuth, async (req, res) => {
  try {
    const resolved = resolveSchoolScope(req, { allowPlatform: false });
    if (!resolved.ok) return res.status(resolved.code).json({ message: resolved.message });
    const settings = await ensureSettings(resolved.schoolId);
    const termDates = await prisma.termDate.findMany({
      where: { schoolId: resolved.schoolId },
      orderBy: [{ year: "desc" }, { startsOn: "asc" }],
    });
    return res.json({ academics: settings, termDates: termDates.map(termDateOut) });
  } catch (err) {
    console.error("GET ACADEMICS SETTINGS ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

router.patch("/", requireAuth, async (req, res) => {
  try {
    const resolved = resolveSchoolScope(req, { allowPlatform: false });
    if (!resolved.ok) return res.status(resolved.code).json({ message: resolved.message });
    const { schoolId } = resolved;
    const body = req.body || {};

    for (const key of Object.keys(body)) {
      if (!ALLOWED_KEYS.includes(key)) return res.status(400).json({ message: `Unknown field: ${key}` });
    }
    if ("currentAcademicYear" in body) {
      if (!isNullableString(body.currentAcademicYear, 20) || !isYearLike(body.currentAcademicYear)) {
        return res.status(400).json({ message: "currentAcademicYear must be like '2026' or '2025/2026' or null" });
      }
    }
    if ("currentTerm" in body && body.currentTerm !== null && !TERMS.includes(body.currentTerm)) {
      return res.status(400).json({ message: `currentTerm must be one of ${TERMS.join(", ")} or null` });
    }
    if ("timezone" in body && !isValidTimeZone(body.timezone)) {
      return res.status(400).json({ message: "timezone must be an IANA zone such as Africa/Nairobi" });
    }
    for (const k of ["term1Label", "term2Label", "term3Label"]) {
      if (k in body && !isNullableString(body[k], 40)) {
        return res.status(400).json({ message: `${k} must be string or null (max 40 chars)` });
      }
    }

    const existing = await ensureSettings(schoolId);
    const data = {};
    if ("currentAcademicYear" in body)
      data.currentAcademicYear = body.currentAcademicYear === null ? null : String(body.currentAcademicYear).trim();
    if ("currentTerm" in body) data.currentTerm = body.currentTerm;
    if ("timezone" in body) data.timezone = String(body.timezone);
    for (const k of ["term1Label", "term2Label", "term3Label"]) {
      if (k in body) data[k] = body[k] === null ? null : String(body[k]).trim();
    }

    const updated = await prisma.schoolSettings.update({ where: { id: existing.id }, data, select: SELECT });
    clearSettingsCache();
    invalidateSchoolCalendar(schoolId);

    await logAudit({
      req,
      ...actorCtx(req),
      schoolId,
      action: "ACADEMICS_SETTINGS_UPDATED",
      targetType: "SCHOOL_SETTINGS",
      targetId: updated.id,
      metadata: { updatedFields: Object.keys(body) },
    });
    return res.json({ academics: updated });
  } catch (err) {
    console.error("PATCH ACADEMICS SETTINGS ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

/**
 * PUT /api/settings/academics/term-dates
 * Body: { year: 2026, terms: [{ term: "TERM1", startsOn: "2026-01-05", endsOn: "2026-04-02" }, ...] }
 * Replaces that year's term dates. Terms must not overlap.
 */
router.put("/term-dates", requireAuth, async (req, res) => {
  try {
    const resolved = resolveSchoolScope(req, { allowPlatform: false });
    if (!resolved.ok) return res.status(resolved.code).json({ message: resolved.message });
    const { schoolId } = resolved;

    const year = Number(req.body?.year);
    const terms = Array.isArray(req.body?.terms) ? req.body.terms : null;
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return res.status(400).json({ message: "year must be a whole number between 2000 and 2100" });
    }
    if (!terms) return res.status(400).json({ message: "terms[] is required" });

    const seen = new Set();
    for (const t of terms) {
      if (!TERMS.includes(t?.term)) return res.status(400).json({ message: `term must be one of ${TERMS.join(", ")}` });
      if (seen.has(t.term)) return res.status(400).json({ message: `${t.term} appears twice` });
      seen.add(t.term);
      if (!isDateString(t.startsOn) || !isDateString(t.endsOn)) {
        return res.status(400).json({ message: `${t.term}: dates must be YYYY-MM-DD` });
      }
      if (t.startsOn > t.endsOn) return res.status(400).json({ message: `${t.term}: opening date is after closing date` });
    }
    const sorted = [...terms].sort((a, b) => a.startsOn.localeCompare(b.startsOn));
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].startsOn <= sorted[i - 1].endsOn) {
        return res.status(400).json({ message: `${sorted[i - 1].term} and ${sorted[i].term} overlap` });
      }
    }

    const saved = await prisma.$transaction(async (tx) => {
      await tx.termDate.deleteMany({ where: { schoolId, year } });
      if (terms.length) {
        await tx.termDate.createMany({
          data: terms.map((t) => ({
            schoolId,
            year,
            term: t.term,
            startsOn: new Date(`${t.startsOn}T00:00:00Z`),
            endsOn: new Date(`${t.endsOn}T00:00:00Z`),
          })),
        });
      }
      return tx.termDate.findMany({ where: { schoolId, year }, orderBy: { startsOn: "asc" } });
    });
    invalidateSchoolCalendar(schoolId);

    await logAudit({
      req,
      ...actorCtx(req),
      schoolId,
      action: "ACADEMICS_TERM_DATES_UPDATED",
      targetType: "SCHOOL_SETTINGS",
      targetId: schoolId,
      metadata: { year, terms },
    });
    return res.json({ termDates: saved.map(termDateOut) });
  } catch (err) {
    console.error("PUT TERM DATES ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

export default router;
