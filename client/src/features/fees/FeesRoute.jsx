// /app/fees: staff get the fees workspace; a learner gets their own fee
// statement (never the lookup or the school's fee dashboard).
import { lazy } from "react";
import { useMe } from "@/hooks/useMe";

const FeesPage = lazy(() => import("./FeesPage.jsx"));
const PortalStatementPage = lazy(() => import("@/features/portal/PortalStatementPage.jsx"));

export default function FeesRoute() {
  const { data } = useMe();
  const user = data?.user;
  if (!user) return null;
  if (user.role === "STUDENT") return <PortalStatementPage studentId={user.studentId} />;
  return <FeesPage />;
}
