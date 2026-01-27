// src/features/classes/ClassDetailsPage.jsx
import { Link, useParams } from "react-router-dom";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { useMe } from "@/hooks/useMe";
import { listClasses } from "@/features/classes/classes.api";
import { listStudents } from "@/features/students/students.api";
import AssignClassTeacherDrawer from "@/features/classes/AssignClassTeacherDrawer";

import { api } from "@/api/axios";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, Users, UserCircle } from "lucide-react";

function classLabel(c) {
  const s = c?.stream ? ` ${c.stream}` : "";
  return `${c?.name || ""}${s}`.trim();
}

function niceFromEmail(email) {
  const raw = String(email || "").split("@")[0] || "";
  if (!raw) return "";
  return raw
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function teacherDisplayFromAssignment(row) {
  const t = row?.teacher;
  const first = t?.firstName || "";
  const last = t?.lastName || "";
  const full = `${first} ${last}`.trim();
  const email = t?.user?.email || "";
  return full || niceFromEmail(email) || email || "—";
}

async function listClassTeachers() {
  const { data } = await api.get("/api/class-teachers");
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.rows)) return data.rows;
  return [];
}

export default function ClassDetailsPage() {
  const { id } = useParams();

  const { data: meData } = useMe();
  const role = String(meData?.user?.role || meData?.role || "").toUpperCase();
  const tenantId = String(meData?.user?.schoolId || meData?.schoolId || "").trim();

  const classesQ = useQuery({
    queryKey: ["classes", { year: null }],
    queryFn: () => listClasses(),
    retry: false,
    staleTime: 60 * 1000,
  });

  const klass = useMemo(() => {
    const list = Array.isArray(classesQ.data) ? classesQ.data : [];
    return list.find((c) => String(c.id) === String(id)) || null;
  }, [classesQ.data, id]);

  const studentsQ = useQuery({
    queryKey: ["students", { classId: id }],
    queryFn: () => listStudents({ classId: id }),
    enabled: !!id && !!klass,
    retry: false,
  });

  const students = Array.isArray(studentsQ.data) ? studentsQ.data : [];

  const canAssign = role === "ADMIN" && !!klass;

  const classTeachersQ = useQuery({
    queryKey: ["class-teachers", tenantId],
    queryFn: listClassTeachers,
    enabled: !!tenantId && !!klass,
    retry: false,
    staleTime: 60 * 1000,
  });

  const currentAssignment = useMemo(() => {
    const rows = Array.isArray(classTeachersQ.data) ? classTeachersQ.data : [];
    const cid = String(klass?.id || "").trim();
    if (!cid) return null;
    return rows.find((r) => String(r?.classId) === cid) || null;
  }, [classTeachersQ.data, klass?.id]);

  const teacherName = currentAssignment ? teacherDisplayFromAssignment(currentAssignment) : "—";
  const teacherEmail = currentAssignment?.teacher?.user?.email || "";

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link 
              to="/app/classes" 
              className="hover:text-foreground transition-colors"
            >
              Classes
            </Link>
            <span>/</span>
            <span>Class Details</span>
          </div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
              {klass ? classLabel(klass) : "Class Details"}
            </h1>
            {klass?.year && (
              <Badge variant="outline" className="px-2 py-1">
                {klass.year}
              </Badge>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {canAssign && (
            <AssignClassTeacherDrawer 
              classId={klass.id} 
              classLabel={classLabel(klass)}
            >
              <Button className="gap-2">
                <UserCircle className="h-4 w-4" />
                Assign Teacher
              </Button>
            </AssignClassTeacherDrawer>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              classesQ.refetch();
              studentsQ.refetch();
              classTeachersQ.refetch();
            }}
            className="gap-2"
          >
            Refresh
          </Button>

          <Button variant="outline" size="sm" asChild>
            <Link to="/app/classes">Back to Classes</Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Class Overview */}
        <div className="lg:col-span-2 space-y-6">
          {/* Class Information Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Class Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {classesQ.isLoading ? (
                <div className="space-y-4">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              ) : !klass ? (
                <div className="flex items-center gap-3 p-4 bg-muted/50 rounded-lg">
                  <AlertCircle className="h-5 w-5 text-muted-foreground" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium">Class not found</p>
                    <p className="text-sm text-muted-foreground">
                      This class wasn't found in the list. A dedicated API endpoint will be added later.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <div className="text-sm font-medium text-muted-foreground">Class Name</div>
                      <div className="text-lg font-semibold">{classLabel(klass)}</div>
                    </div>
                    
                    <div className="space-y-2">
                      <div className="text-sm font-medium text-muted-foreground">Class Teacher</div>
                      {classTeachersQ.isLoading ? (
                        <Skeleton className="h-6 w-32" />
                      ) : (
                        <div>
                          <div className="text-lg font-semibold">{teacherName}</div>
                          {teacherEmail && (
                            <div className="text-sm text-muted-foreground">
                              {teacherEmail}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-2">
                    <div className="text-sm font-medium text-muted-foreground">Description</div>
                    <div className="text-sm">
                      Viewing students assigned to{" "}
                      <span className="font-semibold text-foreground">
                        {classLabel(klass)}
                      </span>
                      {klass.year && ` (${klass.year})`}.
                    </div>
                  </div>

                  {import.meta.env.DEV && (
                    <div className="p-3 bg-muted/50 rounded-lg">
                      <div className="text-xs font-medium text-muted-foreground mb-1">
                        Development Information
                      </div>
                      <div className="text-xs font-mono text-muted-foreground">
                        Class ID: {klass.id}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Students Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Students
                </div>
                {!studentsQ.isLoading && !studentsQ.isError && klass && (
                  <Badge variant="secondary">
                    {students.length} student{students.length !== 1 ? 's' : ''}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!klass && !classesQ.isLoading && (
                <div className="flex items-center gap-3 p-4 bg-muted/50 rounded-lg">
                  <AlertCircle className="h-5 w-5 text-muted-foreground" />
                  <div className="text-sm text-muted-foreground">
                    Can't load students because this class wasn't resolved.
                  </div>
                </div>
              )}

              {studentsQ.isLoading && (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="flex items-center justify-between p-3 border rounded-lg">
                      <div className="space-y-2">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-3 w-24" />
                      </div>
                      <Skeleton className="h-6 w-16" />
                    </div>
                  ))}
                </div>
              )}

              {studentsQ.isError && (
                <div className="flex items-center gap-3 p-4 bg-destructive/10 rounded-lg">
                  <AlertCircle className="h-5 w-5 text-destructive" />
                  <div className="space-y-1">
                    <div className="text-sm font-medium">Failed to load students</div>
                    <div className="text-sm text-muted-foreground">
                      {studentsQ.error?.response?.data?.message ||
                        studentsQ.error?.message ||
                        "Server error"}
                    </div>
                  </div>
                </div>
              )}

              {!studentsQ.isLoading && !studentsQ.isError && klass && (
                <>
                  {students.length === 0 ? (
                    <div className="text-center py-8">
                      <Users className="h-12 w-12 text-muted-foreground/50 mx-auto mb-3" />
                      <p className="text-sm text-muted-foreground">No students in this class yet.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {students.map((s) => (
                        <div
                          key={s.id}
                          className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors group"
                        >
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary font-semibold">
                              {s.firstName?.[0]}{s.lastName?.[0]}
                            </div>
                            <div>
                              <div className="font-medium">
                                {s.firstName} {s.lastName}
                              </div>
                              <div className="text-sm text-muted-foreground">
                                Admission: {s.admissionNo || "—"}
                              </div>
                            </div>
                          </div>

                          <Badge
                            variant={s.isActive ? "default" : "outline"}
                            className={s.isActive ? "bg-green-100 text-green-800 hover:bg-green-100" : ""}
                          >
                            {s.isActive ? "Active" : "Inactive"}
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

        {/* Right Column - Quick Stats & Actions */}
        <div className="space-y-6">
          {/* Stats Card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Quick Stats</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="text-sm text-muted-foreground">Total Students</div>
                  <div className="text-2xl font-bold">
                    {studentsQ.isLoading ? (
                      <Skeleton className="h-8 w-12" />
                    ) : (
                      students.length
                    )}
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="text-sm text-muted-foreground">Active Students</div>
                  <div className="text-2xl font-bold text-green-600">
                    {studentsQ.isLoading ? (
                      <Skeleton className="h-8 w-12" />
                    ) : (
                      students.filter(s => s.isActive).length
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Actions Card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {canAssign && (
                <AssignClassTeacherDrawer
                  classId={klass?.id}
                  classLabel={klass ? classLabel(klass) : ""}
                  trigger={
                    <Button variant="outline" className="w-full justify-start gap-2">
                      <UserCircle className="h-4 w-4" />
                      Assign Teacher
                    </Button>
                  }
                />
              )}
              <Button
                variant="outline"
                className="w-full justify-start gap-2"
                onClick={() => {
                  classesQ.refetch();
                  studentsQ.refetch();
                  classTeachersQ.refetch();
                }}
              >
                Refresh Data
              </Button>
              <Button variant="outline" className="w-full justify-start gap-2" asChild>
                <Link to="/app/classes">
                  Back to Classes
                </Link>
              </Button>
            </CardContent>
          </Card>

          {/* Status Card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Class Data</span>
                {classesQ.isLoading ? (
                  <Skeleton className="h-5 w-16" />
                ) : (
                  <Badge variant={klass ? "default" : "destructive"}>
                    {klass ? "Loaded" : "Not Found"}
                  </Badge>
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Students</span>
                {studentsQ.isLoading ? (
                  <Skeleton className="h-5 w-16" />
                ) : studentsQ.isError ? (
                  <Badge variant="destructive">Error</Badge>
                ) : (
                  <Badge variant="secondary">Loaded</Badge>
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Teacher</span>
                {classTeachersQ.isLoading ? (
                  <Skeleton className="h-5 w-16" />
                ) : (
                  <Badge variant={teacherName !== "—" ? "default" : "outline"}>
                    {teacherName !== "—" ? "Assigned" : "Unassigned"}
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}