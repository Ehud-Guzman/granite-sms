// src/features/classes/ClassDetailsPage.jsx
import { Link, useParams } from "react-router-dom";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { useMe } from "@/hooks/useMe";
import { listClasses } from "@/features/classes/classes.api";
import { listStudents } from "@/features/students/students.api";
import AssignClassTeacherDrawer from "@/features/classes/AssignClassTeacherDrawer";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

function classLabel(c) {
  const s = c.stream ? ` ${c.stream}` : "";
  return `${c.name}${s}`;
}

export default function ClassDetailsPage() {
  const { id } = useParams();

  const { data: meData } = useMe();
  const role = meData?.role ?? meData?.user?.role;

  // We don’t have GET /classes/:id yet, so list is source of truth.
  const classesQ = useQuery({
    queryKey: ["classes", { year: null }],
    queryFn: () => listClasses(),
    retry: false,
    staleTime: 60 * 1000,
  });

  const klass = useMemo(() => {
    const list = Array.isArray(classesQ.data) ? classesQ.data : [];
    return list.find((c) => String(c.id) === String(id));
  }, [classesQ.data, id]);

  const studentsQ = useQuery({
    queryKey: ["students", { classId: id }],
    queryFn: () => listStudents({ classId: id }),
    enabled: !!id && !!klass,
    retry: false,
  });

  const students = Array.isArray(studentsQ.data) ? studentsQ.data : [];

  const canAssign = role === "ADMIN" && !!klass;

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm text-muted-foreground">Class</div>
          <h1 className="text-2xl font-semibold">
            {klass ? classLabel(klass) : "Class details"}
          </h1>
        </div>

        <div className="flex items-center gap-2">
          {canAssign && (
            <AssignClassTeacherDrawer classId={klass.id} classLabel={classLabel(klass)}>
              <Button>Assign class teacher</Button>
            </AssignClassTeacherDrawer>
          )}

          <Button
            variant="outline"
            onClick={() => {
              classesQ.refetch();
              studentsQ.refetch();
            }}
          >
            Refresh
          </Button>

          <Button variant="outline" asChild>
            <Link to="/app/classes">Back</Link>
          </Button>
        </div>
      </div>

      {/* Overview */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center justify-between">
            <span>Overview</span>
            {klass?.year && (
              <Badge variant="secondary" className="text-[10px]">
                {klass.year}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>

        <CardContent className="text-sm text-muted-foreground">
          {classesQ.isLoading && "Loading class…"}

          {!classesQ.isLoading && !klass && (
            <span>
              Class not found in list. (Later we’ll add <code>/api/classes/:id</code>.)
            </span>
          )}

          {klass && (
            <div className="space-y-2">
              <div>
                Viewing students assigned to{" "}
                <span className="font-medium text-foreground">{classLabel(klass)}</span>.
              </div>

              <Separator />

              {/* show ID only in dev */}
              {import.meta.env.DEV && (
                <div className="text-xs">
                  Class ID: <span className="font-mono">{klass.id}</span>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Students */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center justify-between">
            <span>Students</span>
            {!studentsQ.isLoading && !studentsQ.isError && klass && (
              <Badge variant="secondary" className="text-[10px]">
                {students.length} total
              </Badge>
            )}
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-2">
          {!klass && !classesQ.isLoading && (
            <div className="text-sm text-muted-foreground">
              Can’t load students because this class wasn’t resolved.
            </div>
          )}

          {studentsQ.isLoading && (
            <div className="text-sm text-muted-foreground">Loading students…</div>
          )}

          {studentsQ.isError && (
            <div className="text-sm">
              <div className="font-medium">Failed to load students</div>
              <div className="text-muted-foreground mt-1">
                {studentsQ.error?.response?.data?.message ||
                  studentsQ.error?.message ||
                  "Server error"}
              </div>
            </div>
          )}

          {!studentsQ.isLoading && !studentsQ.isError && klass && (
            <>
              {students.length === 0 ? (
                <div className="text-sm text-muted-foreground">No students in this class.</div>
              ) : (
                <div className="grid gap-2">
                  {students.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between rounded-md border bg-background p-3"
                    >
                      <div>
                        <div className="font-medium">
                          {s.firstName} {s.lastName}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Adm: {s.admissionNo}
                        </div>
                      </div>

                      <Badge
                        variant={s.isActive ? "secondary" : "outline"}
                        className="text-[10px]"
                      >
                        {s.isActive ? "ACTIVE" : "INACTIVE"}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
