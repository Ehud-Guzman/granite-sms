import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { authEvents } from "@/api/axios";

export default function AuthEventBridge() {
  const qc = useQueryClient();
  const navigate = useNavigate();

  useEffect(() => {
    const onLogout = () => {
      qc.clear(); // clears ["me"] + everything else
      navigate("/auth/login", { replace: true });
    };

    // Session identity changed (fresh login, or SYSTEM_ADMIN switched
    // tenant via selectSchool()) — drop every cached query so no data tied
    // to the previous user/school can leak into the new session's screens.
    // See auth.api.js#login and #selectSchool.
    const onSessionChanged = () => {
      qc.clear();
    };

    authEvents.addEventListener("logout", onLogout);
    authEvents.addEventListener("session-changed", onSessionChanged);
    return () => {
      authEvents.removeEventListener("logout", onLogout);
      authEvents.removeEventListener("session-changed", onSessionChanged);
    };
  }, [qc, navigate]);

  return null;
}
