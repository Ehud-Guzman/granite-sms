// src/features/reports/fees/FinanceNav.jsx
// Was copy-pasted identically into FeesSummaryReport, FeesDefaultersReport,
// and FeesCollectionsReport — a change to one tab link silently wouldn't
// apply to the other two.
import { NavLink } from "react-router-dom";

const linkCls = ({ isActive }) =>
  `px-3 py-2 rounded-md border text-sm ${isActive ? "bg-black text-white" : "bg-white hover:bg-muted"}`;

export default function FinanceNav() {
  return (
    <div className="flex gap-2 no-print flex-wrap">
      <NavLink className={linkCls} to="/app/reports/fees/summary" end>
        Summary
      </NavLink>
      <NavLink className={linkCls} to="/app/reports/fees/defaulters" end>
        Defaulters
      </NavLink>
      <NavLink className={linkCls} to="/app/reports/fees/collections" end>
        Collections
      </NavLink>
    </div>
  );
}
