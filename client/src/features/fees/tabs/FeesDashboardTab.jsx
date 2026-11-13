// Fees overview (admin and bursar): reversal requests waiting, this term's
// collection, the last 14 days and which classes owe most. Learners never see
// this tab; their Fees page is their own statement.
import { useQuery } from "@tanstack/react-query";

import { useMe } from "@/hooks/useMe";
import { getDashboardSummary } from "@/api/dashboard.api";
import { useSchoolCalendar } from "@/lib/schoolCalendar";
import { FeesHero, FeesTrend, OwedByClass } from "@/components/insights/FeesWidgets";
import ReversalRequestsCard from "../components/ReversalRequestsCard";

const norm = (v) => String(v || "").trim().toUpperCase();

export default function FeesDashboardTab() {
  const { data: meData } = useMe();
  const role = norm(meData?.user?.role);
  const { termLabels } = useSchoolCalendar();
  const q = useQuery({ queryKey: ["dashboardSummary"], queryFn: getDashboardSummary, staleTime: 15 * 1000 });
  const fees = q.data?.fees;
  const cal = q.data?.calendar;
  const termLabel = cal?.term ? `${termLabels?.[cal.term] || cal.term} ${cal.year}` : cal?.year ? String(cal.year) : "this term";

  return (
    <div className="space-y-4">
      <ReversalRequestsCard isAdmin={role === "ADMIN"} />
      {q.isLoading && <div className="h-48 animate-pulse rounded-3xl bg-muted" />}
      {q.isError && <div className="text-sm text-destructive">Couldn&apos;t load the fee figures.</div>}
      {fees && (
        <>
          <FeesHero fees={fees} termLabel={termLabel} />
          <div className="grid gap-4 lg:grid-cols-2">
            <FeesTrend fees={fees} />
            <OwedByClass fees={fees} />
          </div>
        </>
      )}
    </div>
  );
}
