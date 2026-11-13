// src/routes/fees/reports.routes.js
// Reports: class summary, defaulters, collections.
import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireRole } from "../../middleware/auth.js";
import { requireEntitlementRead } from "../../middleware/subscription.js";
import { exportCSV, exportXLSX } from "../../utils/export.js";
import { toInt, toNumber } from "../../utils/validate.js";
import { feesAudit, parseSchoolDateRange } from "./shared.js";

const router = Router();

/* --------------------
 * Reports (READ entitlement)
 * --------------------
 * - BURSAR should be able to view reports (read-only)
 */

router.get(
  "/reports/class-summary",
  requireRole("ADMIN", "BURSAR"),
  requireEntitlementRead("FEES_READ"),
  async (req, res) => {
    try {
      const { classId, year, term, export: exportType } = req.query;
      

      const y = toInt(year, null);
      if (!classId || !y || !term) {
        return res.status(400).json({ message: "classId, year, and term are required." });
      }

      const classRow = await prisma.class.findFirst({
        where: { id: String(classId), schoolId: req.schoolId },
        select: { id: true, name: true, stream: true, year: true },
      });
      if (!classRow) return res.status(400).json({ message: "Invalid classId" });

      const invoices = await prisma.feeInvoice.findMany({
        where: {
          schoolId: req.schoolId,
          classId: String(classId),
          year: y,
          term: String(term),
          status: { not: "VOID" },
        },
        select: { total: true, paid: true, balance: true, status: true },
      });

      
      

      const summary = invoices.reduce(
        (acc, inv) => {
          acc.totalBilled += Number(inv.total || 0);
          acc.totalPaid += Number(inv.paid || 0);
          acc.totalBalance += Number(inv.balance || 0);
          acc.invoiceCount += 1;
          acc.statusCounts[inv.status] = (acc.statusCounts[inv.status] || 0) + 1;
          return acc;
        },
        { totalBilled: 0, totalPaid: 0, totalBalance: 0, invoiceCount: 0, statusCounts: {} }
      );

      await feesAudit(req, {
  action: "REPORTS_FEES_CLASS_SUMMARY_VIEWED",
  targetType: "CLASS",
  targetId: classId,
  metadata: {
    classId: String(classId),
    year: y,
    term: String(term),
    export: exportType === "csv" || exportType === "xlsx" ? exportType : null,
    invoiceCount: summary.invoiceCount,
    totalBilled: summary.totalBilled,
    totalPaid: summary.totalPaid,
    totalBalance: summary.totalBalance,
  },
});


      // ✅ EXPORT MODE
      if (exportType === "csv" || exportType === "xlsx") {
        const rows = [
          {
            classId: classRow.id,
            className: classRow.name,
            stream: classRow.stream || "",
            classYear: classRow.year,
            term: String(term),
            year: y,
            invoiceCount: summary.invoiceCount,
            totalBilled: summary.totalBilled,
            totalPaid: summary.totalPaid,
            totalBalance: summary.totalBalance,
            issued: summary.statusCounts.ISSUED || 0,
            partiallyPaid: summary.statusCounts.PARTIALLY_PAID || 0,
            paid: summary.statusCounts.PAID || 0,
          },
        ];

        const fileBase = `fees-class-summary-${classRow.name}-${String(term)}-${y}`.replace(/\s+/g, "-").toLowerCase();

        if (exportType === "csv") {
          return exportCSV(res, fileBase, rows);
        }

        return exportXLSX(
          res,
          fileBase,
          "Class Summary",
          [
            { header: "Class ID", key: "classId", width: 18 },
            { header: "Class", key: "className", width: 18 },
            { header: "Stream", key: "stream", width: 10 },
            { header: "Class Year", key: "classYear", width: 10 },
            { header: "Term", key: "term", width: 10 },
            { header: "Year", key: "year", width: 10 },
            { header: "Invoice Count", key: "invoiceCount", width: 14 },
            { header: "Total Billed", key: "totalBilled", width: 14 },
            { header: "Total Paid", key: "totalPaid", width: 14 },
            { header: "Total Balance", key: "totalBalance", width: 14 },
            { header: "ISSUED", key: "issued", width: 10 },
            { header: "PARTIALLY_PAID", key: "partiallyPaid", width: 16 },
            { header: "PAID", key: "paid", width: 10 },
          ],
          rows
        );
      }

      // ✅ NORMAL JSON
      return res.json({
        classId: String(classId),
        year: y,
        term: String(term),
        ...summary,
      });
    } catch (err) {
      console.error("CLASS SUMMARY REPORT ERROR:", err);
      return res.status(500).json({ message: "Server error" });
    }
  }
);


