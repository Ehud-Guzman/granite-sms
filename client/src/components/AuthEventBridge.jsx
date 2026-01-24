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

    authEvents.addEventListener("logout", onLogout);
    return () => authEvents.removeEventListener("logout", onLogout);
  }, [qc, navigate]);

  return null;
}
