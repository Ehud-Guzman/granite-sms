// client/src/features/students/StudentsListPage.jsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useMe } from "@/hooks/useMe";
import { api } from "@/api/axios";
import {
  deactivateStudent,
  getTeacherAssignedClasses,
  listStudents,
} from "./students.api";
import StudentFormDrawer from "./StudentFormDrawer.jsx";
import { listClasses } from "../classes/classes.api";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Search,
  Filter,
  Plus,
  Eye,
  Edit2,
  UserX,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";

const fullName = (s) => `${s?.firstName || ""} ${s?.lastName || ""}`.trim();

function capLabel(v) {
  if (v === null) return "Unlimited";
  if (v === undefined) return "—";
  return String(v);
}

export default function StudentsListPage() {
  const qc = useQueryClient();

  const [active, setActive] = useState(true);
  const [classId, setClassId] = useState("");
  const [search, setSearch] = useState("");

  // Drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState("create");
  const [editingStudent, setEditingStudent] = useState(null);

  // ✅ identity truth
  const { data: meData, isLoading: meLoading } = useMe();

  const role = String(meData?.user?.role || meData?.role || "").toUpperCase();
  const teacherId = meData?.user?.teacherId;
  const tenantId = String(meData?.user?.schoolId || meData?.schoolId || "").trim();

  // ----------------------------
  // ✅ Subscription overview (limit-aware UI for ADMIN create)
  // ----------------------------
  const subQ = useQuery({
    queryKey: ["subscription-overview", "students", tenantId || "NO_TENANT"],
    queryFn: async () => {
      const { data } = await api.get("/api/settings/subscription/overview");
      return data;
    },
    enabled: role === "ADMIN" && !!tenantId,
    retry: false,
    staleTime: 30 * 1000,
  });

  const sub = subQ.data?.subscription || null;
  const atLimit = subQ.data?.atLimit || {};
  const flags = subQ.data?.flags || {};
  const usage = subQ.data?.usage || {};

  const canWrite = !!flags.canWrite;
  const studentsAtLimit = !!atLimit.students;
  const canCreateStudent = role === "ADMIN" && !!tenantId && canWrite && !studentsAtLimit;

  const createBlockedMsg = useMemo(() => {
    if (role !== "ADMIN") return null;

    if (!tenantId) return "School context missing — your account is not linked to a school.";
    if (subQ.isLoading) return "Checking plan limits…";
    if (subQ.isError) return "Could not load plan limits. Try refresh.";
    if (!canWrite) return "Your subscription is read-only. Renew or upgrade to add students.";

    if (studentsAtLimit) {
      const used = usage.studentsCount ?? "—";
      const cap = sub?.maxStudents ?? "—";
      return `Student limit reached (${used}/${cap}). Upgrade to add more students.`;
    }

    return null;
  }, [
    role,
    tenantId,
    subQ.isLoading,
    subQ.isError,
    canWrite,
    studentsAtLimit,
    usage.studentsCount,
    sub?.maxStudents,
  ]);

  // ADMIN: classes for filter + drawer
  const { data: classes = [], isLoading: classesLoading } = useQuery({
    queryKey: ["classes"],
    queryFn: listClasses,
    enabled: role === "ADMIN",
    retry: false,
  });

  // TEACHER: assigned classes
  const {
    data: teacherClasses = [],
    isLoading: tcLoading,
    isError: tcError,
    error: tcErr,
  } = useQuery({
    queryKey: ["teacher-classes", teacherId],
    queryFn: () => getTeacherAssignedClasses(teacherId),
    enabled: role === "TEACHER" && !!teacherId,
    retry: false,
  });

  const teacherClassOptions = useMemo(() => {
    if (role !== "TEACHER") return [];
    return teacherClasses.map((row) => ({
      id: String(row.classId),
      name: row.class?.name || "Class",
    }));
  }, [role, teacherClasses]);

  useEffect(() => {
    if (role === "TEACHER") {
      const first = teacherClassOptions[0];
      if (first?.id && !classId) setClassId(first.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, teacherClassOptions]);

  const teacherHasNoAssignments =
    role === "TEACHER" && !tcLoading && !tcError && teacherClassOptions.length === 0;

  // Teacher must pick a class; Admin can do "all"
  const effectiveClassId = role === "TEACHER" ? classId : classId || undefined;

  const {
    data: students = [],
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ["students", { active, classId: effectiveClassId || null }],
    queryFn: () => listStudents({ active, classId: effectiveClassId }),
    enabled:
      role === "ADMIN"
        ? true
        : role === "TEACHER"
        ? !!effectiveClassId && !teacherHasNoAssignments
        : false,
    retry: false,
  });

  const deactivateMut = useMutation({
    mutationFn: deactivateStudent,
    onSuccess: () => {
      toast.success("Student deactivated");
      qc.invalidateQueries({ queryKey: ["students"] });
    },
    onError: (err) =>
      toast.error(err?.response?.data?.message || "Failed to deactivate"),
  });

  const filteredStudents = useMemo(() => {
    const qq = search.trim().toLowerCase();
    if (!qq) return students;

    return students.filter((s) => {
      const name = fullName(s).toLowerCase();
      const adm = String(s.admissionNo || "").toLowerCase();
      return name.includes(qq) || adm.includes(qq);
    });
  }, [students, search]);

  const openCreate = () => {
    if (role === "ADMIN" && !canCreateStudent) {
      toast.error(createBlockedMsg || "Cannot create student right now.");
      return;
    }
    setDrawerMode("create");
    setEditingStudent(null);
    setDrawerOpen(true);
  };

  const openEdit = (student) => {
    setDrawerMode("edit");
    setEditingStudent(student);
    setDrawerOpen(true);
  };

  if (meLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  
  if (role !== "ADMIN" && role !== "TEACHER") {
    return (
      <div className="p-6">
        <Card className="border-destructive/20">
          <CardHeader>
            <CardTitle className="text-destructive flex items-center gap-2">
              <AlertCircle className="h-5 w-5" />
              Access Denied
            </CardTitle>
            <CardDescription>
              You don't have permission to view this page. Please contact your administrator.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (role === "TEACHER" && tcError) {
    return (
      <div className="p-6">
        <Card className="border-destructive/20">
          <CardHeader>
            <CardTitle className="text-destructive flex items-center gap-2">
              <AlertCircle className="h-5 w-5" />
              Cannot Load Classes
            </CardTitle>
            <CardDescription>
              Failed to load your assigned classes. The Class Teachers feature may be disabled.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            <div className="bg-muted p-3 rounded-md">
              {tcErr?.response?.data?.message || tcErr?.message || "Unknown error"}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (role === "TEACHER" && teacherHasNoAssignments) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5" />
              No Classes Assigned
            </CardTitle>
            <CardDescription>
              You currently have no class assigned. Ask the Admin to assign you as a class teacher.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link to="/app/classes">View Available Classes</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight">Students</h1>
          <p className="text-muted-foreground">
            {role === "TEACHER"
              ? "Manage students in your assigned class(es)"
              : "Manage all student records and information"}
          </p>
        </div>

        {role === "ADMIN" && (
          <div className="flex flex-col items-start sm:items-end gap-2">
            <Button 
              onClick={openCreate} 
              disabled={!canCreateStudent}
              className="gap-2"
            >
              <Plus className="h-4 w-4" />
              Add Student
            </Button>

            {!canCreateStudent && (
              <div className="text-xs text-muted-foreground text-left sm:text-right max-w-xs">
                <span className="inline-flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {createBlockedMsg || "Student creation is currently blocked."}
                </span>
                <Link to="/app/settings?tab=subs" className="underline ml-1">
                  Manage plan
                </Link>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Filters Section */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-lg">Filters & Search</CardTitle>
          </div>
          <CardDescription>Refine your student list</CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Status Tabs */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Status</label>
            <Tabs 
              value={active ? "active" : "inactive"} 
              onValueChange={(v) => setActive(v === "active")}
              className="w-fit"
            >
              <TabsList>
                <TabsTrigger value="active">Active Students</TabsTrigger>
                <TabsTrigger value="inactive">Inactive Students</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Search Input */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Search</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Name or admission number..."
                  className="pl-9"
                />
              </div>
            </div>

            {/* Class Filter - TEACHER */}
            {role === "TEACHER" && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Class</label>
                <Select value={classId} onValueChange={setClassId} disabled={tcLoading}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select class" />
                  </SelectTrigger>
                  <SelectContent>
                    {teacherClassOptions.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Class Filter - ADMIN */}
            {role === "ADMIN" && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Class Filter</label>
                <Select
                  value={classId || "all"}
                  onValueChange={(v) => setClassId(v === "all" ? "" : v)}
                  disabled={classesLoading}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All classes" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All classes</SelectItem>
                    {classes.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name || c.label || c.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Students Table Section */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">Student List</CardTitle>
              <CardDescription>
                {isLoading ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading...
                  </span>
                ) : (
                  `${filteredStudents.length} student${filteredStudents.length !== 1 ? 's' : ''} found`
                )}
              </CardDescription>
            </div>
            {!isLoading && filteredStudents.length > 0 && (
              <Badge variant="outline">
                {active ? "Active" : "Inactive"} Students
              </Badge>
            )}
          </div>
        </CardHeader>

        <CardContent>
          {/* Loading State */}
          {isLoading && (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          )}

          {/* Error State */}
          {isError && (
            <div className="text-center py-8">
              <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
              <div className="font-medium">Failed to load students</div>
              <div className="text-muted-foreground mt-2 max-w-md mx-auto">
                {error?.response?.data?.message || error?.message || "Unknown error occurred"}
              </div>
              <Button 
                variant="outline" 
                className="mt-4"
                onClick={() => window.location.reload()}
              >
                Retry
              </Button>
            </div>
          )}

          {/* Empty State */}
          {!isLoading && !isError && filteredStudents.length === 0 && (
            <div className="text-center py-12">
              <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
                <AlertCircle className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="font-semibold">No students found</h3>
              <p className="text-muted-foreground mt-1 mb-4">
                {search ? "Try adjusting your search criteria" : "No students match your current filters"}
              </p>
              {search && (
                <Button variant="outline" onClick={() => setSearch("")}>
                  Clear Search
                </Button>
              )}
            </div>
          )}

          {/* Table */}
          {!isLoading && !isError && filteredStudents.length > 0 && (
            <div className="rounded-lg border overflow-hidden">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="font-semibold">Admission No</TableHead>
                      <TableHead className="font-semibold">Name</TableHead>
                      <TableHead className="font-semibold">Gender</TableHead>
                      <TableHead className="font-semibold">Class</TableHead>
                      <TableHead className="font-semibold">Status</TableHead>
                      <TableHead className="font-semibold text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>

                  <TableBody>
                    {filteredStudents.map((s) => (
                      <TableRow key={s.id} className="hover:bg-muted/30">
                        <TableCell className="font-medium">
                          <div className="font-mono">{s.admissionNo}</div>
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{fullName(s)}</div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="uppercase text-xs">
                            {s.gender || "-"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-primary" />
                            {s.class?.name || "-"}
                          </div>
                        </TableCell>
                        <TableCell>
                          {s.isActive ? (
                            <Badge variant="success">Active</Badge>
                          ) : (
                            <Badge variant="secondary">Inactive</Badge>
                          )}
                        </TableCell>

                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button asChild variant="ghost" size="sm" className="h-8">
                              <Link to={`/app/students/${s.id}`} className="flex items-center gap-1">
                                <Eye className="h-3.5 w-3.5" />
                                View
                              </Link>
                            </Button>

                            {role === "ADMIN" && (
                              <>
                                <Button 
                                  variant="ghost" 
                                  size="sm" 
                                  className="h-8"
                                  onClick={() => openEdit(s)}
                                >
                                  <Edit2 className="h-3.5 w-3.5" />
                                  Edit
                                </Button>

                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 text-destructive hover:text-destructive"
                                  disabled={deactivateMut.isPending}
                                  onClick={() => {
                                    if (confirm("Are you sure you want to deactivate this student?")) {
                                      deactivateMut.mutate(s.id);
                                    }
                                  }}
                                >
                                  {deactivateMut.isPending ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <UserX className="h-3.5 w-3.5" />
                                  )}
                                  Deactivate
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Drawer */}
      {role === "ADMIN" && (
        <StudentFormDrawer
          open={drawerOpen}
          mode={drawerMode}
          initialStudent={editingStudent}
          onClose={() => setDrawerOpen(false)}
        />
      )}
    </div>
  );
}