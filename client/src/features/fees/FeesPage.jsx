import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";

import { useMe } from "@/hooks/useMe";

import FeesTabsNav from "../fees/components/FeesTabsNav";

import FeesDashboardTab from "../fees/tabs/FeesDashboardTab";
import FeeItemsTab from "../fees/tabs/FeeItemsTab";
import FeePlansTab from "../fees/tabs/FeePlansTab";
import InvoicesTab from "../fees/tabs/InvoicesTab";
import FeeCashierTab from "../fees/tabs/FeeCashierTab";
import StudentStatementTab from "../fees/tabs/StudentStatementTab";
import ReportsTab from "../fees/tabs/ReportsTab";

// Print target (mounted once)
import ReceiptPrint from "./print/ReceiptPrint";

function setPrintTarget(key) {
  document.documentElement.dataset.printing = key;
}

function clearPrintTarget() {
  delete document.documentElement.dataset.printing;
}

const norm = (v) => String(v || "").trim().toUpperCase();

/**
 * Define tab policy centrally (single source of truth)
 */
const TAB = {
  DASHBOARD: "dashboard",
  ITEMS: "items",
  PLANS: "plans",
  INVOICES: "invoices",
  CASHIER: "cashier",
  STUDENT: "student",
  REPORTS: "reports",
};

function getAllowedTabsByRole(role) {
  // Admin: full control
  if (role === "ADMIN") {
    return [
      TAB.DASHBOARD,
      TAB.ITEMS,
      TAB.PLANS,
      TAB.INVOICES,
      TAB.CASHIER,
      TAB.STUDENT,
      TAB.REPORTS,
    ];
  }

  // Bursar: finance ops (no setup)
  if (role === "BURSAR") {
    return [
      TAB.DASHBOARD,
      TAB.INVOICES,
      TAB.CASHIER,
      TAB.STUDENT,
      TAB.REPORTS,
    ];
  }

  // Student: self-service only
  if (role === "STUDENT") {
    return [TAB.DASHBOARD, TAB.STUDENT];
  }

  // Any other roles shouldn't access FeesPage at all (App.jsx already guards),
  // but return empty to be safe.
  return [];
}

function getDefaultTabByRole(role) {
  if (role === "STUDENT") return TAB.STUDENT;
  if (role === "BURSAR") return TAB.CASHIER;
  return TAB.DASHBOARD; // ADMIN
}

export default function FeesPage() {
  const { data, isLoading, isError } = useMe();

  // receipt JSON goes here
  const [receiptToPrint, setReceiptToPrint] = useState(null);

  const role = useMemo(() => norm(data?.user?.role), [data?.user?.role]);

  const allowedTabs = useMemo(() => getAllowedTabsByRole(role), [role]);
  const defaultTab = useMemo(() => getDefaultTabByRole(role), [role]);

  const [tab, setTab] = useState(defaultTab);

  // Sync tab when role changes (rare but possible after user update)
  useEffect(() => {
    setTab(defaultTab);
  }, [defaultTab]);

  // Hard guard: if tab becomes disallowed, snap to a valid default
  useEffect(() => {
    if (!allowedTabs.length) return;
    if (!allowedTabs.includes(tab)) {
      setTab(defaultTab);
    }
  }, [tab, allowedTabs, defaultTab]);

  // 🚀 printing flow: when receipt changes -> whitelist -> print -> cleanup
  useEffect(() => {
    if (!receiptToPrint) return;

    setPrintTarget("print-fees-receipt");

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.print();
      });
    });

    const onAfterPrint = () => {
      clearPrintTarget();
      window.removeEventListener("afterprint", onAfterPrint);
    };

    window.addEventListener("afterprint", onAfterPrint);

    return () => {
      window.removeEventListener("afterprint", onAfterPrint);
      clearPrintTarget();
    };
  }, [receiptToPrint]);

  if (isLoading) return <div className="p-6">Loading...</div>;
  if (isError || !data?.user) return <Navigate to="/auth/login" replace />;

  // If FeesPage is mounted but no tabs are allowed, kick them out (defense-in-depth)
  if (!allowedTabs.length) return <Navigate to="/app/dashboard" replace />;

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Fees</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Setup → Bill (Invoices) → Receive Payments → Statements → Reports.
          </p>

          {/* Subtle role chip */}
          <div className="mt-2 text-xs text-muted-foreground">
            Access level: <span className="font-medium">{role}</span>
          </div>
        </div>
      </div>

      {/* Pass allowed tabs to nav so it only renders what the user can use */}
      <FeesTabsNav tab={tab} setTab={setTab} tabs={allowedTabs} />

      {tab === TAB.DASHBOARD && <FeesDashboardTab />}

      {tab === TAB.ITEMS && <FeeItemsTab />}
      {tab === TAB.PLANS && <FeePlansTab />}

      {tab === TAB.INVOICES && <InvoicesTab />}

      {tab === TAB.CASHIER && (
        <FeeCashierTab onReceiptReady={setReceiptToPrint} />
      )}

      {tab === TAB.STUDENT && <StudentStatementTab />}
      {tab === TAB.REPORTS && <ReportsTab />}

      {/* Print target mounted ONCE */}
      <ReceiptPrint receipt={receiptToPrint} />
    </div>
  );
}
