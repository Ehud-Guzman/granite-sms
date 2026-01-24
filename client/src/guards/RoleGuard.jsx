// src/guards/RoleGuard.jsx
import { Navigate, useLocation } from "react-router-dom";
import { useMe } from "@/hooks/useMe";

const norm = (v) => String(v || "").trim().toUpperCase();

export default function RoleGuard({ allow = [], children }) {
  const location = useLocation();
  const { data, isLoading, isError } = useMe();

  if (isLoading) return <div className="p-6">Loading...</div>;
  if (isError || !data?.user) {
    return <Navigate to="/auth/login" state={{ from: location }} replace />;
  }

  const role = norm(data.user.role);
  const allowed = (allow || []).map(norm);

  if (allowed.length > 0 && !allowed.includes(role)) {
    return <Navigate to="/app/dashboard" replace />;
  }

  return children;
}
