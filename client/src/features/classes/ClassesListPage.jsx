// client/src/features/classes/ClassesListPage.jsx
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { useMe } from "@/hooks/useMe";
import { api } from "@/api/axios";
import { useClasses } from "./classes.queries";
import ClassFormDrawer from "./ClassFormDrawer";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Search,
  Filter,
  Plus,
  Calendar,
  Users,
  RefreshCw,
  BookOpen,
  ArrowRight,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";

function classLabel(c) {
  const s = c.stream ? ` ${c.stream}` : "";
  return `${c.name}${s}`.trim();
}

function capLabel(v) {
  if (v === null) return "Unlimited";
  if (v === undefined) return "—";
  return String(v);
}

export default function ClassesListPage() {
  const { data: meData, isLoading: meLoading } = useMe();

  // normalize role + tenant from /me (DB truth)
  const role = String(meData?.user?.role || meData?.role || "").toUpperCase();
  const tenantId = String(meData?.user?.schoolId || meData?.schoolId || "").trim();

  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [q, setQ] = useState("");

  const yearNum = year ? Number(year) : undefined;

  const { data, isLoading, isError, error, refetch } = useClasses(
    Number.isFinite(yearNum) ? yearNum : undefined
  );

  // ----------------------------
  // Subscription overview (limit-aware class creation)
  // ADMIN uses tenantId from /me, NOT localStorage
  // ----------------------------
  const subQ = useQuery({
    queryKey: ["subscription-overview", "classes", tenantId || "NO_TENANT"],
    queryFn: async () => {
      const { data } = await api.get("/api/settings/subscription/overview");
      return data;
    },
    enabled: role === "ADMIN" && !!tenantId, // ✅ now valid
    retry: false,
    staleTime: 30 * 1000,
  });

  const sub = subQ.data?.subscription || null;
  const atLimit = subQ.data?.atLimit || {};
  const flags = subQ.data?.flags || {};
  const usage = subQ.data?.usage || {};

  const canWrite = !!flags.canWrite;
  const classesAtLimit = !!atLimit.classes;

  const canCreateClass = role === "ADMIN" && !!tenantId && canWrite && !classesAtLimit;

  const createBlockedMsg = useMemo(() => {
    if (role !== "ADMIN") return null;

    if (!tenantId) return "School context missing — your account is not linked to a school.";
    if (subQ.isLoading) return "Checking plan limits…";
    if (subQ.isError) return "Could not load plan limits. Try refresh.";
    if (!canWrite) return "Your subscription is read-only. Renew or upgrade to add classes.";

    if (classesAtLimit) {
      const used = usage.classesCount ?? "—";
      const cap = sub?.maxClasses ?? "—";
      return `Class limit reached (${used}/${cap}). Upgrade to add more classes.`;
    }

    return null;
  }, [
    role,
    tenantId,
    subQ.isLoading,
    subQ.isError,
    canWrite,
    classesAtLimit,
    usage.classesCount,
    sub?.maxClasses,
  ]);

  const rows = useMemo(() => {
    const list = Array.isArray(data) ? data : [];
    const needle = q.trim().toLowerCase();
    if (!needle) return list;

    return list.filter((c) => {
      const txt = `${c.name} ${c.stream || ""} ${c.year}`.toLowerCase();
      return txt.includes(needle);
    });
  }, [data, q]);

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

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <BookOpen className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Classes</h1>
              <p className="text-muted-foreground">
                Browse and manage academic classes {role === "ADMIN" ? "across all years" : "for your school"}
              </p>
            </div>
          </div>
        </div>

        {role === "ADMIN" && (
          <div className="flex flex-col items-start md:items-end gap-2">
            <ClassFormDrawer defaultYear={Number(year) || new Date().getFullYear()}>
              <Button
                disabled={!canCreateClass}
                onClick={(e) => {
                  if (!canCreateClass) {
                    e.preventDefault();
                    toast.error(createBlockedMsg || "Class creation is blocked.");
                  }
                }}
                className="gap-2"
              >
                <Plus className="h-4 w-4" />
                Create Class
              </Button>
            </ClassFormDrawer>

            {!canCreateClass && (
              <div className="text-xs text-muted-foreground text-left md:text-right max-w-xs">
                <span className="inline-flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {createBlockedMsg || "Class creation is currently blocked."}
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
          <CardDescription>Find classes by year and name</CardDescription>
        </CardHeader>
        
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Year Filter */}
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-2">
                <Calendar className="h-3 w-3" />
                Academic Year
              </label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="number"
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  placeholder="Enter year (e.g., 2026)"
                  className="pl-9"
                />
              </div>
            </div>

            {/* Search */}
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-2">
                <Search className="h-3 w-3" />
                Search Classes
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search by class name or stream..."
                  className="pl-9"
                />
              </div>
            </div>

            {/* Actions */}
            <div className="space-y-2">
              <label className="text-sm font-medium opacity-0">Actions</label>
              <div className="flex gap-2">
                <Button 
                  variant="outline" 
                  onClick={() => refetch()}
                  className="flex-1 gap-2"
                >
                  <RefreshCw className="h-4 w-4" />
                  Refresh
                </Button>
                
                <Button 
                  variant="ghost" 
                  onClick={() => {
                    setYear(String(new Date().getFullYear()));
                    setQ("");
                  }}
                  className="gap-2"
                >
                  Clear
                </Button>
              </div>
            </div>
          </div>
          
          {/* Quick Year Tabs */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Recent Years</label>
            <Tabs defaultValue={year} onValueChange={setYear}>
              <TabsList className="w-full md:w-auto">
                <TabsTrigger value={String(new Date().getFullYear() + 1)}>
                  {new Date().getFullYear() + 1}
                </TabsTrigger>
                <TabsTrigger value={String(new Date().getFullYear())}>
                  {new Date().getFullYear()}
                </TabsTrigger>
                <TabsTrigger value={String(new Date().getFullYear() - 1)}>
                  {new Date().getFullYear() - 1}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </CardContent>
      </Card>

      {/* Results Header */}
      {!isLoading && !isError && (
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold">Classes</h2>
            <p className="text-sm text-muted-foreground">
              {rows.length} {rows.length === 1 ? 'class' : 'classes'} found for{" "}
              <span className="font-medium">{year || "all years"}</span>
            </p>
          </div>
          
          {rows.length > 0 && (
            <Badge variant="outline" className="gap-1">
              <Users className="h-3 w-3" />
              {rows.length} Total
            </Badge>
          )}
        </div>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="space-y-4">
          <div className="text-center py-8">
            <div className="inline-flex items-center justify-center p-3 rounded-full bg-muted mb-4">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
            <h3 className="font-semibold">Loading Classes</h3>
            <p className="text-muted-foreground">Fetching class data...</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-56 w-full rounded-xl" />
            ))}
          </div>
        </div>
      )}

      {/* Error State */}
      {isError && (
        <Card className="border-destructive/20">
          <CardContent className="p-8 text-center">
            <div className="mx-auto w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
              <AlertCircle className="h-7 w-7 text-destructive" />
            </div>
            <h3 className="font-semibold text-lg">Failed to Load Classes</h3>
            <p className="text-muted-foreground mt-2 max-w-md mx-auto">
              {error?.response?.data?.message || error?.message || "An unknown error occurred"}
            </p>
            <div className="flex gap-2 justify-center mt-6">
              <Button variant="outline" onClick={() => refetch()} className="gap-2">
                <RefreshCw className="h-4 w-4" />
                Try Again
              </Button>
              <Button 
                variant="ghost" 
                onClick={() => window.location.reload()}
              >
                Reload Page
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Classes Grid */}
      {!isLoading && !isError && (
        <>
          {rows.length === 0 ? (
            <Card>
              <CardContent className="p-12 text-center">
                <div className="mx-auto w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                  <BookOpen className="h-8 w-8 text-muted-foreground" />
                </div>
                <h3 className="font-semibold text-lg">No Classes Found</h3>
                <p className="text-muted-foreground mt-2 max-w-md mx-auto">
                  {q 
                    ? "No classes match your search criteria. Try a different search term."
                    : `No classes found for the year ${year}. Try a different year or create a new class.`
                  }
                </p>
                {role === "ADMIN" && canCreateClass && (
                  <ClassFormDrawer defaultYear={Number(year) || new Date().getFullYear()}>
                    <Button className="mt-4 gap-2">
                      <Plus className="h-4 w-4" />
                      Create First Class
                    </Button>
                  </ClassFormDrawer>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {rows.map((c) => (
                <Link key={c.id} to={`/app/classes/${c.id}`} className="block group">
                  <Card className="h-full hover:shadow-lg transition-all duration-200 border-border group-hover:border-primary/30">
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <CardTitle className="text-lg font-semibold line-clamp-1">
                            {c.name}
                          </CardTitle>
                          {c.stream && (
                            <p className="text-sm text-muted-foreground mt-1">
                              Stream: {c.stream}
                            </p>
                          )}
                        </div>
                        <Badge variant="secondary" className="gap-1">
                          <Calendar className="h-3 w-3" />
                          {c.year}
                        </Badge>
                      </div>
                    </CardHeader>
                    
                    <CardContent>
                      <Separator className="mb-4" />
                      
                      <div className="space-y-3">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Class Code</span>
                          <span className="font-mono font-medium bg-muted px-2 py-1 rounded text-xs">
                            {c.code || "N/A"}
                          </span>
                        </div>
                        
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Status</span>
                          <Badge variant={c.isActive ? "success" : "secondary"}>
                            {c.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </div>
                        
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Students</span>
                          <div className="flex items-center gap-1">
                            <Users className="h-3 w-3" />
                            <span className="font-medium">
                              {c._count?.students || 0}
                            </span>
                          </div>
                        </div>
                      </div>
                      
                      <div className="mt-6 pt-4 border-t">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">View Details</span>
                          <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-1 transition-transform" />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}