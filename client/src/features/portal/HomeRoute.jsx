// /app/dashboard: staff get the school dashboard, learners and parents
// their own home (fees, results, attendance per learner).
import { lazy } from "react";
import { useMe } from "@/hooks/useMe";

const Dashboard = lazy(() => import("@/pages/Dashboard.jsx"));
const PortalHome = lazy(() => import("./PortalHome.jsx"));

export default function HomeRoute() {
  const { data } = useMe();
  const role = data?.user?.role;
  if (role === "STUDENT" || role === "PARENT") return <PortalHome />;
  return <Dashboard />;
}
