// src/features/fees/components/FeesTabsNav.jsx

/**
 * Single source of truth for all possible tabs.
 * Visibility is controlled by the `tabs` prop.
 */
const ALL_TABS = [
  { key: "dashboard", label: "Overview" },

  // Setup (Admin)
  { key: "items", label: "Fee items" },
  { key: "plans", label: "Fee plans" },

  // Operations
  { key: "invoices", label: "Invoices" },
  { key: "cashier", label: "Receive payment" },
  { key: "student", label: "Statements" },
  { key: "mpesa", label: "M-Pesa" },
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
    <nav className="inline-flex max-w-full flex-wrap gap-1 rounded-xl border bg-muted/50 p-1" aria-label="Fees sections">
      {visibleTabs.map((t) => {
        const isActive = tab === t.key;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => !isActive && setTab(t.key)}
            aria-current={isActive ? "page" : undefined}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${isActive ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            {t.label}
          </button>
        );
      })}
    </nav>
  );
}
