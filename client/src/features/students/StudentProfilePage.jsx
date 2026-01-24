// src/features/students/StudentProfilePage.jsx
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useMe } from "@/hooks/useMe";
import { deactivateStudent, getStudent } from "./students.api";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

const fullName = (s) => `${s?.firstName || ""} ${s?.lastName || ""}`.trim();

function fmtDate(d) {
  if (!d) return "-";
  try {
    return new Date(d).toLocaleDateString();
  } catch {
    return "-";
  }
}

export default function StudentProfilePage() {
  const { id } = useParams();
  const qc = useQueryClient();

  const { data: meData, isLoading: meLoading } = useMe();
  const role = meData?.role ?? meData?.user?.role;

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["student", id],
    queryFn: () => getStudent(id),
    enabled: !!id,
    retry: false,
    staleTime: 30 * 1000,
  });

  const deactivateMut = useMutation({
    mutationFn: deactivateStudent,
    onSuccess: () => {
      toast.success("Student deactivated");
      qc.invalidateQueries({ queryKey: ["students"] });
      qc.invalidateQueries({ queryKey: ["student", id] });
    },
    onError: (err) => toast.error(err?.response?.data?.message || "Failed to deactivate"),
  });

  if (meLoading) return <div className="p-6">Loading...</div>;
  if (role !== "ADMIN" && role !== "TEACHER") return <div className="p-6">Forbidden</div>;

  if (isLoading) return <div className="p-6">Loading student...</div>;
  if (isError) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle>Student</CardTitle>
            <CardDescription>Could not load this student.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {error?.response?.data?.message || error?.message || "Error"}
          </CardContent>
        </Card>
      </div>
    );
  }

  const s = data;

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Top */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm text-muted-foreground">Student Profile</div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            {fullName(s)}
            {s?.isActive ? (
              <Badge className="text-[10px]">ACTIVE</Badge>
            ) : (
              <Badge variant="secondary" className="text-[10px]">
                INACTIVE
              </Badge>
            )}
          </h1>
          <div className="text-sm text-muted-foreground mt-1">
            Admission No: <span className="font-medium text-foreground">{s.admissionNo}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link to="/app/students">Back</Link>
          </Button>

          {role === "ADMIN" && s?.isActive && (
            <Button
              variant="destructive"
              disabled={deactivateMut.isPending}
              onClick={() => {
                // eslint-disable-next-line no-restricted-globals
                if (confirm("Deactivate this student?")) deactivateMut.mutate(s.id);
              }}
            >
              {deactivateMut.isPending ? "Working..." : "Deactivate"}
            </Button>
          )}
        </div>
      </div>

      {/* Info grid */}
      <div className="grid gap-3 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Gender</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">{s.gender || "-"}</CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">DOB</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">{fmtDate(s.dob)}</CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Class</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">{s.class?.name || "-"}</CardContent>
        </Card>
      </div>

      {/* Status */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Status</CardTitle>
          <CardDescription>Student account state in the school.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <div className="flex items-center justify-between">
            <span>Current</span>
            <span className="font-medium text-foreground">{s.isActive ? "Active" : "Inactive"}</span>
          </div>

          <Separator className="my-3" />

          <div className="text-xs">
            {import.meta.env.DEV && (
              <>
                Student ID: <span className="font-mono">{s.id}</span>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
