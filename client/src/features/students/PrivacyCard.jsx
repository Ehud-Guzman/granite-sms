// Data Protection Act on the learner's profile (admins only): the parent's
// consent, and removing a former learner's personal details.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { api } from "@/api/axios";
import { dateIn, todayIn } from "@/lib/schoolCalendar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const errMsg = (e, fallback) => e?.response?.data?.message || fallback;

export default function PrivacyCard({ student }) {
  const qc = useQueryClient();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["student", student.id] });
    qc.invalidateQueries({ queryKey: ["students"] });
  };
  const [by, setBy] = useState(student.consentBy || "");
  const [date, setDate] = useState(student.consentAt ? dateIn(student.consentAt, "UTC") : todayIn());
  const [photo, setPhoto] = useState(!!student.photoConsent);
  const [confirm, setConfirm] = useState("");

  const consent = useMutation({
    mutationFn: (given) => api.patch(`/api/students/${student.id}/consent`, given ? { given, by, date, photo } : { given }),
    onSuccess: (_, given) => {
      toast.success(given ? "Consent recorded" : "Consent withdrawn");
      if (!given) {
        setBy("");
        setPhoto(false);
      }
      refresh();
    },
    onError: (e) => toast.error(errMsg(e, "Could not save consent")),
  });

  const anonymise = useMutation({
    mutationFn: () => api.post(`/api/students/${student.id}/anonymise`, { confirm }),
    onSuccess: () => {
      toast.success("Personal details removed");
      setConfirm("");
      refresh();
    },
    onError: (e) => toast.error(errMsg(e, "Could not anonymise")),
  });

  if (student.anonymisedAt) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Privacy</CardTitle>
          <CardDescription>
            Personal details were removed on {dateIn(student.anonymisedAt)}. Fee and academic records are kept without the learner&apos;s name.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Privacy</CardTitle>
        <CardDescription>A parent&apos;s consent to keep this learner&apos;s data (Data Protection Act, 2019).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div>
          {student.consentAt ? (
            <span>
              Consent given by <b>{student.consentBy}</b> on {dateIn(student.consentAt, "UTC")}
              {student.photoConsent ? " · photos allowed" : " · no photos"}
            </span>
          ) : (
            <span className="text-destructive">No consent recorded.</span>
          )}
        </div>
        <div className="flex flex-wrap gap-3 items-center">
          <Input aria-label="Consent given by" placeholder="Given by, e.g. Mary W (mother)" className="w-64" value={by} onChange={(e) => setBy(e.target.value)} />
          <Input aria-label="Consent date" type="date" className="w-40" value={date} onChange={(e) => setDate(e.target.value)} />
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={photo} onChange={(e) => setPhoto(e.target.checked)} />
            Photos and publication allowed
          </label>
          <Button size="sm" disabled={consent.isPending || by.trim().length < 2} onClick={() => consent.mutate(true)}>
            Save consent
          </Button>
          {student.consentAt && (
            <Button size="sm" variant="outline" disabled={consent.isPending} onClick={() => consent.mutate(false)}>
              Withdraw
            </Button>
          )}
        </div>

        {!student.isActive && (
          <div className="border-t pt-4 space-y-2">
            <div className="font-medium">Remove personal details</div>
            <div className="text-muted-foreground">
              For a learner who has left. Their name, date of birth, login and parents&apos; contacts are removed for good. Fee payments, marks
              and attendance stay so the school&apos;s records still add up. This can&apos;t be undone.
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <Input
                aria-label="Type the admission number to confirm"
                placeholder={`Type ${student.admissionNo} to confirm`}
                className="w-64"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
              <Button size="sm" variant="destructive" disabled={anonymise.isPending || confirm.trim() !== student.admissionNo} onClick={() => anonymise.mutate()}>
                {anonymise.isPending ? "Removing…" : "Remove details"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
