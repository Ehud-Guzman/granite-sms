import * as svc from "./reports.services.js";

export async function getClassPerformanceReport(req, res) {
  try {
    const data = await svc.getClassPerformanceReport(req);
    return res.json({ data });
  } catch (err) {
    console.error("REPORTS ERROR:", err);
    return res.status(400).json({ message: err?.message || "Server error" });
  }
}
