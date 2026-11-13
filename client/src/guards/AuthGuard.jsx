// src/guards/AuthGuard.jsx
import { Navigate, useLocation } from "react-router-dom";
import { useMe } from "@/hooks/useMe";
import { getToken } from "@/api/auth.api";
import { FullScreenLoader } from "@/components/ui/state-blocks";

export default function AuthGuard({ children }) {
  const location = useLocation();
  const token = getToken();

  // Always call hook
  const { data, isLoading, isError } = useMe();

  // No token → login
  if (!token) {
    return <Navigate to="/auth/login" state={{ from: location }} replace />;
  }

  // Waiting for /api/me
  if (isLoading) {
    return <FullScreenLoader />;
  }

  // Token exists but invalid / expired
  if (isError || !data?.user) {
    return <Navigate to="/auth/login" state={{ from: location }} replace />;
  }

  const user = data.user;

  // 🔐 FORCE PASSWORD CHANGE
  if (user.mustChangePassword) {
    // Allow only the change-password page
    if (location.pathname !== "/auth/change-password") {
      return (
        <Navigate
          to="/auth/change-password"
          state={{ from: location }}
          replace
        />
      );
    }
  }

  return children;
}
