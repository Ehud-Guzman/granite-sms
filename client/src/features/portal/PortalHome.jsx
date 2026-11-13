// Home for learners and parents: one card per learner with the fee account,
// the latest published result and this term's attendance; links to the
// statement and report cards; parents can pay by M-Pesa prompt.
import { useState } from "react";
import { ALL_ON } from "@/lib/planFeatures";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { api } from "@/api/axios";
import { useMe } from "@/hooks/useMe";
import { useSchoolCalendar } from "@/lib/schoolCalendar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import NoticeItem from "@/features/notices/NoticeItem";
import { useNotices } from "@/features/notices/notices.api";
import { RowsSkeleton } from "@/components/ui/state-blocks";

const kes = (n) => `KES ${Math.round(Number(n) || 0).toLocaleString("en-KE")}`;

function PayBox({ studentId, suggested }) {
  const [amount, setAmount] = useState(suggested > 0 ? String(suggested) : "");
  const pay = useMutation({
    mutationFn: () =>
      api
        .post(`/api/portal/learners/${studentId}/pay`, {
          amount: Number(amount),
        })
        .then((r) => r.data),
    onSuccess: (d) => toast.success(d.message),
    onError: (e) =>
      toast.error(e?.response?.data?.message || "Could not start the payment"),
  });
  return (
    <div className="flex gap-2 items-center">
      <Input
        aria-label="Amount to pay"
        type="number"
        className="w-36"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <Button
        size="sm"
        disabled={pay.isPending || !(Number(amount) >= 10)}
        onClick={() => pay.mutate()}
      >
        {pay.isPending ? "Sending…" : "Pay with M-Pesa"}
      </Button>
    </div>
  );
}

export default function PortalHome() {
  const meQ = useMe();
  const role = meQ.data?.user?.role;
  const { termLabels, timezone } = useSchoolCalendar();
  const noticesQ = useNotices({ limit: 3 });
  const q = useQuery({
    queryKey: ["portalLearners"],
    queryFn: () => api.get("/api/portal/learners").then((r) => r.data),
    enabled: !!role,
  });
  const learners = q.data?.learners || [];
  const isParent = role === "PARENT";
  // Only the parts the school's plan includes.
  const features = { ...ALL_ON, ...(meQ.data?.features || {}) };
  const parts = [
    features.fees && "fees",
    features.exams && "results",
    features.attendance && "attendance",
  ].filter(Boolean);

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">
          {isParent ? "Your children" : "Your school summary"}
        </h1>
        {parts.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {parts
              .join(", ")
              .replace(/, ([^,]*)$/, " and $1")
              .replace(/^./, (x) => x.toUpperCase())}{" "}
            in one place.
          </p>
        )}
      </div>

      {noticesQ.data?.length > 0 && (
        <Card>
          <CardHeader className="pb-0 flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-base">Notices</CardTitle>
            <Button asChild size="sm" variant="ghost">
              <Link to="/app/notices">See all</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {noticesQ.data.map((n) => (
              <NoticeItem key={n.id} n={n} timezone={timezone} />
            ))}
          </CardContent>
        </Card>
      )}

      {q.isLoading && <RowsSkeleton />}
      {q.isError && (
        <div className="text-sm text-destructive">
          Couldn&apos;t load this page.
        </div>
      )}
      {!q.isLoading && !q.isError && learners.length === 0 && (
        <div className="text-sm text-muted-foreground">
          {isParent
            ? "No learners are linked to your account yet. Ask the school office."
            : "Nothing to show yet."}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {learners.map((l) => {
          const st = l.student;
          const owes = l.account.net > 0;
          const r = l.latestResult;
          return (
            <Card key={st.id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center justify-between gap-2">
                  <span>
                    {st.firstName} {st.lastName}
                  </span>
                  <span className="text-sm font-normal text-muted-foreground">
                    {st.admissionNo}
                    {st.class
                      ? ` · ${st.class.name}${st.class.stream ? ` ${st.class.stream}` : ""}`
                      : ""}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {features.fees && (
                  <div className="flex items-center justify-between">
                    <span>Fees</span>
                    {owes ? (
                      <Badge variant="destructive">
                        Balance {kes(l.account.net)}
                      </Badge>
                    ) : l.account.credit > 0 ? (
                      <Badge variant="secondary">
                        Credit {kes(l.account.credit)}
                      </Badge>
                    ) : (
                      <Badge>Fully paid</Badge>
                    )}
                  </div>
                )}
                {features.fees && isParent && owes && (
                  <PayBox studentId={st.id} suggested={l.account.net} />
                )}

                {features.exams && (
                  <div className="flex items-center justify-between">
                    <span>Latest results</span>
                    {r ? (
                      <span>
                        {r.exam || termLabels?.[r.term] || r.term}:{" "}
                        <b>{r.average}</b>
                        {r.grade ? ` · ${r.grade}` : ""}
                        {r.position ? ` · ${r.position} of ${r.outOf}` : ""}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        None published yet
                      </span>
                    )}
                  </div>
                )}

                {features.attendance && (
                  <div className="flex items-center justify-between">
                    <span>Attendance this term</span>
                    {l.attendance ? (
                      <span>
                        <b>{l.attendance.ratePct}%</b> (
                        {l.attendance.present + l.attendance.late} of{" "}
                        {l.attendance.total} days)
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        No registers yet
                      </span>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap gap-2 pt-1">
                  {features.fees && (
                    <Button asChild size="sm" variant="outline">
                      <Link to={`/app/portal/${st.id}/statement`}>
                        Fee statement
                      </Link>
                    </Button>
                  )}
                  {features.exams && (
                    <Button asChild size="sm" variant="outline">
                      <Link to={`/app/portal/${st.id}/report-card`}>
                        Report cards
                      </Link>
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
