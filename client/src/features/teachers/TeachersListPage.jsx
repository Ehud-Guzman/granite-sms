// client/src/features/teachers/TeachersListPage.jsx
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useMe } from "@/hooks/useMe";
import { activateTeacher, deactivateTeacher, listTeachers } from "@/api/teachers.api.js";

import TeacherFormDrawer from "./TeacherFormDrawer.jsx";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Search,
  Filter,
  Plus,
  User,
  Mail,
  Phone,
  UserCheck,
  UserX,
  Users,
  RefreshCw,
  MoreVertical,
  Eye,
  Shield,
  AlertCircle,
  Loader2,
  Copy,
  KeyRound,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// ✅ OPTION B SHAPE: each row is a USER (role=TEACHER)
function teacherName(u) {
  const first = u?.firstName || "";
  const last = u?.lastName || "";
  const byName = `${first} ${last}`.trim();
  return byName || u?.name || u?.email || "Teacher";
}

function isActiveTeacher(u) {
  return !!u?.isActive;
}

function teacherEmail(u) {
  return u?.email || "";
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(String(text || ""));
    return true;
  } catch {
    return false;
  }
}

export default function TeachersListPage() {
  const qc = useQueryClient();
  const { data: meData, isLoading: meLoading } = useMe();

  const role = String(meData?.user?.role || meData?.role || "").toUpperCase();
  const tenantId = String(meData?.user?.schoolId || meData?.schoolId || "").trim();

  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all"); // all | active | inactive
  const [drawerOpen, setDrawerOpen] = useState(false);

  // ✅ store last created credentials (so user can copy even after drawer closes)
  const [lastCreds, setLastCreds] = useState(null);
  // shape: { email, tempPassword, userId }

  // --- Teachers list (from /api/users?role=TEACHER) ---
  const teachersQ = useQuery({
    queryKey: ["teachers", tenantId],
    queryFn: listTeachers,
    enabled: !!tenantId && role === "ADMIN",
    retry: false,
    staleTime: 15 * 1000,
  });

  const deactMut = useMutation({
    mutationFn: deactivateTeacher,
    onSuccess: () => {
      toast.success("Teacher deactivated");
      qc.invalidateQueries({ queryKey: ["teachers"] });
    },
    onError: (err) =>
      toast.error(err?.response?.data?.message || "Failed to deactivate teacher"),
  });

  const actMut = useMutation({
    mutationFn: activateTeacher,
    onSuccess: () => {
      toast.success("Teacher activated");
      qc.invalidateQueries({ queryKey: ["teachers"] });
    },
    onError: (err) =>
      toast.error(err?.response?.data?.message || "Failed to activate teacher"),
  });

  const rows = useMemo(() => {
    const list = Array.isArray(teachersQ.data) ? teachersQ.data : [];
    const needle = q.trim().toLowerCase();

    return list
      .filter((u) => {
        const active = isActiveTeacher(u);
        if (status === "active") return active;
        if (status === "inactive") return !active;
        return true;
      })
      .filter((u) => {
        if (!needle) return true;
        const txt = `${teacherName(u)} ${teacherEmail(u)} ${u?.phone || ""}`.toLowerCase();
        return txt.includes(needle);
      });
  }, [teachersQ.data, q, status]);

  if (meLoading) {
    return (
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        <div className="space-y-2">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-4 w-96" />
        </div>
        <Skeleton className="h-12 w-full" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-48 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (role !== "ADMIN") {
    return (
      <div className="p-6">
        <Card className="border-destructive/20">
          <CardHeader>
            <CardTitle className="text-destructive flex items-center gap-2">
              <AlertCircle className="h-5 w-5" />
              Access Denied
            </CardTitle>
            <CardDescription>Admin access is required.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (!tenantId) {
    return (
      <div className="p-6">
        <Card className="border-destructive/20">
          <CardHeader>
            <CardTitle className="text-destructive flex items-center gap-2">
              <AlertCircle className="h-5 w-5" />
              Missing school context
            </CardTitle>
            <CardDescription>
              Your ADMIN account has no schoolId in /me, so teacher listing is blocked.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const anyBusy = deactMut.isPending || actMut.isPending;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Users className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Teachers</h1>
              <p className="text-muted-foreground">Teacher users (role=TEACHER)</p>
            </div>
          </div>
        </div>

        <div className="flex flex-col items-start md:items-end gap-2">
          <Button onClick={() => setDrawerOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            Add Teacher
          </Button>

          <div className="text-xs text-muted-foreground text-left md:text-right">
            Creates a TEACHER user and shows a temp password.
          </div>
        </div>
      </div>

      {/* ✅ last created creds banner (copy-friendly) */}
      {lastCreds?.tempPassword ? (
        <Card className="border-primary/20">
          <CardContent className="p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <div className="text-sm font-medium flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-primary" />
                New teacher credentials
              </div>
              <div className="text-xs text-muted-foreground">
                Email: <span className="font-mono">{lastCreds.email || "—"}</span>{" "}
                • Temp PW: <span className="font-mono">{lastCreds.tempPassword}</span>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={async () => {
                  const ok = await copyToClipboard(lastCreds.tempPassword);
                  ok ? toast.success("Temp password copied") : toast.error("Copy failed");
                }}
              >
                <Copy className="h-4 w-4" />
                Copy PW
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={async () => {
                  const ok = await copyToClipboard(lastCreds.email);
                  ok ? toast.success("Email copied") : toast.error("Copy failed");
                }}
              >
                <Copy className="h-4 w-4" />
                Copy Email
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-lg">Filters & Search</CardTitle>
          </div>
          <CardDescription>Find teachers by name/email/status</CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Search */}
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-2">
                <Search className="h-3 w-3" />
                Search
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search by name or email..."
                  className="pl-9"
                />
              </div>
            </div>

            {/* Status */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Status</label>
              <Tabs value={status} onValueChange={setStatus} className="w-full">
                <TabsList className="grid grid-cols-3">
                  <TabsTrigger value="all">All</TabsTrigger>
                  <TabsTrigger value="active" className="flex items-center gap-1">
                    <UserCheck className="h-3 w-3" />
                    Active
                  </TabsTrigger>
                  <TabsTrigger value="inactive" className="flex items-center gap-1">
                    <UserX className="h-3 w-3" />
                    Inactive
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </div>

          <div className="flex justify-between items-center">
            <div className="text-sm text-muted-foreground">
              Showing {rows.length} of {teachersQ.data?.length || 0} teachers
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => teachersQ.refetch()}
                disabled={anyBusy || teachersQ.isLoading}
                className="gap-2"
              >
                <RefreshCw className={`h-4 w-4 ${teachersQ.isLoading ? "animate-spin" : ""}`} />
                Refresh
              </Button>

              <Button
                variant="ghost"
                onClick={() => {
                  setQ("");
                  setStatus("all");
                }}
              >
                Clear
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Loading */}
      {teachersQ.isLoading && (
        <div className="space-y-4">
          <div className="text-center py-8">
            <div className="inline-flex items-center justify-center p-3 rounded-full bg-muted mb-4">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
            <h3 className="font-semibold">Loading Teachers</h3>
            <p className="text-muted-foreground">Fetching teacher users…</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-56 w-full rounded-xl" />
            ))}
          </div>
        </div>
      )}

      {/* Error */}
      {teachersQ.isError && (
        <Card className="border-destructive/20">
          <CardContent className="p-8 text-center">
            <div className="mx-auto w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
              <AlertCircle className="h-7 w-7 text-destructive" />
            </div>
            <h3 className="font-semibold text-lg">Failed to Load Teachers</h3>
            <p className="text-muted-foreground mt-2 max-w-md mx-auto">
              {teachersQ.error?.response?.data?.message ||
                teachersQ.error?.message ||
                "Unknown error"}
            </p>
            <div className="flex gap-2 justify-center mt-6">
              <Button variant="outline" onClick={() => teachersQ.refetch()} className="gap-2">
                <RefreshCw className="h-4 w-4" />
                Try Again
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Grid */}
      {!teachersQ.isLoading && !teachersQ.isError && (
        <>
          {rows.length === 0 ? (
            <Card>
              <CardContent className="p-12 text-center">
                <div className="mx-auto w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                  <Users className="h-8 w-8 text-muted-foreground" />
                </div>
                <h3 className="font-semibold text-lg">No Teachers Found</h3>
                <p className="text-muted-foreground mt-2 max-w-md mx-auto">
                  {q || status !== "all"
                    ? "No teachers match your filters."
                    : "No teachers created yet. Add your first teacher."}
                </p>
                <Button onClick={() => setDrawerOpen(true)} className="mt-4 gap-2">
                  <Plus className="h-4 w-4" />
                  Add Teacher
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {rows.map((u) => {
                const name = teacherName(u);
                const email = teacherEmail(u);
                const active = isActiveTeacher(u);
                const rowBusy = deactMut.isPending || actMut.isPending;

                return (
                  <Card key={u.id} className="group hover:shadow-lg transition-shadow">
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div
                            className={`p-2 rounded-full ${
                              active ? "bg-green-100 dark:bg-green-900/30" : "bg-muted"
                            }`}
                          >
                            <User
                              className={`h-5 w-5 ${
                                active
                                  ? "text-green-600 dark:text-green-400"
                                  : "text-muted-foreground"
                              }`}
                            />
                          </div>
                          <div>
                            <CardTitle className="text-lg font-semibold line-clamp-1">
                              {name}
                            </CardTitle>
                            <div className="flex items-center gap-2 mt-1">
                              <Badge
                                variant={active ? "secondary" : "outline"}
                                className="gap-1 text-xs"
                              >
                                {active ? (
                                  <>
                                    <UserCheck className="h-3 w-3" />
                                    Active
                                  </>
                                ) : (
                                  <>
                                    <UserX className="h-3 w-3" />
                                    Inactive
                                  </>
                                )}
                              </Badge>
                              <Badge variant="outline" className="text-xs">
                                TEACHER
                              </Badge>
                            </div>
                          </div>
                        </div>

                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem asChild>
                              <Link to={`/app/teachers/${u.id}`}>
                                <Eye className="h-4 w-4 mr-2" />
                                View Details
                              </Link>
                            </DropdownMenuItem>

                            <DropdownMenuItem asChild>
                              <Link to="/app/settings?tab=users">
                                <Shield className="h-4 w-4 mr-2" />
                                Users & Roles
                              </Link>
                            </DropdownMenuItem>

                            <Separator className="my-1" />

                            {active ? (
                              <DropdownMenuItem
                                onClick={() => {
                                  if (confirm(`Deactivate ${name}?`)) deactMut.mutate(u.id);
                                }}
                                disabled={rowBusy}
                                className="text-destructive"
                              >
                                <UserX className="h-4 w-4 mr-2" />
                                Deactivate
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem
                                onClick={() => {
                                  if (confirm(`Activate ${name}?`)) actMut.mutate(u.id);
                                }}
                                disabled={rowBusy}
                              >
                                <UserCheck className="h-4 w-4 mr-2" />
                                Activate
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </CardHeader>

                    <CardContent>
                      <Separator className="mb-4" />

                      <div className="space-y-3">
                        <div className="flex items-start gap-2">
                          <Mail className="h-4 w-4 text-muted-foreground mt-0.5" />
                          <div className="flex-1">
                            <p className="text-sm text-muted-foreground">Email</p>
                            <p className="text-sm font-medium truncate">{email || "Not set"}</p>
                          </div>
                          {email ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={async () => {
                                const ok = await copyToClipboard(email);
                                ok ? toast.success("Email copied") : toast.error("Copy failed");
                              }}
                              title="Copy email"
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                          ) : null}
                        </div>

                        {!!u?.phone && (
                          <div className="flex items-start gap-2">
                            <Phone className="h-4 w-4 text-muted-foreground mt-0.5" />
                            <div className="flex-1">
                              <p className="text-sm text-muted-foreground">Phone</p>
                              <p className="text-sm font-medium">{u.phone}</p>
                            </div>
                          </div>
                        )}
                      </div>

                      <Separator className="my-4" />

                      <div className="flex gap-2">
                        <Button
                          asChild
                          variant="outline"
                          size="sm"
                          className="flex-1"
                          disabled={rowBusy}
                        >
                          <Link to="/app/settings?tab=users" className="flex items-center justify-center gap-1">
                            <Shield className="h-3 w-3" />
                            Users
                          </Link>
                        </Button>

                        {active ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex-1 gap-2"
                            disabled={rowBusy}
                            onClick={() => {
                              if (confirm(`Deactivate ${name}?`)) deactMut.mutate(u.id);
                            }}
                          >
                            {deactMut.isPending ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <UserX className="h-3 w-3" />
                            )}
                            Deactivate
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            className="flex-1 gap-2"
                            disabled={rowBusy}
                            onClick={() => {
                              if (confirm(`Activate ${name}?`)) actMut.mutate(u.id);
                            }}
                          >
                            {actMut.isPending ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <UserCheck className="h-3 w-3" />
                            )}
                            Activate
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Create drawer */}
      <TeacherFormDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onCreated={(res) => {
          // ✅ expect drawer to pass back: { user, tempPassword }
          const user = res?.user || null;
          const tempPassword = res?.tempPassword || null;

          if (user && tempPassword) {
            setLastCreds({
              userId: user.id,
              email: user.email,
              tempPassword,
            });
          }

          setDrawerOpen(false);
          qc.invalidateQueries({ queryKey: ["teachers"] });
        }}
      />
    </div>
  );
}
