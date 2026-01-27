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
    return new Date(d).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric"
    });
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

  if (meLoading) return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="text-muted-foreground">Loading...</div>
    </div>
  );
  
  if (role !== "ADMIN" && role !== "TEACHER") return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="text-lg font-medium">Access denied</div>
    </div>
  );

  if (isLoading) return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="text-muted-foreground">Loading student information...</div>
    </div>
  );
  
  if (isError) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="pt-6 text-center">
            <div className="text-lg font-medium mb-2">Student Not Found</div>
            <div className="text-muted-foreground mb-4">
              {error?.response?.data?.message || error?.message || "Unable to load student"}
            </div>
            <Button asChild variant="outline">
              <Link to="/app/students">Back to Students</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const s = data;

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-2xl font-semibold">{fullName(s)}</h1>
            <Badge variant={s?.isActive ? "default" : "secondary"}>
              {s?.isActive ? "Active" : "Inactive"}
            </Badge>
          </div>
          <div className="text-muted-foreground">
            Admission No: <span className="font-medium text-foreground">{s.admissionNo}</span>
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" asChild size="sm">
            <Link to="/app/students">Back to List</Link>
          </Button>

          {role === "ADMIN" && s?.isActive && (
            <Button
              variant="destructive"
              size="sm"
              disabled={deactivateMut.isPending}
              onClick={() => {
                if (window.confirm(`Deactivate ${fullName(s)}?`)) {
                  deactivateMut.mutate(s.id);
                }
              }}
            >
              {deactivateMut.isPending ? "Processing..." : "Deactivate"}
            </Button>
          )}
        </div>
      </div>

      {/* Information Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm font-medium mb-1">Personal Details</div>
            <div className="space-y-2">
              <div>
                <div className="text-xs text-muted-foreground">Gender</div>
                <div className="font-medium">{s.gender || "-"}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Date of Birth</div>
                <div className="font-medium">{fmtDate(s.dob)}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="text-sm font-medium mb-1">Academic Details</div>
            <div className="space-y-2">
              <div>
                <div className="text-xs text-muted-foreground">Class</div>
                <div className="font-medium">{s.class?.name || "-"}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Section</div>
                <div className="font-medium">{s.section || "-"}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="text-sm font-medium mb-1">Contact Information</div>
            <div className="space-y-2">
              <div>
                <div className="text-xs text-muted-foreground">Email</div>
                <div className="font-medium truncate">{s.email || "-"}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Phone</div>
                <div className="font-medium">{s.phone || "-"}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Status & Additional Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Account Information</CardTitle>
          <CardDescription>Student status and system details</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-sm text-muted-foreground">Account Status</div>
              <div className="font-medium">{s.isActive ? "Active" : "Inactive"}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Created</div>
              <div className="font-medium">{fmtDate(s.createdAt)}</div>
            </div>
          </div>
          
          {import.meta.env.DEV && (
            <>
              <Separator />
              <div>
                <div className="text-sm text-muted-foreground mb-1">System ID</div>
                <code className="text-xs bg-muted px-2 py-1 rounded">{s.id}</code>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}