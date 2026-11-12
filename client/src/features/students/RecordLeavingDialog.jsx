// Record that a learner has left: graduated, transferred or left. They become
// inactive; their marks, attendance and fees stay on record.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { api } from "@/api/axios";
import { useSchoolCalendar } from "@/lib/schoolCalendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export default function RecordLeavingDialog({ student, open, onOpenChange }) {
  const qc = useQueryClient();
  const { today } = useSchoolCalendar();
  const [status, setStatus] = useState("TRANSFERRED");
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/api/students/${student.id}/exit`, { status, date: date || today, note: note.trim() || undefined }).then((r) => r.data),
    onSuccess: async () => {
      toast.success("Recorded");
      onOpenChange(false);
      await qc.invalidateQueries({ queryKey: ["student", student.id] });
      await qc.invalidateQueries({ queryKey: ["students"] });
    },
    onError: (err) => toast.error(err?.response?.data?.message || "Could not save"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record leaving</DialogTitle>
          <DialogDescription>
            {student.firstName} {student.lastName} becomes inactive. Their marks, attendance and fee records are kept.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="exit-status">Reason</Label>
            <select
              id="exit-status"
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="TRANSFERRED">Transferred to another school</option>
              <option value="GRADUATED">Graduated</option>
              <option value="LEFT">Left (other reason)</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="exit-date">Date</Label>
            <Input id="exit-date" type="date" max={today} value={date || today} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="exit-note">Note (optional)</Label>
            <Input
              id="exit-note"
              placeholder={status === "TRANSFERRED" ? "e.g. Moved to Nakuru Hill School" : ""}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : "Record leaving"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
