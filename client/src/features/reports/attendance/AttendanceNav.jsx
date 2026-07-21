// src/features/reports/attendance/AttendanceNav.jsx
import { NavLink } from "react-router-dom";

const linkCls = ({ isActive }) =>
  `px-3 py-2 rounded-md border text-sm ${isActive ? "bg-black text-white" : "bg-white hover:bg-muted"}`;

export default function AttendanceNav() {
  return (
    <div className="flex gap-2 no-print flex-wrap">
      <NavLink className={linkCls} to="/app/reports/attendance/summary" end>
        Summary
      </NavLink>
      <NavLink className={linkCls} to="/app/reports/attendance/defaulters" end>
        Defaulters
      </NavLink>
    </div>
  );
}
