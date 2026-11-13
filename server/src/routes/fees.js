// src/routes/fees.js
// /api/fees: the shared checks run first, then each part, mounted in the
// order the routes used to be declared so matching is unchanged.
import { Router } from "express";
import { Term, InvoiceStatus } from "@prisma/client";

import { requireTenant } from "../middleware/tenant.js";
import { loadSubscription } from "../middleware/subscription.js";
import setupRoutes from "./fees/setup.routes.js";
import invoicesRoutes from "./fees/invoices.routes.js";
import statementsRoutes from "./fees/statements.routes.js";
import paymentsRoutes from "./fees/payments.routes.js";
import reversalsRoutes from "./fees/reversals.routes.js";
import receiptsRoutes from "./fees/receipts.routes.js";
import reportsRoutes from "./fees/reports.routes.js";

const router = Router();

/**
 * Assumptions:
 * - requireAuth + tenantContext already ran before hitting /api/fees
 * - requireTenant enforces tenant presence (req.schoolId)
 */
router.use(requireTenant);
router.use(loadSubscription);

/**
 * Rejects bad term / status / year values up front with a 400. Before this,
 * e.g. ?term=BOGUS reached Prisma as an invalid enum and came back as a 500.
 */
const TERMS = Object.values(Term);
const INVOICE_STATUSES = Object.values(InvoiceStatus);
router.use((req, res, next) => {
  const sources = [req.query || {}, req.body && typeof req.body === "object" ? req.body : {}];
  for (const src of sources) {
    if (src.term !== undefined && src.term !== "" && !TERMS.includes(String(src.term))) {
      return res.status(400).json({ message: `term must be one of: ${TERMS.join(", ")}.` });
    }
    if (src.year !== undefined && src.year !== "") {
      const y = Number(src.year);
      if (!Number.isInteger(y) || y < 2000 || y > 2100) {
        return res.status(400).json({ message: "year must be a whole number between 2000 and 2100." });
      }
    }
  }
  const st = req.query?.status;
  if (req.path.startsWith("/invoices") && st && !INVOICE_STATUSES.includes(String(st))) {
    return res.status(400).json({ message: `status must be one of: ${INVOICE_STATUSES.join(", ")}.` });
  }
  next();
});

router.use(setupRoutes);
router.use(invoicesRoutes);
router.use(statementsRoutes);
router.use(paymentsRoutes);
router.use(reversalsRoutes);
router.use(receiptsRoutes);
router.use(reportsRoutes);

export default router;
