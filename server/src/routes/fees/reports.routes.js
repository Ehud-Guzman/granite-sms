// src/routes/fees/reports.routes.js
// Reports: class summary, defaulters, collections.
import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireRole } from "../../middleware/auth.js";
import { requireEntitlementRead } from "../../middleware/subscription.js";
import { exportCSV, exportXLSX } from "../../utils/export.js";
import { toInt, toNumber } from "../../utils/validate.js";
import { feesAudit, parseSchoolDateRange } from "./shared.js";
import { getSchoolCalendar } from "../../utils/schoolTime.js";
import { localDaySql, utcSql } from "../../utils/sqlTime.js";

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
      if (!y || !term) return res.status(400).json({ message: "year and term are required." });

      // One class, or the whole school (no classId) with a line per class.
      let classRow = null;
      if (classId) {
        classRow = await prisma.class.findFirst({
          where: { id: String(classId), schoolId: req.schoolId },
          select: { id: true, name: true, stream: true, year: true },
        });
        if (!classRow) return res.status(400).json({ message: "Invalid classId" });
      }

      // Summed in Postgres by class and status (audit 2, A2-PERF-03: this used
      // to load every invoice of the term and add them up here).
      const invoiceWhere = {
        schoolId: req.schoolId,
        ...(classRow ? { classId: classRow.id } : {}),
        year: y,
        term: String(term),
        status: { not: "VOID" },
      };
      const [groups, schoolClasses] = await Promise.all([
        prisma.feeInvoice.groupBy({
          by: ["classId", "status"],
          where: invoiceWhere,
          _sum: { total: true, paid: true, balance: true },
          _count: { _all: true },
        }),
        prisma.class.findMany({
          where: { schoolId: req.schoolId, ...(classRow ? { id: classRow.id } : {}) },
          select: { id: true, name: true, stream: true, year: true },
        }),
      ]);

      const empty = () => ({ totalBilled: 0, totalPaid: 0, totalBalance: 0, invoiceCount: 0, statusCounts: {} });
      const add = (acc, g) => {
        acc.totalBilled += Number(g._sum.total || 0);
        acc.totalPaid += Number(g._sum.paid || 0);
        acc.totalBalance += Number(g._sum.balance || 0);
        acc.invoiceCount += g._count._all;
        acc.statusCounts[g.status] = (acc.statusCounts[g.status] || 0) + g._count._all;
        return acc;
      };
      const summary = groups.reduce(add, empty());

      const perClass = new Map();
      for (const g of groups) perClass.set(g.classId, add(perClass.get(g.classId) || empty(), g));
      const classRows = schoolClasses.filter((c) => perClass.has(c.id));
      const byClass = classRows
        .map((c) => {
          const x = perClass.get(c.id);
          return {
            classId: c.id,
            className: c.name,
            stream: c.stream || "",
            classYear: c.year,
            ...x,
            collectionPct: x.totalBilled ? Number(((x.totalPaid / x.totalBilled) * 100).toFixed(1)) : 0,
          };
        })
        .sort((a, b) => a.className.localeCompare(b.className, undefined, { numeric: true }) || a.stream.localeCompare(b.stream));

      await feesAudit(req, {
        action: "REPORTS_FEES_CLASS_SUMMARY_VIEWED",
        targetType: classRow ? "CLASS" : "SCHOOL",
        targetId: classRow ? classRow.id : req.schoolId,
        metadata: {
          classId: classRow?.id || null,
          year: y,
          term: String(term),
          export: exportType === "csv" || exportType === "xlsx" ? exportType : null,
          invoiceCount: summary.invoiceCount,
          totalBilled: summary.totalBilled,
          totalPaid: summary.totalPaid,
          totalBalance: summary.totalBalance,
        },
      });

      if (exportType === "csv" || exportType === "xlsx") {
        const rows = byClass.map((c) => ({
          classId: c.classId,
          className: c.className,
          stream: c.stream,
          classYear: c.classYear,
          term: String(term),
          year: y,
          invoiceCount: c.invoiceCount,
          totalBilled: c.totalBilled,
          totalPaid: c.totalPaid,
          totalBalance: c.totalBalance,
          collectionPct: c.collectionPct,
          issued: c.statusCounts.ISSUED || 0,
          partiallyPaid: c.statusCounts.PARTIALLY_PAID || 0,
          paid: c.statusCounts.PAID || 0,
        }));
        const fileBase = `fees-summary-${classRow ? classRow.name : "all-classes"}-${String(term)}-${y}`.replace(/\s+/g, "-").toLowerCase();
        if (exportType === "csv") return exportCSV(res, fileBase, rows);
        return exportXLSX(
          res,
          fileBase,
          "Fees Summary",
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
            { header: "Collected %", key: "collectionPct", width: 12 },
            { header: "ISSUED", key: "issued", width: 10 },
            { header: "PARTIALLY_PAID", key: "partiallyPaid", width: 16 },
            { header: "PAID", key: "paid", width: 10 },
          ],
          rows
        );
      }

      return res.json({
        classId: classRow?.id || null,
        year: y,
        term: String(term),
        ...summary,
        byClass,
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

      if (!y || !term) {
        return res.status(400).json({ message: "year and term are required." });
      }

      // One class, or the whole school when no classId is given.
      let classRow = null;
      if (classId) {
        classRow = await prisma.class.findFirst({
          where: { id: String(classId), schoolId: req.schoolId },
          select: { id: true, name: true, stream: true, year: true },
        });
        if (!classRow) return res.status(400).json({ message: "Invalid classId" });
      }

      const where = {
        schoolId: req.schoolId,
        ...(classRow ? { classId: classRow.id } : {}),
        year: y,
        term: String(term),
        balance: { gt: Number(minB) },
        status: { not: "VOID" },
      };
      const [invoices, overall] = await Promise.all([
        prisma.feeInvoice.findMany({
          where,
          orderBy: { balance: "desc" },
          take: lim,
          select: {
            id: true,
            studentId: true,
            classId: true,
            total: true,
            paid: true,
            balance: true,
            status: true,
            createdAt: true,
          },
        }),
        // Totals for everyone owing, not just the rows shown.
        prisma.feeInvoice.aggregate({ where, _sum: { balance: true }, _count: { _all: true } }),
      ]);
      const classIds = [...new Set(invoices.map((i) => i.classId))];
      const classNames = new Map(
        (classIds.length
          ? await prisma.class.findMany({ where: { schoolId: req.schoolId, id: { in: classIds } }, select: { id: true, name: true, stream: true } })
          : []
        ).map((c) => [c.id, `${c.name}${c.stream ? ` ${c.stream}` : ""}`])
      );

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
          className: classNames.get(inv.classId) || "",
          total: inv.total,
          paid: inv.paid,
          balance: inv.balance,
          status: inv.status,
          createdAt: inv.createdAt,
        };
      });

      await feesAudit(req, {
  action: "REPORTS_FEES_DEFAULTERS_VIEWED",
  targetType: classRow ? "CLASS" : "SCHOOL",
  targetId: classRow ? classRow.id : req.schoolId,
  metadata: {
    classId: classRow?.id || null,
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
        const fileBase = `fees-defaulters-${classRow ? classRow.name : "all-classes"}-${String(term)}-${y}`.replace(/\s+/g, "-").toLowerCase();
        return exportCSV(res, fileBase, rows);
      }

      if (exportType === "xlsx") {
        const fileBase = `fees-defaulters-${classRow ? classRow.name : "all-classes"}-${String(term)}-${y}`.replace(/\s+/g, "-").toLowerCase();
        return exportXLSX(
          res,
          fileBase,
          "Defaulters",
          [
            { header: "Invoice ID", key: "invoiceId", width: 18 },
            { header: "Admission No", key: "admissionNo", width: 14 },
            { header: "Student Name", key: "studentName", width: 22 },
            { header: "Class", key: "className", width: 16 },
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
        classId: classRow?.id || null,
        year: y,
        term: String(term),
        minBalance: Number(minB),
        count: rows.length,
        // Everyone owing at least minBalance, beyond the rows listed.
        totalCount: overall._count._all,
        totalOutstanding: Number(overall._sum.balance || 0),
        rows: rows.map((r) => ({
          invoiceId: r.invoiceId,
          student: {
            admissionNo: r.admissionNo,
            name: r.studentName,
          },
          className: r.className,
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


/**
 * GET /api/fees/reports/collections?from=YYYY-MM-DD&to=YYYY-MM-DD&page=1&pageSize=50
 * Money received between two local days. The JSON gives the totals, the
 * split by method and the amount per day for the whole range, all summed in
 * Postgres, plus one page of receipts, newest first (audit 2, A2-PERF-03:
 * this used to send every receipt in the range, about 1 MB a month at a
 * large school). `export=csv|xlsx` still downloads every receipt.
 */
router.get(
  "/reports/collections",
  requireRole("ADMIN", "BURSAR"),
  requireEntitlementRead("FEES_READ"),
  async (req, res) => {
    try {
      const { from, to, export: exportType } = req.query;
      const { fromDate, toDate } = await parseSchoolDateRange(req.schoolId, from, to);
      const where = {
        schoolId: req.schoolId,
        receivedAt: { gte: fromDate, lte: toDate },
        isReversed: false,
      };
      const newestFirst = [{ receivedAt: "desc" }, { id: "desc" }];
      const isExport = exportType === "csv" || exportType === "xlsx";
      const audit = (rows) =>
        feesAudit(req, {
          action: "REPORTS_FEES_COLLECTIONS_VIEWED",
          targetType: "FEES_REPORT",
          targetId: `${from}:${to}`,
          metadata: { from, to, export: isExport ? exportType : null, rows },
        });

      // 🔹 EXPORT MODE: every receipt in the range
      if (isExport) {
        const rows = await prisma.feePayment.findMany({
          where,
          orderBy: newestFirst,
          select: { receiptNo: true, amount: true, method: true, reference: true, receivedAt: true },
        });
        await audit(rows.length);
        if (exportType === "csv") return exportCSV(res, "fees-collections", rows);
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

      // 🔹 NORMAL JSON RESPONSE: figures for the whole range, one page of receipts
      const page = Math.max(toInt(req.query.page, 1) || 1, 1);
      const pageSize = Math.min(Math.max(toInt(req.query.pageSize, 50) || 50, 1), 200);
      const { timezone } = await getSchoolCalendar(req.schoolId);

      const [overall, methods, days, payments] = await Promise.all([
        prisma.feePayment.aggregate({ where, _sum: { amount: true }, _count: { _all: true } }),
        prisma.feePayment.groupBy({ by: ["method"], where, _sum: { amount: true } }),
        prisma.$queryRaw`
          SELECT ${localDaySql('"receivedAt"', timezone)} AS "date",
                 SUM("amount")::bigint AS "amount",
                 COUNT(*)::int AS "receipts"
          FROM "FeePayment"
          WHERE "schoolId" = ${req.schoolId}
            AND "isReversed" = false
            AND "receivedAt" >= ${utcSql(fromDate)}
            AND "receivedAt" <= ${utcSql(toDate)}
          GROUP BY 1
          ORDER BY 1`,
        prisma.feePayment.findMany({
          where,
          orderBy: newestFirst,
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: { id: true, receiptNo: true, amount: true, method: true, reference: true, receivedAt: true },
        }),
      ]);

      const count = overall._count._all;
      await audit(count);

      return res.json({
        from,
        to,
        totalCollected: Number(overall._sum.amount || 0),
        byMethod: Object.fromEntries(methods.map((m) => [m.method, Number(m._sum.amount || 0)])),
        // Days with money in, in the school's time zone ("YYYY-MM-DD").
        byDay: days.map((d) => ({ date: d.date, amount: Number(d.amount), receipts: d.receipts })),
        count,
        page,
        pageSize,
        payments,
      });
    } catch (err) {
      if (err?.status) return res.status(err.status).json({ message: err.message });
      console.error("COLLECTIONS EXPORT ERROR:", err);
      return res.status(500).json({ message: "Server error" });
    }
  }
);

export default router;