router.get(
  "/reports/defaulters",
  requireRole("ADMIN", "BURSAR"),
  requireEntitlementRead("FEES_READ"),
  async (req, res) => {
    try {
      const { classId, year, term, minBalance = 1, limit = 50, export: exportType } = req.query;

      const y = toInt(year, null);
      const minB = toNumber(minBalance, 1);
      const lim = Math.min(Math.max(toInt(limit, 50), 1), 500);

      if (!classId || !y || !term) {
        return res.status(400).json({ message: "classId, year, and term are required." });
      }

      const classRow = await prisma.class.findFirst({
        where: { id: String(classId), schoolId: req.schoolId },
        select: { id: true, name: true, stream: true, year: true },
      });
      if (!classRow) return res.status(400).json({ message: "Invalid classId" });

      const invoices = await prisma.feeInvoice.findMany({
        where: {
          schoolId: req.schoolId,
          classId: String(classId),
          year: y,
          term: String(term),
          balance: { gt: Number(minB) },
          status: { not: "VOID" },
        },
        orderBy: { balance: "desc" },
        take: lim,
        select: {
          id: true,
          studentId: true,
          total: true,
          paid: true,
          balance: true,
          status: true,
          createdAt: true,
        },
      });

      const studentIds = [...new Set(invoices.map((i) => i.studentId))];

      const students = await prisma.student.findMany({
        where: { id: { in: studentIds }, schoolId: req.schoolId },
        select: { id: true, admissionNo: true, firstName: true, lastName: true },
      });

      const studentMap = new Map(students.map((s) => [s.id, s]));

      const rows = invoices.map((inv) => {
        const st = studentMap.get(inv.studentId);
        return {
          invoiceId: inv.id,
          admissionNo: st?.admissionNo || "",
          studentName: `${st?.firstName || ""} ${st?.lastName || ""}`.trim(),
          total: inv.total,
          paid: inv.paid,
          balance: inv.balance,
          status: inv.status,
          createdAt: inv.createdAt,
        };
      });

      await feesAudit(req, {
  action: "REPORTS_FEES_DEFAULTERS_VIEWED",
  targetType: "CLASS",
  targetId: classId,
  metadata: {
    classId: String(classId),
    year: y,
    term: String(term),
    minBalance: Number(minB),
    limit: lim,
    export: exportType === "csv" || exportType === "xlsx" ? exportType : null,
    resultCount: rows.length,
  },
});


      // ✅ EXPORT MODE
      if (exportType === "csv") {
        const fileBase = `fees-defaulters-${classRow.name}-${String(term)}-${y}`.replace(/\s+/g, "-").toLowerCase();
        return exportCSV(res, fileBase, rows);
      }

      if (exportType === "xlsx") {
        const fileBase = `fees-defaulters-${classRow.name}-${String(term)}-${y}`.replace(/\s+/g, "-").toLowerCase();
        return exportXLSX(
          res,
          fileBase,
          "Defaulters",
          [
            { header: "Invoice ID", key: "invoiceId", width: 18 },
            { header: "Admission No", key: "admissionNo", width: 14 },
            { header: "Student Name", key: "studentName", width: 22 },
            { header: "Total", key: "total", width: 12 },
            { header: "Paid", key: "paid", width: 12 },
            { header: "Balance", key: "balance", width: 12 },
            { header: "Status", key: "status", width: 14 },
            { header: "Created At", key: "createdAt", width: 20 },
          ],
          rows
        );
      }

      // ✅ NORMAL JSON
      return res.json({
        classId: String(classId),
        year: y,
        term: String(term),
        minBalance: Number(minB),
        count: rows.length,
        rows: rows.map((r) => ({
          invoiceId: r.invoiceId,
          student: {
            admissionNo: r.admissionNo,
            name: r.studentName,
          },
          total: r.total,
          paid: r.paid,
          balance: r.balance,
          status: r.status,
          createdAt: r.createdAt,
        })),
      });
    } catch (err) {
      console.error("DEFAULTERS REPORT ERROR:", err);
      return res.status(500).json({ message: "Server error" });
    }
  }
);


router.get(
  "/reports/collections",
  requireRole("ADMIN", "BURSAR"),
  requireEntitlementRead("FEES_READ"),
  async (req, res) => {
    try {
      const { from, to, export: exportType } = req.query;
      const { fromDate, toDate } = await parseSchoolDateRange(req.schoolId, from, to);

      const payments = await prisma.feePayment.findMany({
        where: {
          schoolId: req.schoolId,
          receivedAt: { gte: fromDate, lte: toDate },
          isReversed: false,
        },
        orderBy: { receivedAt: "desc" },
      });

      const rows = payments.map((p) => ({
        receiptNo: p.receiptNo,
        amount: p.amount,
        method: p.method,
        reference: p.reference,
        receivedAt: p.receivedAt,
      }));

      await feesAudit(req, {
  action: "REPORTS_FEES_COLLECTIONS_VIEWED",
  targetType: "FEES_REPORT",
  targetId: `${from}:${to}`,
  metadata: {
    from,
    to,
    export: exportType === "csv" || exportType === "xlsx" ? exportType : null,
    rows: rows.length,
  },
});


      // 🔹 EXPORT MODE
      if (exportType === "csv") {
        return exportCSV(res, "fees-collections", rows);
      }

      if (exportType === "xlsx") {
        return exportXLSX(
          res,
          "fees-collections",
          "Collections",
          [
            { header: "Receipt No", key: "receiptNo", width: 20 },
            { header: "Amount", key: "amount", width: 12 },
            { header: "Method", key: "method", width: 12 },
            { header: "Reference", key: "reference", width: 20 },
            { header: "Date", key: "receivedAt", width: 20 },
          ],
          rows
        );
      }

      // 🔹 NORMAL JSON RESPONSE
      const totals = payments.reduce(
        (acc, p) => {
          acc.totalCollected += Number(p.amount || 0);
          acc.byMethod[p.method] = (acc.byMethod[p.method] || 0) + p.amount;
          return acc;
        },
        { totalCollected: 0, byMethod: {} }
      );

      return res.json({ from, to, ...totals, payments });
    } catch (err) {
      if (err?.status) return res.status(err.status).json({ message: err.message });
      console.error("COLLECTIONS EXPORT ERROR:", err);
      return res.status(500).json({ message: "Server error" });
    }
  }
);

export default router;
