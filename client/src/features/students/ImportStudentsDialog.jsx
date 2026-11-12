// Bulk import of learners from Excel or CSV: check the file first (every
// row's problems are listed), then import all of it in one go.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { api } from "@/api/axios";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const TEMPLATE = [
  "Admission No,First Name,Last Name,Gender,Date of Birth,Class,Stream,Parent Name,Parent Phone,Relationship",
  "ADM-0001,Amani,Otieno,M,20/05/2014,Grade 7,E,Jane Otieno,0712 345 678,Mother",
].join("\r\n");

function downloadTemplate() {
  const url = URL.createObjectURL(new Blob([TEMPLATE], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "learners-template.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function send(file, dryRun) {
  const fd = new FormData();
  fd.append("file", file);
  return api.post(`/api/students/import${dryRun ? "?dryRun=1" : ""}`, fd).then((r) => r.data);
}

export default function ImportStudentsDialog({ open, onOpenChange }) {
  const qc = useQueryClient();
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);

  const check = useMutation({
    mutationFn: (f) => send(f, true),
    onSuccess: setResult,
    onError: (err) => {
      setResult(null);
      toast.error(err?.response?.data?.message || "Couldn't check the file");
    },
  });
  const run = useMutation({
    mutationFn: () => send(file, false),
    onSuccess: async (data) => {
      toast.success(`Imported ${data.created} learner(s)`);
      await qc.invalidateQueries({ queryKey: ["students"] });
      setFile(null);
      setResult(null);
      onOpenChange(false);
    },
    onError: (err) => {
      if (err?.response?.data?.rows) setResult(err.response.data);
      toast.error(err?.response?.data?.message || "Import failed");
    },
  });

  const rows = result?.rows || [];
  const bad = rows.filter((r) => r.errors.length);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import learners</DialogTitle>
          <DialogDescription>
            Upload an Excel (.xlsx) or CSV file with one learner per row. Required columns: Admission No, First Name, Last Name.
            Class, gender, date of birth and a parent&apos;s name and phone are optional.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="file"
            accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            aria-label="Choose file"
            className="text-sm"
            onChange={(e) => {
              const f = e.target.files?.[0] || null;
              setFile(f);
              setResult(null);
              if (f) check.mutate(f);
            }}
          />
          <Button variant="link" size="sm" onClick={downloadTemplate}>
            Download template
          </Button>
        </div>

        {check.isPending && <div className="text-sm text-muted-foreground">Checking the file…</div>}

        {result && (
          <div className="space-y-2">
            <div className="flex gap-2 text-sm">
              <Badge variant="secondary">{result.valid} ready</Badge>
              {result.invalid > 0 && <Badge variant="destructive">{result.invalid} with problems</Badge>}
            </div>
            {bad.length > 0 && (
              <div className="text-sm text-destructive">Fix these rows in the file and choose it again. Nothing has been imported.</div>
            )}
            <div className="overflow-x-auto border rounded-md">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr className="text-left">
                    <th className="p-2">Row</th>
                    <th className="p-2">Adm. no</th>
                    <th className="p-2">Name</th>
                    <th className="p-2">Class</th>
                    <th className="p-2">Parent</th>
                    <th className="p-2">Problems</th>
                  </tr>
                </thead>
                <tbody>
                  {(bad.length ? bad : rows).slice(0, 200).map((r) => (
                    <tr key={r.row} className="border-t align-top">
                      <td className="p-2">{r.row}</td>
                      <td className="p-2">{r.admissionNo || "—"}</td>
                      <td className="p-2">{r.name || "—"}</td>
                      <td className="p-2">{r.className || "—"}</td>
                      <td className="p-2">{r.guardian ? `${r.guardian.name} ${r.guardian.phone || ""}` : "—"}</td>
                      <td className="p-2 text-destructive">{r.errors.join("; ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!result || result.invalid > 0 || run.isPending} onClick={() => run.mutate()}>
            {run.isPending ? "Importing…" : `Import ${result?.valid || 0} learner(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
