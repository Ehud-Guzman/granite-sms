// src/features/students/StudentFormDrawer.jsx
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { studentSchema, toStudentPayload } from "./students.schema";
import { createStudent, updateStudent } from "./students.api";
import { listClasses } from "../classes/classes.api";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";

function classLabel(c) {
  const s = c.stream ? ` ${c.stream}` : "";
  return `${c.name || "Class"}${s}`.trim();
}

export default function StudentFormDrawer({
  open,
  onClose,
  mode = "create",
  initialStudent = null,
}) {
  const qc = useQueryClient();

  const { data: classes = [], isLoading: classesLoading } = useQuery({
    queryKey: ["classes"],
    queryFn: listClasses,
    enabled: open,
    retry: false,
    staleTime: 60 * 1000,
  });

  const form = useForm({
    resolver: zodResolver(studentSchema),
    defaultValues: {
      admissionNo: "",
      firstName: "",
      lastName: "",
      gender: "",
      dob: "",
      classId: "",
    },
    mode: "onChange",
  });

  const createMut = useMutation({
    mutationFn: (payload) => createStudent(payload),
    onSuccess: () => {
      toast.success("Student created");
      qc.invalidateQueries({ queryKey: ["students"] });
      qc.invalidateQueries({ queryKey: ["classes"] }); // safe: counts/relations can change
      onClose();
    },
    onError: (err) =>
      toast.error(err?.response?.data?.message || "Failed to create student"),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, payload }) => updateStudent(id, payload),
    onSuccess: (_, vars) => {
      toast.success("Student updated");
      qc.invalidateQueries({ queryKey: ["students"] });
      qc.invalidateQueries({ queryKey: ["student", vars?.id] });
      qc.invalidateQueries({ queryKey: ["classes"] });
      onClose();
    },
    onError: (err) =>
      toast.error(err?.response?.data?.message || "Failed to update student"),
  });

  const busy = createMut.isPending || updateMut.isPending;

  useEffect(() => {
    if (!open) return;

    if (mode === "edit" && initialStudent) {
      form.reset({
        admissionNo: initialStudent.admissionNo || "",
        firstName: initialStudent.firstName || "",
        lastName: initialStudent.lastName || "",
        gender: initialStudent.gender || "",
        dob: initialStudent.dob ? String(initialStudent.dob).slice(0, 10) : "",
        classId: initialStudent.classId || "",
      });
      return;
    }

    form.reset({
      admissionNo: "",
      firstName: "",
      lastName: "",
      gender: "",
      dob: "",
      classId: "",
    });
  }, [open, mode, initialStudent, form]);

  const onSubmit = (values) => {
    const payload = toStudentPayload(values);

    if (mode === "create") {
      createMut.mutate(payload);
      return;
    }

    if (!initialStudent?.id) {
      toast.error("Missing student id");
      return;
    }

    updateMut.mutate({ id: initialStudent.id, payload });
  };

  const handleOpenChange = (v) => {
    if (!v && busy) return;
    if (!v) onClose();
  };

  const isValid = form.formState.isValid;

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{mode === "create" ? "New Student" : "Edit Student"}</SheetTitle>
          <SheetDescription>
            {mode === "create"
              ? "Create a student record"
              : "Update student details"}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 text-xs text-muted-foreground">
          Tip: Admission No should be unique per school.
        </div>

        <Separator className="my-4" />

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <Field label="Admission No *" error={form.formState.errors.admissionNo?.message}>
            <Input
              {...form.register("admissionNo")}
              placeholder="e.g. ADM-1021"
              disabled={busy}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="First Name *" error={form.formState.errors.firstName?.message}>
              <Input {...form.register("firstName")} placeholder="e.g. Amina" disabled={busy} />
            </Field>

            <Field label="Last Name *" error={form.formState.errors.lastName?.message}>
              <Input {...form.register("lastName")} placeholder="e.g. Otieno" disabled={busy} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Gender" error={form.formState.errors.gender?.message}>
              <Select
                value={form.watch("gender") || ""}
                onValueChange={(v) => form.setValue("gender", v, { shouldValidate: true })}
                disabled={busy}
              >
                <SelectTrigger>
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MALE">Male</SelectItem>
                  <SelectItem value="FEMALE">Female</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            <Field label="DOB" error={form.formState.errors.dob?.message}>
              <Input type="date" {...form.register("dob")} disabled={busy} />
            </Field>
          </div>

          <Field label="Class" error={form.formState.errors.classId?.message}>
            <Select
              value={form.watch("classId") || ""}
              onValueChange={(v) =>
                form.setValue("classId", v === "__none__" ? "" : v, { shouldValidate: true })
              }
              disabled={busy || classesLoading}
            >
              <SelectTrigger>
                <SelectValue placeholder="— Unassigned —" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Unassigned</SelectItem>
                {classes.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {classLabel(c)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Button type="submit" className="w-full" disabled={busy || !isValid}>
            {busy ? "Saving..." : mode === "create" ? "Create Student" : "Save Changes"}
          </Button>

          <Button type="button" variant="outline" className="w-full" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, error, children }) {
  return (
    <div className="space-y-1">
      <div className="text-sm font-medium">{label}</div>
      {children}
      {error ? <div className="text-xs text-destructive">{error}</div> : null}
    </div>
  );
}
