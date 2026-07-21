import { useQuery } from "@tanstack/react-query";

import { useMe } from "@/hooks/useMe";
import { feesCollections, getStudentFeesSummary } from "@/api/fees.api";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { money } from "../components/FeeMoney";

const norm = (v) => String(v || "").trim().toUpperCase();

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export default function FeesDashboardTab() {
  const { data: meData } = useMe();
  const role = norm(meData?.user?.role);
  const studentId = meData?.user?.studentId || null;

  const isStaff = role === "ADMIN" || role === "BURSAR";
  const isStudent = role === "STUDENT";

  const today = todayStr();

  const collectionsQ = useQuery({
    queryKey: ["feesDashboardCollections", today],
    queryFn: () => feesCollections({ from: today, to: today }),
    enabled: isStaff,
  });

  const summaryQ = useQuery({
    queryKey: ["feesDashboardStudentSummary", studentId],
    queryFn: () => getStudentFeesSummary(studentId),
    enabled: isStudent && !!studentId,
  });

  return (
    <div className="grid gap-3">
      {isStaff && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Today's collections</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {collectionsQ.isLoading ? (
              <div className="text-muted-foreground">Loading…</div>
            ) : collectionsQ.isError ? (
              <div className="text-destructive">Failed to load today's collections.</div>
            ) : (
              <div className="grid gap-1">
                <div>
                  Collected today:{" "}
                  <b>{money(collectionsQ.data?.totalCollected ?? 0)}</b>
                </div>
                <div className="text-xs text-muted-foreground">
                  Payments: {collectionsQ.data?.count ?? 0}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {isStudent && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Your fees</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {!studentId ? (
              <div className="text-muted-foreground">No student record linked to your account.</div>
            ) : summaryQ.isLoading ? (
              <div className="text-muted-foreground">Loading…</div>
            ) : summaryQ.isError ? (
              <div className="text-destructive">Failed to load your fee summary.</div>
            ) : (
              <div className="grid gap-1">
                <div>
                  Total billed: <b>{money(summaryQ.data?.total ?? 0)}</b>
                </div>
                <div>
                  Total paid: <b>{money(summaryQ.data?.paid ?? 0)}</b>
                </div>
                <div>
                  Balance: <b>{money(summaryQ.data?.balance ?? 0)}</b>
                </div>
                <div className="text-xs text-muted-foreground">
                  Invoices: {summaryQ.data?.count ?? 0}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Workflow</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {isStudent ? (
            "See the Student Statement tab for a full timeline of invoices and payments."
          ) : (
            <>
              Create items → Create plan → Generate invoice → Record payment → Print receipt.
              <div className="mt-2">
                Use the Invoices tab for bulk billing and voids, Reports (top nav) for
                class summary / defaulters / collections.
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
