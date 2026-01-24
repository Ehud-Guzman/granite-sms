import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useMe } from "@/hooks/useMe";
import { activateTeacher, deactivateTeacher, listTeachers } from "@/api/teachers.api";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

function teacherName(t) {
  return (
    `${t?.firstName || ""} ${t?.lastName || ""}`.trim() ||
    t?.name ||
    "Teacher"
  );
}

function isActiveTeacher(t) {
  return !!t?.user?.isActive; // ✅ source of truth
}

function teacherEmail(t) {
  return t?.user?.email || ""; // ✅ source of truth
}

export default function TeachersListPage() {
  const qc = useQueryClient();

  const { data: meData, isLoading: meLoading } = useMe();
  const role = meData?.role ?? meData?.user?.role;

  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all"); // all | active | inactive

  const teachersQ = useQuery({
    queryKey: ["teachers"],
    queryFn: listTeachers,
    retry: false,
    staleTime: 60 * 1000,
  });

  const deactMut = useMutation({
    mutationFn: deactivateTeacher,
    onSuccess: () => {
      toast.success("Teacher deactivated");
      qc.invalidateQueries({ queryKey: ["teachers"] });
    },
    onError: (err) => toast.error(err?.response?.data?.message || "Failed to deactivate teacher"),
  });

  const actMut = useMutation({
    mutationFn: activateTeacher,
    onSuccess: () => {
      toast.success("Teacher activated");
      qc.invalidateQueries({ queryKey: ["teachers"] });
    },
    onError: (err) => toast.error(err?.response?.data?.message || "Failed to activate teacher"),
  });

  const rows = useMemo(() => {
    const list = Array.isArray(teachersQ.data) ? teachersQ.data : [];
    const needle = q.trim().toLowerCase();

    return list
      .filter((t) => {
        const active = isActiveTeacher(t);
        if (status === "active") return active;
        if (status === "inactive") return !active;
        return true;
      })
      .filter((t) => {
        if (!needle) return true;
        const txt = `${teacherName(t)} ${teacherEmail(t)} ${t?.phone || ""}`.toLowerCase();
        return txt.includes(needle);
      });
  }, [teachersQ.data, q, status]);

  if (meLoading) return <div className="p-6">Loading...</div>;
  if (role !== "ADMIN") return <div className="p-6">Forbidden</div>;

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Teachers</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage teacher accounts and status.
        </p>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Filters</CardTitle>
          <CardDescription>Search and quickly segment teachers.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col md:flex-row gap-3">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, email, phone…"
          />

          <div className="flex gap-2">
            <Button
              type="button"
              variant={status === "all" ? "default" : "outline"}
              onClick={() => setStatus("all")}
            >
              All
            </Button>
            <Button
              type="button"
              variant={status === "active" ? "default" : "outline"}
              onClick={() => setStatus("active")}
            >
              Active
            </Button>
            <Button
              type="button"
              variant={status === "inactive" ? "default" : "outline"}
              onClick={() => setStatus("inactive")}
            >
              Inactive
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Loading / Error */}
      {teachersQ.isLoading && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Loading teachers…
          </CardContent>
        </Card>
      )}

      {teachersQ.isError && (
        <Card>
          <CardContent className="p-6 text-sm">
            <div className="font-medium">Failed to load teachers</div>
            <div className="text-muted-foreground mt-1">
              {teachersQ.error?.response?.data?.message ||
                teachersQ.error?.message ||
                "Server error"}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Grid */}
      {!teachersQ.isLoading && !teachersQ.isError && (
        <>
          <div className="text-xs text-muted-foreground">
            {rows.length} result(s)
          </div>

          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {rows.map((t) => {
              const name = teacherName(t);
              const contact = teacherEmail(t) || t?.phone || "—";
              const active = isActiveTeacher(t);

              const isRowBusy = deactMut.isPending || actMut.isPending;

              return (
                <Card key={t.id}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center justify-between gap-2">
                      <span className="truncate">{name}</span>
                      <Badge
                        variant={active ? "secondary" : "outline"}
                        className="text-[10px]"
                      >
                        {active ? "ACTIVE" : "INACTIVE"}
                      </Badge>
                    </CardTitle>
                    <div className="text-sm text-muted-foreground truncate">{contact}</div>
                  </CardHeader>

                  <CardContent className="space-y-3">
                    <Separator />

                    <div className="flex gap-2">
                      {active ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isRowBusy}
                          onClick={() => {
                            // eslint-disable-next-line no-restricted-globals
                            if (confirm(`Deactivate ${name}?`)) deactMut.mutate(t.id);
                          }}
                        >
                          {deactMut.isPending ? "Working..." : "Deactivate"}
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          disabled={isRowBusy}
                          onClick={() => {
                            // eslint-disable-next-line no-restricted-globals
                            if (confirm(`Activate ${name}?`)) actMut.mutate(t.id);
                          }}
                        >
                          {actMut.isPending ? "Working..." : "Activate"}
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}

            {rows.length === 0 && (
              <Card className="md:col-span-2 lg:col-span-3">
                <CardContent className="p-6 text-sm text-muted-foreground">
                  No teachers found.
                </CardContent>
              </Card>
            )}
          </div>
        </>
      )}
    </div>
  );
}
