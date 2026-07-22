import * as svc from "./reports.services.js";
import { exportCSV, exportXLSX } from "../../utils/export.js";

export async function getClassPerformanceReport(req, res) {
  try {
    const data = await svc.getClassPerformanceReport(req);
    const exportType = req.query?.export;

    if (exportType === "csv" || exportType === "xlsx") {
      const fileBase = `class-performance-${data.meta?.sessionId || "report"}`;
      const rows = (data.ranking || []).map((r) => ({
        admissionNo: r.admissionNo,
        name: r.name,
        total: r.total,
        average: r.average,
        grade: r.grade,
        position: r.position,
      }));

      if (exportType === "csv") return exportCSV(res, fileBase, rows);
      return exportXLSX(
        res,
        fileBase,
        "Class Performance",
        [
          { header: "Admission No", key: "admissionNo", width: 16 },
          { header: "Name", key: "name", width: 28 },
          { header: "Total", key: "total", width: 10 },
          { header: "Average", key: "average", width: 10 },
          { header: "Grade", key: "grade", width: 10 },
          { header: "Position", key: "position", width: 10 },
        ],
        rows
      );
    }

    return res.json({ data });
  } catch (err) {
    console.error("REPORTS ERROR:", err);
    return res.status(err?.statusCode || 400).json({ message: err?.message || "Server error" });
  }
}
