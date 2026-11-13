import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { requireAuth } from "../../middleware/auth.js";
import { resolveSchoolScope } from "../../utils/roleScope.js";
import { clearSettingsCache } from "../../middleware/features.js";
import { logAudit, actorCtx } from "../../utils/audit.js";
import { readStyle, resolveStyle } from "../../modules/print/reportStyle.js";
import { loadLetterhead, startPdf, drawReportCard, drawResultSlip, sampleReport, sampleSlip } from "../../modules/print/pdfDocs.js";

const router = Router();

async function getOrCreateSettings(schoolId) {
  let settings = await prisma.schoolSettings.findUnique({ where: { schoolId } });
  if (!settings) {
    settings = await prisma.schoolSettings.create({ data: { schoolId } });
  }
  return settings;
}

function cleanText(v, max = 500) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (s.length > max) return s.slice(0, max);
  return s;
}

// ✅ GET /api/settings/print
// Allow TEACHER/BURSAR to READ print settings for printing (letterhead/footer)
router.get("/", requireAuth, async (req, res) => {
  try {
    const resolved = resolveSchoolScope(req, {
      allowPlatform: false,
      // Learners and parents print their own slips and statements on the letterhead.
      allowRoles: ["SYSTEM_ADMIN", "ADMIN", "TEACHER", "BURSAR", "STUDENT", "PARENT"],
    });
    if (!resolved.ok)
      return res.status(resolved.code).json({ message: resolved.message });

    const { schoolId } = resolved;
    const s = await getOrCreateSettings(schoolId);

    return res.json({
      print: {
        schoolId,
        printShowLogo: s.printShowLogo,
        printHeaderText: s.printHeaderText,
        printFooterText: s.printFooterText,
        reportStyle: resolveStyle(s.reportStyle),
        updatedAt: s.updatedAt,
      },
    });
  } catch (err) {
    console.error("GET PRINT ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// ✅ PATCH /api/settings/print
// Restrict updates to ADMIN/SYSTEM_ADMIN only
router.patch("/", requireAuth, async (req, res) => {
  try {
    const resolved = resolveSchoolScope(req, {
      allowPlatform: false,
      allowRoles: ["SYSTEM_ADMIN", "ADMIN"],
    });
    if (!resolved.ok)
      return res.status(resolved.code).json({ message: resolved.message });

    const { schoolId } = resolved;
    const body = req.body || {};

    const allowed = ["printShowLogo", "printHeaderText", "printFooterText", "reportStyle"];
    for (const k of Object.keys(body)) {
      if (!allowed.includes(k))
        return res.status(400).json({ message: `Unknown field: ${k}` });
    }

    if ("printShowLogo" in body && typeof body.printShowLogo !== "boolean") {
      return res.status(400).json({ message: "printShowLogo must be boolean" });
    }

    let style;
    if ("reportStyle" in body && body.reportStyle !== null) {
      const r = readStyle(body.reportStyle);
      if (r.error) return res.status(400).json({ message: r.error });
      style = r.style;
    }

    const s = await getOrCreateSettings(schoolId);

    const data = {};
    // null puts the design back to the defaults.
    if ("reportStyle" in body) data.reportStyle = body.reportStyle === null ? Prisma.DbNull : style;
    if ("printShowLogo" in body) data.printShowLogo = body.printShowLogo;
    if ("printHeaderText" in body)
      data.printHeaderText = cleanText(body.printHeaderText, 800);
    if ("printFooterText" in body)
      data.printFooterText = cleanText(body.printFooterText, 800);

    const updated = await prisma.schoolSettings.update({
      where: { id: s.id },
      data,
    });

    clearSettingsCache();

    await logAudit({
      req,
      ...actorCtx(req),
      schoolId,
      action: "PRINT_SETTINGS_UPDATED",
      targetType: "SCHOOL_SETTINGS",
      targetId: updated.id,
      metadata: { updatedFields: Object.keys(data) },
    });

    return res.json({
      print: {
        schoolId,
        printShowLogo: updated.printShowLogo,
        printHeaderText: updated.printHeaderText,
        printFooterText: updated.printFooterText,
        reportStyle: resolveStyle(updated.reportStyle),
        updatedAt: updated.updatedAt,
      },
    });
  } catch (err) {
    console.error("PATCH PRINT ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

/**
 * POST /api/settings/print/preview  { kind: "report" | "slip", print?: { printShowLogo, printHeaderText, printFooterText, reportStyle } }
 * The design as it would print, on a made-up learner, without saving
 * anything: the settings screen shows it while the admin edits.
 */
router.post("/preview", requireAuth, async (req, res) => {
  try {
    const resolved = resolveSchoolScope(req, { allowPlatform: false, allowRoles: ["SYSTEM_ADMIN", "ADMIN"] });
    if (!resolved.ok) return res.status(resolved.code).json({ message: resolved.message });
    const kind = req.body?.kind === "slip" ? "slip" : "report";
    const p = req.body?.print || {};
    const override = {};
    if (typeof p.printShowLogo === "boolean") override.printShowLogo = p.printShowLogo;
    if ("printHeaderText" in p) override.printHeaderText = cleanText(p.printHeaderText, 800);
    if ("printFooterText" in p) override.printFooterText = cleanText(p.printFooterText, 800);
    if (p.reportStyle != null) {
      const r = readStyle(p.reportStyle);
      if (r.error) return res.status(400).json({ message: r.error });
      override.reportStyle = r.style;
    }
    const lh = await loadLetterhead(resolved.schoolId, override);
    const doc = startPdf(res, `preview-${kind}.pdf`, { inline: true });
    if (kind === "slip") drawResultSlip(doc, lh, sampleSlip());
    else {
      const { report, extras } = sampleReport();
      drawReportCard(doc, lh, report, extras);
    }
    doc.end();
  } catch (err) {
    console.error("PRINT PREVIEW ERROR:", err);
    if (!res.headersSent) res.status(500).json({ message: "Server error" });
  }
});

export default router;
