import { useState } from "react";
import { useMutation } from "@tanstack/react-query";

import { lookupStudentByAdmissionNo } from "@/features/students/students.api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function StudentLookupByAdmission({
  onSelect,
  defaultAdmissionNo = "",
  label = "Admission No",
  helperText = "Type admission number then click Use Student.",
}) {
  const [admissionNo, setAdmissionNo] = useState(defaultAdmissionNo);
  const [error, setError] = useState("");

  const lookupMut = useMutation({
    mutationFn: lookupStudentByAdmissionNo,
    onSuccess: (student) => {
      if (!student) {
        setError("Student not found");
        return;
      }
      setError("");
      onSelect(student);
    },
    onError: () => {
      setError("Student not found");
    },
  });

  return (
    <div className="grid gap-2 md:grid-cols-4">
      <Input
        placeholder={`${label} (e.g. ADM0001)`}
        value={admissionNo}
        onChange={(e) => setAdmissionNo(e.target.value)}
      />

      <Button
        className="md:col-span-1"
        onClick={() => lookupMut.mutate(admissionNo)}
        disabled={!admissionNo || lookupMut.isPending}
      >
        {lookupMut.isPending ? "Searching…" : "Use Student"}
      </Button>

      <div className="md:col-span-2 text-sm">
        {!admissionNo && (
          <span className="text-muted-foreground">{helperText}</span>
        )}
        {error && (
          <span className="text-destructive">{error}</span>
        )}
      </div>
    </div>
  );
}
