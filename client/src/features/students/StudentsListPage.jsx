import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useMe } from "@/hooks/useMe";
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

const fullName = (s) => `${s?.firstName || ""} ${s?.lastName || ""}`.trim();

export default function StudentsListPage() {
  const qc = useQueryClient();

  const [active, setActive] = useState(true);
  const [classId, setClassId] = useState("");
  const [search, setSearch] = useState("");

  // Drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState("create");
  const [editingStudent, setEditingStudent] = useState(null);

  // ✅ single identity truth
  const { data: meData, isLoading: meLoading } = useMe();

  // support both shapes safely: { role } OR { user: { role } }
  const role = meData?.role ?? meData?.user?.role;
  const teacherId = meData?.user?.teacherId;

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
    role === "TEACHER" &&
    !tcLoading &&
    !tcError &&
    teacherClassOptions.length === 0;

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
    const q = search.trim().toLowerCase();
    if (!q) return students;

    return students.filter((s) => {
      const name = fullName(s).toLowerCase();
      const adm = String(s.admissionNo || "").toLowerCase();
      return name.includes(q) || adm.includes(q);
    });
  }, [students, search]);

  const openCreate = () => {
    setDrawerMode("create");
    setEditingStudent(null);
    setDrawerOpen(true);
  };

  const openEdit = (student) => {
    setDrawerMode("edit");
    setEditingStudent(student);
    setDrawerOpen(true);
  };

  if (meLoading) return <div className="p-6">Loading...</div>;
  if (role !== "ADMIN" && role !== "TEACHER") return <div className="p-6">Forbidden</div>;

  if (role === "TEACHER" && tcError) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle>Students</CardTitle>
            <CardDescription>
              Cannot load your assigned classes. The Class Teachers feature may be disabled.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {tcErr?.response?.data?.message || tcErr?.message || "Error"}
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
            <CardTitle>Students</CardTitle>
            <CardDescription>
              You currently have no class assigned. Ask the Admin to assign you as a class teacher.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Students</h1>
          <p className="text-sm text-muted-foreground mt-2">
            {role === "TEACHER"
              ? "Only students in your assigned class(es) are shown."
              : "Manage student records."}
          </p>
        </div>

        {role === "ADMIN" && <Button onClick={openCreate}>+ New Student</Button>}
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
          <CardDescription>Use filters to narrow down results.</CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col md:flex-row md:items-center gap-3">
          {/* Status */}
          <div className="w-full md:w-[220px]">
            <Select
              value={active ? "active" : "inactive"}
              onValueChange={(v) => setActive(v === "active")}
            >
              <SelectTrigger>
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Search */}
          <div className="w-full md:flex-1">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or admission number..."
            />
          </div>

          {/* Class - TEACHER */}
          {role === "TEACHER" && (
            <div className="w-full md:w-[220px]">
              <Select value={classId} onValueChange={setClassId} disabled={tcLoading}>
                <SelectTrigger>
                  <SelectValue placeholder="Class" />
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

          {/* Class - ADMIN */}
          {role === "ADMIN" && (
            <div className="w-full md:w-[220px]">
              <Select
                value={classId || "all"}
                onValueChange={(v) => setClassId(v === "all" ? "" : v)}
                disabled={classesLoading}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Class" />
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
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Students</CardTitle>
          <CardDescription>{filteredStudents.length} result(s)</CardDescription>
        </CardHeader>

        <CardContent>
          {isLoading && (
            <div className="text-sm text-muted-foreground">Loading students...</div>
          )}

          {isError && (
            <div className="text-sm">
              <div className="font-medium">Failed to load students</div>
              <div className="text-muted-foreground mt-1">
                {error?.response?.data?.message || error?.message}
              </div>
            </div>
          )}

          {!isLoading && !isError && filteredStudents.length === 0 && (
            <div className="text-sm text-muted-foreground">No students found.</div>
          )}

          {!isLoading && !isError && filteredStudents.length > 0 && (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Admission No</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Gender</TableHead>
                    <TableHead>Class</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {filteredStudents.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.admissionNo}</TableCell>
                      <TableCell>{fullName(s)}</TableCell>
                      <TableCell className="uppercase text-xs text-muted-foreground">
                        {s.gender || "-"}
                      </TableCell>
                      <TableCell>{s.class?.name || "-"}</TableCell>
                      <TableCell>
                        {s.isActive ? (
                          <Badge>Active</Badge>
                        ) : (
                          <Badge variant="secondary">Inactive</Badge>
                        )}
                      </TableCell>

                      <TableCell className="text-right space-x-2">
                        <Button asChild variant="outline" size="sm">
                          <Link to={`/app/students/${s.id}`}>View</Link>
                        </Button>

                        {role === "ADMIN" && (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => openEdit(s)}
                            >
                              Edit
                            </Button>

                            <Button
                              variant="destructive"
                              size="sm"
                              disabled={deactivateMut.isPending}
                              onClick={() => {
                                // eslint-disable-next-line no-restricted-globals
                                if (confirm("Deactivate this student?")) {
                                  deactivateMut.mutate(s.id);
                                }
                              }}
                            >
                              {deactivateMut.isPending ? "Working..." : "Deactivate"}
                            </Button>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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
