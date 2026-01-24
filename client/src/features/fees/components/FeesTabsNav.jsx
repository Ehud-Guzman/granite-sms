// src/features/fees/components/FeesTabsNav.jsx
import { Button } from "@/components/ui/button";

/**
 * Single source of truth for all possible tabs.
 * Visibility is controlled by the `tabs` prop.
 */
const ALL_TABS = [
  { key: "dashboard", label: "Dashboard" },

  // Setup (Admin)
  { key: "items", label: "Fee Items" },
  { key: "plans", label: "Fee Plans" },

  // Operations
  { key: "invoices", label: "Invoices" },
  { key: "cashier", label: "Receive Payment" },
  { key: "student", label: "Student Statement" },

  // Reports / Audit
  { key: "reports", label: "Reports" },
];

export default function FeesTabsNav({
  tab,
  setTab,
  tabs = [], // allowed tab keys
}) {
  // If `tabs` is provided, filter; otherwise fall back to all (safe default)
  const visibleTabs =
    Array.isArray(tabs) && tabs.length > 0
      ? ALL_TABS.filter((t) => tabs.includes(t.key))
      : ALL_TABS;

  return (
    <div className="flex flex-wrap gap-2">
      {visibleTabs.map((t) => {
        const isActive = tab === t.key;

        return (
          <Button
            key={t.key}
            size="sm"
            variant={isActive ? "default" : "outline"}
            onClick={() => {
              if (!isActive) setTab(t.key);
            }}
            aria-current={isActive ? "page" : undefined}
          >
            {t.label}
          </Button>
        );
      })}
    </div>
  );
}
