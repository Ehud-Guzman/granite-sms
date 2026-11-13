// Payment reversals a bursar has asked for. Admins approve or reject them;
// a bursar sees the status of their own requests.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { listReversalRequests, decideReversalRequest } from "@/api/fees.api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import SimpleModal from "./SimpleModal";
import { money } from "./FeeMoney";
import { RowsSkeleton } from "@/components/ui/state-blocks";

function when(d) {
  return d ? new Date(d).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" }) : "—";
}

function studentLabel(r) {
  const st = r.payment?.invoice?.student;
  return st ? `${st.firstName} ${st.lastName} (${st.admissionNo})` : "—";
}

export default function ReversalRequestsCard({ isAdmin }) {
  const qc = useQueryClient();
  const [rejecting, setRejecting] = useState(null);
  const [note, setNote] = useState("");

  // Admins work the queue; bursars see their recent requests and outcomes.
  const status = isAdmin ? "PENDING" : "ALL";
  const q = useQuery({
    queryKey: ["feeReversalRequests", status],
    queryFn: () => listReversalRequests({ status }),
  });

  const decide = useMutation({
    mutationFn: ({ id, decision, note: n }) => decideReversalRequest(id, decision, { note: n }),
    onSuccess: async (_d, vars) => {
      await qc.invalidateQueries({ queryKey: ["feeReversalRequests"] });
      await qc.invalidateQueries({ queryKey: ["feeInvoices"] });
      setRejecting(null);
      setNote("");
      toast.success(vars.decision === "approve" ? "Payment reversed" : "Request rejected");
    },
    onError: (err) => toast.error(err?.response?.data?.message || "Could not save the decision"),
  });

  const requests = q.data || [];
  if (!isAdmin && !q.isLoading && requests.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          {isAdmin ? "Reversal requests waiting for you" : "Your reversal requests"}
          {isAdmin && requests.length > 0 && (
            <Badge variant="destructive" className="ml-2">
              {requests.length}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm">
        {q.isLoading ? (
          <RowsSkeleton />
        ) : q.isError ? (
          <div className="text-destructive">Failed to load reversal requests.</div>
        ) : requests.length === 0 ? (
          <div className="text-muted-foreground">No requests waiting.</div>
        ) : (
          <div className="grid gap-2">
            {requests.map((r) => (
              <div key={r.id} className="rounded-md border p-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1 min-w-0">
                  <div className="font-medium">
                    {money(r.payment?.amount)} · {r.payment?.method} · {r.payment?.receiptNo || "no receipt no."}
                  </div>
                  <div className="text-muted-foreground">{studentLabel(r)}</div>
                  <div>
                    <span className="text-muted-foreground">Reason: </span>
                    {r.reason}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Requested by {r.requestedByName || "—"} · {when(r.requestedAt)}
                  </div>
                  {r.status !== "PENDING" && (
                    <div className="text-xs">
                      <Badge variant={r.status === "APPROVED" ? "default" : "outline"}>{r.status}</Badge>{" "}
                      {r.decidedByName ? `by ${r.decidedByName}` : ""} {r.decisionNote ? `· ${r.decisionNote}` : ""}
                    </div>
                  )}
                </div>
                {isAdmin && r.status === "PENDING" && (
                  <div className="flex gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={decide.isPending}
                      onClick={() => decide.mutate({ id: r.id, decision: "approve" })}
                    >
                      Approve reversal
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={decide.isPending}
                      onClick={() => {
                        setRejecting(r);
                        setNote("");
                      }}
                    >
                      Reject
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <SimpleModal
        title="Reject reversal request"
        open={!!rejecting}
        onClose={() => setRejecting(null)}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setRejecting(null)}>
              Cancel
            </Button>
            <Button
              disabled={!note.trim() || decide.isPending}
              onClick={() => decide.mutate({ id: rejecting.id, decision: "reject", note: note.trim() })}
            >
              Reject request
            </Button>
          </div>
        }
      >
        <div className="space-y-2">
          <div className="text-muted-foreground text-sm">The payment stays on the invoice. Say why, so the bursar knows.</div>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason for rejecting (required)" />
        </div>
      </SimpleModal>
    </Card>
  );
}
