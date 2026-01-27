// client/src/features/settings/subs/SubscriptionLimitsTab.jsx
import { useMemo, useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { api } from "@/api/axios";
import { useMe } from "@/hooks/useMe";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";

function capLabel(cap) {
  return cap === null ? "Unlimited" : String(cap ?? "-");
}

function remainingLabel(rem) {
  return rem === null ? "—" : String(rem ?? "-");
}

function fmtDate(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric"
    });
  } catch {
    return String(d);
  }
}

function toDateTimeLocalValue(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function buildSchoolHeaders({ isSystemAdmin, schoolId }) {
  const sid = String(schoolId || "").trim();
  if (isSystemAdmin && sid) return { "x-school-id": sid };
  return undefined;
}

const STATUS_OPTIONS = ["TRIAL", "ACTIVE", "PAST_DUE", "CANCELED", "EXPIRED"];

const ENTITLEMENTS = [
  { key: "EXAMS_READ", group: "Academics", desc: "View exams module" },
  { key: "EXAMS_WRITE", group: "Academics", desc: "Create/edit exams and marks" },
  { key: "RESULTS_READ", group: "Academics", desc: "View results" },
  { key: "RESULTS_WRITE", group: "Academics", desc: "Publish/edit results" },
  { key: "STUDENTS_READ", group: "School Data", desc: "View students" },
  { key: "STUDENTS_WRITE", group: "School Data", desc: "Create/edit students" },
  { key: "CLASSES_READ", group: "School Data", desc: "View classes" },
  { key: "CLASSES_WRITE", group: "School Data", desc: "Create/edit classes" },
  { key: "TEACHERS_READ", group: "School Data", desc: "View teachers" },
  { key: "TEACHERS_WRITE", group: "School Data", desc: "Create/edit teachers" },
  { key: "ATTENDANCE_READ", group: "Attendance", desc: "View attendance" },
  { key: "ATTENDANCE_WRITE", group: "Attendance", desc: "Take/modify attendance" },
  { key: "FEES_READ", group: "Finance", desc: "View fees" },
  { key: "FEES_WRITE", group: "Finance", desc: "Post payments, invoices" },
  { key: "FEES_REFUND", group: "Finance", desc: "Reverse/refund payments" },
  { key: "REPORTS_READ", group: "Reports", desc: "View reports" },
  { key: "REPORTS_EXPORT", group: "Reports", desc: "Export/print reports" },
  { key: "USERS_MANAGE", group: "Admin", desc: "Create/manage users" },
  { key: "AUDIT_LOG_READ", group: "Ops", desc: "View audit logs" },
  { key: "BACKUPS_RESTORE", group: "Ops", desc: "Backups and restore" },
];

const PLAN_PRESETS = {
  FREE: ["EXAMS_READ", "RESULTS_READ"],
  BASIC: ["EXAMS_READ", "RESULTS_READ", "ATTENDANCE_READ", "FEES_READ"],
  PRO: [
    "EXAMS_READ",
    "EXAMS_WRITE",
    "RESULTS_READ",
    "RESULTS_WRITE",
    "ATTENDANCE_READ",
    "ATTENDANCE_WRITE",
    "FEES_READ",
    "FEES_WRITE",
    "REPORTS_READ",
    "REPORTS_EXPORT",
  ],
  ENTERPRISE: ENTITLEMENTS.map((x) => x.key),
};

async function fetchSubscriptionOverview({ schoolId, isSystemAdmin }) {
  const headers = buildSchoolHeaders({ isSystemAdmin, schoolId });
  const { data } = await api.get("/api/settings/subscription/overview", { headers });
  return data;
}

async function patchSubscription({ schoolId, isSystemAdmin, payload }) {
  const headers = buildSchoolHeaders({ isSystemAdmin, schoolId });
  const { data } = await api.patch("/api/settings/subscription", payload, { headers });
  return data;
}

async function patchLimits({ schoolId, isSystemAdmin, limits }) {
  const headers = buildSchoolHeaders({ isSystemAdmin, schoolId });
  const { data } = await api.patch("/api/settings/subscription/limits", { limits }, { headers });
  return data;
}

async function patchEntitlements({ schoolId, isSystemAdmin, entitlements }) {
  const headers = buildSchoolHeaders({ isSystemAdmin, schoolId });
  const { data } = await api.patch(
    "/api/settings/subscription/entitlements",
    { entitlements },
    { headers }
  );
  return data;
}

function ProgressBar({ percent }) {
  if (percent == null) return null;
  const p = Math.max(0, Math.min(100, Number(percent) || 0));
  return (
    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
      <div className="h-full bg-primary transition-all" style={{ width: `${p}%` }} />
    </div>
  );
}

function severityFrom({ percent, atLimit }) {
  const p = percent == null ? null : Number(percent);
  if (atLimit) return "danger";
  if (p != null && p >= 90) return "danger";
  if (p != null && p >= 80) return "warn";
  return "ok";
}

function badgeForSeverity(sev) {
  return sev === "danger" ? "destructive" : sev === "warn" ? "secondary" : "outline";
}

function UsageCard({ title, used, cap, remaining, percent, atLimit }) {
  const sev = severityFrom({ percent, atLimit });
  const badgeVariant = badgeForSeverity(sev);

  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">{title}</div>
          <Badge variant={badgeVariant} className="text-xs">
            {cap === null ? "Unlimited" : `${used}/${cap}`}
          </Badge>
        </div>

        <div className="text-2xl font-semibold">{used ?? 0}</div>

        <div className="text-sm">
          <div className="text-muted-foreground">Cap: {capLabel(cap)}</div>
          <div className="text-muted-foreground">Remaining: {remainingLabel(remaining)}</div>
        </div>

        <ProgressBar percent={percent} />

        {sev !== "ok" && (
          <div className="text-xs text-muted-foreground">
            {sev === "danger"
              ? "At or near limit — new records may be blocked"
              : "Approaching limit"}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function UpgradePressureCard({ isSystemAdmin, flags, percent, atLimit, sub }) {
  if (isSystemAdmin) return null;

  const canWrite = !!flags?.canWrite;
  const isExpired = !!flags?.isExpired;

  if (canWrite && !isExpired) return null;

  const headline = !canWrite || isExpired
    ? "Subscription is blocking changes"
    : "You've hit or are about to hit a limit";

  const msg = !canWrite || isExpired
    ? "Creating new records may be blocked until the subscription is active again."
    : "Some creates may fail. Consider upgrading to avoid interruptions.";

  return (
    <Card className="border-destructive/20">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="font-medium">{headline}</div>
          <Badge variant="destructive" className="text-xs">
            {String(sub?.planCode || "-").toUpperCase()}
          </Badge>
        </div>

        <div className="text-sm text-muted-foreground">{msg}</div>

        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => {
              alert("Upgrade request sent.");
            }}
          >
            Request Upgrade
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function SubscriptionLimitsTab() {
  const meQ = useMe();
  const role = String(meQ?.data?.user?.role || "").toUpperCase();
  const isSystemAdmin = role === "SYSTEM_ADMIN";

  const LS_KEY = "sysadmin.schoolId";
  const [schoolId, setSchoolId] = useState(() => localStorage.getItem(LS_KEY) || "");
  const [schoolIdDraft, setSchoolIdDraft] = useState(() => localStorage.getItem(LS_KEY) || "");

  const canFetch = !isSystemAdmin || !!schoolId.trim();

  const q = useQuery({
    queryKey: ["settings-subscription-overview", isSystemAdmin ? schoolId.trim() : "TENANT"],
    queryFn: () => fetchSubscriptionOverview({ schoolId: schoolId.trim(), isSystemAdmin }),
    enabled: canFetch,
    retry: false,
  });

  const commitSchool = () => {
    const v = String(schoolIdDraft || "").trim();
    if (!v) return;
    setSchoolId(v);
    localStorage.setItem(LS_KEY, v);
    q.refetch();
  };

  const clearSchool = () => {
    setSchoolId("");
    setSchoolIdDraft("");
    localStorage.removeItem(LS_KEY);
  };

  const sub = q.data?.subscription || null;
  const usage = q.data?.usage || {};
  const remaining = q.data?.remaining || {};
  const percent = q.data?.percent || {};
  const atLimit = q.data?.atLimit || {};
  const flags = q.data?.flags || {};

  const status = String(sub?.status || "NONE").toUpperCase();
  const isExpired = !!flags.isExpired;
  const canWrite = !!flags.canWrite;

  const canEditMeta = isSystemAdmin;
  const canEditLimitsAndEntitlements = isSystemAdmin && canWrite;

  const enabledEntitlements = useMemo(() => {
    const ent = sub?.entitlements && typeof sub.entitlements === "object" ? sub.entitlements : {};
    return Object.entries(ent)
      .filter(([, v]) => !!v)
      .map(([k]) => k)
      .sort();
  }, [sub]);

  const [planDraft, setPlanDraft] = useState("");
  const [statusDraft, setStatusDraft] = useState("TRIAL");
  const [expiryDraft, setExpiryDraft] = useState("");
  const [limitsDraft, setLimitsDraft] = useState({
    STUDENTS_MAX: "",
    TEACHERS_MAX: "",
    CLASSES_MAX: "",
    USERS_MAX: "",
  });

  const [entDraft, setEntDraft] = useState({});
  const [newEntKey, setNewEntKey] = useState("");
  const [entSearch, setEntSearch] = useState("");
  const [showEnabledOnly, setShowEnabledOnly] = useState(false);

  const entMeta = useMemo(() => {
    const map = new Map(ENTITLEMENTS.map((x) => [x.key, x]));
    return map;
  }, []);

  useEffect(() => {
    if (!sub) return;

    setPlanDraft(String(sub.planCode || ""));
    setStatusDraft(String(sub.status || "TRIAL").toUpperCase());
    setExpiryDraft(toDateTimeLocalValue(sub.currentPeriodEnd));

    const currentLimitsObj = sub?.limits && typeof sub.limits === "object" ? sub.limits : null;

    const studentsMax = currentLimitsObj?.STUDENTS_MAX ?? sub.maxStudents ?? "";
    const teachersMax = currentLimitsObj?.TEACHERS_MAX ?? sub.maxTeachers ?? "";
    const classesMax = currentLimitsObj?.CLASSES_MAX ?? sub.maxClasses ?? "";
    const usersMax =
      currentLimitsObj?.USERS_MAX ??
      (Object.prototype.hasOwnProperty.call(sub || {}, "maxUsers") ? sub.maxUsers : "") ??
      "";

    setLimitsDraft({
      STUDENTS_MAX: studentsMax === null ? "null" : String(studentsMax ?? ""),
      TEACHERS_MAX: teachersMax === null ? "null" : String(teachersMax ?? ""),
      CLASSES_MAX: classesMax === null ? "null" : String(classesMax ?? ""),
      USERS_MAX: usersMax === null ? "null" : String(usersMax ?? ""),
    });

    const ent = sub?.entitlements && typeof sub.entitlements === "object" ? sub.entitlements : {};
    setEntDraft(ent);
  }, [
    sub?.planCode,
    sub?.status,
    sub?.currentPeriodEnd,
    sub?.maxStudents,
    sub?.maxTeachers,
    sub?.maxClasses,
    sub?.maxUsers,
    sub?.limits,
    sub?.entitlements,
  ]);

  const errMsg =
    q.isError ? q.error?.response?.data?.message || "Failed to load subscription overview." : null;

  const mPatchSub = useMutation({
    mutationFn: (payload) => patchSubscription({ schoolId: schoolId.trim(), isSystemAdmin, payload }),
    onSuccess: () => q.refetch(),
  });

  const mPatchLimits = useMutation({
    mutationFn: (limits) => patchLimits({ schoolId: schoolId.trim(), isSystemAdmin, limits }),
    onSuccess: () => q.refetch(),
  });

  const mPatchEnt = useMutation({
    mutationFn: (entitlements) =>
      patchEntitlements({ schoolId: schoolId.trim(), isSystemAdmin, entitlements }),
    onSuccess: () => q.refetch(),
  });

  function parseLimitInput(v) {
    const s = String(v ?? "").trim();
    if (!s) return undefined;
    if (s.toLowerCase() === "null") return null;
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0) return "INVALID";
    return Math.floor(n);
  }

  function savePlanStatusExpiry() {
    if (!canEditMeta) return;

    const payload = {};
    const p = String(planDraft || "").trim();
    if (p) payload.planCode = p.toUpperCase();

    const st = String(statusDraft || "").trim().toUpperCase();
    if (st) payload.status = st;

    payload.currentPeriodEnd = expiryDraft ? new Date(expiryDraft).toISOString() : null;

    mPatchSub.mutate(payload);
  }

  function saveLimits() {
    if (!canEditLimitsAndEntitlements) return;

    const next = {};
    for (const key of ["STUDENTS_MAX", "TEACHERS_MAX", "CLASSES_MAX", "USERS_MAX"]) {
      const parsed = parseLimitInput(limitsDraft[key]);
      if (parsed === "INVALID") {
        alert(`Invalid ${key}. Use a number >= 0, "null", or blank.`);
        return;
      }
      if (parsed !== undefined) next[key] = parsed;
    }

    if (Object.keys(next).length === 0) return;
    mPatchLimits.mutate(next);
  }

  function toggleEntitlement(key) {
    setEntDraft((prev) => ({ ...(prev || {}), [key]: !prev?.[key] }));
  }

  function addEntitlement() {
    const k = String(newEntKey || "").trim().toUpperCase();
    if (!k) return;

    if (!/^[A-Z0-9_]{3,64}$/.test(k)) {
      alert("Invalid key. Use A–Z, 0–9, underscore. Length 3–64.");
      return;
    }

    setEntDraft((prev) => ({ ...(prev || {}), [k]: true }));
    setNewEntKey("");
  }

  function saveEntitlements() {
    if (!canEditLimitsAndEntitlements) return;
    mPatchEnt.mutate(entDraft || {});
  }

  const entKeys = useMemo(() => {
    const inCatalog = ENTITLEMENTS.map((x) => x.key);
    const inDb = Object.keys(entDraft || {});
    return Array.from(new Set([...inCatalog, ...inDb])).sort();
  }, [entDraft]);

  const filteredEntKeys = useMemo(() => {
    const q = String(entSearch || "").trim().toUpperCase();
    return entKeys.filter((k) => {
      const v = !!entDraft?.[k];
      if (showEnabledOnly && !v) return false;
      if (!q) return true;
      const meta = entMeta.get(k);
      const g = String(meta?.group || "OTHER").toUpperCase();
      const d = String(meta?.desc || "").toUpperCase();
      return k.includes(q) || g.includes(q) || d.includes(q);
    });
  }, [entKeys, entDraft, entSearch, showEnabledOnly, entMeta]);

  const entGroups = useMemo(() => {
    const groups = new Map();
    for (const k of filteredEntKeys) {
      const g = entMeta.get(k)?.group || "Other";
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(k);
    }
    return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredEntKeys, entMeta]);

  function setMany(keys, value) {
    setEntDraft((prev) => {
      const next = { ...(prev || {}) };
      for (const k of keys) next[k] = !!value;
      return next;
    });
  }

  function clearAllCatalogKeys() {
    setEntDraft((prev) => {
      const next = { ...(prev || {}) };
      for (const k of ENTITLEMENTS.map((x) => x.key)) next[k] = false;
      return next;
    });
  }

  function enableAllReads() {
    const reads = entKeys.filter((k) => k.endsWith("_READ"));
    setMany(reads, true);
  }

  function applyPreset(planCode) {
    const p = String(planCode || "").trim().toUpperCase();
    const keys = PLAN_PRESETS[p] || [];
    setEntDraft((prev) => {
      const next = { ...(prev || {}) };
      for (const k of ENTITLEMENTS.map((x) => x.key)) next[k] = false;
      for (const k of keys) next[k] = true;
      return next;
    });
  }

  if (meQ?.isLoading) return (
    <div className="flex items-center justify-center min-h-[200px]">
      <div className="text-muted-foreground">Loading...</div>
    </div>
  );

  if (isSystemAdmin && !schoolId.trim()) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold">Subscription Management</h2>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant="outline" className="font-normal">SYSTEM_ADMIN</Badge>
          </div>
        </div>

        <Card>
          <CardContent className="pt-6">
            <div className="space-y-4">
              <div>
                <h3 className="font-medium mb-2">Select a School</h3>
                <p className="text-sm text-muted-foreground">
                  Enter a school ID to manage its subscription and limits.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  value={schoolIdDraft}
                  onChange={(e) => setSchoolIdDraft(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && commitSchool()}
                  placeholder="School ID (cuid)"
                />
                <div className="flex gap-2">
                  <Button onClick={commitSchool} disabled={!String(schoolIdDraft || "").trim()}>
                    Load School
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (q.isLoading) return (
    <div className="flex items-center justify-center min-h-[200px]">
      <div className="text-muted-foreground">Loading subscription data...</div>
    </div>
  );

  if (q.isError) {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="pt-6 text-center">
            <div className="text-lg font-medium mb-2">Failed to load subscription</div>
            <div className="text-muted-foreground mb-4">
              {errMsg}
            </div>
            <div className="flex justify-center gap-2">
              <Button variant="outline" onClick={() => q.refetch()}>
                Try Again
              </Button>
              {isSystemAdmin && (
                <Button onClick={clearSchool}>Change School</Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const usedStudents = usage.studentsCount ?? 0;
  const usedTeachers = usage.teachersCount ?? 0;
  const usedClasses = usage.classesCount ?? 0;
  const usedUsers = usage.usersCount ?? 0;

  const capStudents = sub?.maxStudents ?? null;
  const capTeachers = sub?.maxTeachers ?? null;
  const capClasses = sub?.maxClasses ?? null;
  const capUsers =
    Object.prototype.hasOwnProperty.call(sub || {}, "maxUsers")
      ? sub?.maxUsers ?? null
      : (sub?.limits && typeof sub.limits === "object" ? sub.limits.USERS_MAX : null) ?? null;

  const enabledCount = entKeys.filter((k) => !!entDraft?.[k]).length;
  const totalCount = entKeys.length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Subscription & Limits</h2>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant={canWrite ? "default" : "secondary"} className="font-normal">
              {canWrite ? "Active" : "Read Only"}
            </Badge>
            <Badge variant="outline" className="font-normal">
              {isSystemAdmin ? "SYSTEM_ADMIN" : "TENANT"}
            </Badge>
            {isExpired && (
              <Badge variant="destructive" className="font-normal">Expired</Badge>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isSystemAdmin && (
            <div className="flex items-center gap-2">
              <Input
                className="w-48"
                value={schoolIdDraft}
                onChange={(e) => setSchoolIdDraft(e.target.value)}
                placeholder="School ID"
              />
              <Button size="sm" onClick={commitSchool}>Load</Button>
            </div>
          )}
          <Button size="sm" variant="outline" onClick={() => q.refetch()}>
            Refresh
          </Button>
        </div>
      </div>

      <UpgradePressureCard
        isSystemAdmin={isSystemAdmin}
        flags={flags}
        percent={percent}
        atLimit={atLimit}
        sub={sub}
      />

      {/* Overview */}
      <Card>
        <CardContent className="pt-6">
          <div className="space-y-6">
            <div>
              <h3 className="font-medium mb-3">Current Subscription</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <div className="text-muted-foreground">Plan</div>
                  <div className="font-medium">{sub?.planCode || "-"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Status</div>
                  <div className="font-medium">{status}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Expiry</div>
                  <div className="font-medium">{fmtDate(sub?.currentPeriodEnd)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Mode</div>
                  <div className="font-medium">{canWrite ? "Active" : "Read Only"}</div>
                </div>
              </div>
            </div>

            <Separator />

            <div>
              <h3 className="font-medium mb-3">Usage Overview</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <UsageCard
                  title="Students"
                  used={usedStudents}
                  cap={capStudents}
                  remaining={remaining.studentsRemaining}
                  percent={percent.students}
                  atLimit={atLimit.students}
                />
                <UsageCard
                  title="Teachers"
                  used={usedTeachers}
                  cap={capTeachers}
                  remaining={remaining.teachersRemaining}
                  percent={percent.teachers}
                  atLimit={atLimit.teachers}
                />
                <UsageCard
                  title="Classes"
                  used={usedClasses}
                  cap={capClasses}
                  remaining={remaining.classesRemaining}
                  percent={percent.classes}
                  atLimit={atLimit.classes}
                />
                <UsageCard
                  title="Users"
                  used={usedUsers}
                  cap={capUsers}
                  remaining={remaining.usersRemaining}
                  percent={percent.users}
                  atLimit={atLimit.users}
                />
              </div>
            </div>

            <Separator />

            <div>
              <h3 className="font-medium mb-2">Enabled Entitlements</h3>
              {enabledEntitlements.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {enabledEntitlements.map((k) => (
                    <Badge key={k} variant="outline" className="font-normal">
                      {k}
                    </Badge>
                  ))}
                </div>
              ) : (
                <div className="text-muted-foreground">No entitlements enabled</div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* SYSTEM_ADMIN controls */}
      {isSystemAdmin && (
        <div className="space-y-6">
          {/* Subscription Meta */}
          <Card>
            <CardContent className="pt-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium">Subscription Details</h3>
                  <Badge variant={canEditMeta ? "default" : "outline"} className="text-xs">
                    {canEditMeta ? "Editable" : "Locked"}
                  </Badge>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <div className="text-sm font-medium">Plan Code</div>
                    <Input
                      value={planDraft}
                      onChange={(e) => setPlanDraft(e.target.value)}
                      placeholder="FREE / BASIC / PRO"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="text-sm font-medium">Status</div>
                    <select
                      className="w-full border rounded-md h-10 px-3 bg-background text-sm"
                      value={statusDraft}
                      onChange={(e) => setStatusDraft(e.target.value)}
                    >
                      {STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-2">
                    <div className="text-sm font-medium">Expiry Date</div>
                    <Input
                      type="datetime-local"
                      value={expiryDraft}
                      onChange={(e) => setExpiryDraft(e.target.value)}
                    />
                  </div>
                </div>

                <Button onClick={savePlanStatusExpiry} disabled={mPatchSub.isPending}>
                  {mPatchSub.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Limits */}
          <Card>
            <CardContent className="pt-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium">Resource Limits</h3>
                  <Badge variant={canEditLimitsAndEntitlements ? "default" : "outline"} className="text-xs">
                    {canEditLimitsAndEntitlements ? "Editable" : "Locked"}
                  </Badge>
                </div>

                <div className="text-sm text-muted-foreground">
                  Enter numbers (≥ 0) or "null" for unlimited. Leave blank to keep current.
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {["STUDENTS_MAX", "TEACHERS_MAX", "CLASSES_MAX", "USERS_MAX"].map((k) => (
                    <div className="space-y-2" key={k}>
                      <div className="text-sm font-medium">{k}</div>
                      <Input
                        value={limitsDraft[k]}
                        onChange={(e) => setLimitsDraft((p) => ({ ...p, [k]: e.target.value }))}
                        placeholder="e.g. 500 or null"
                      />
                    </div>
                  ))}
                </div>

                <Button onClick={saveLimits} disabled={!canEditLimitsAndEntitlements || mPatchLimits.isPending}>
                  {mPatchLimits.isPending ? "Saving..." : "Save Limits"}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Entitlements */}
          <Card>
            <CardContent className="pt-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium">Entitlements</h3>
                  <Badge variant={canEditLimitsAndEntitlements ? "default" : "outline"} className="text-xs">
                    {canEditLimitsAndEntitlements ? "Editable" : "Locked"}
                  </Badge>
                </div>

                <div className="flex items-center justify-between">
                  <div className="text-sm">
                    Enabled: <span className="font-medium">{enabledCount}</span> of {totalCount}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={enableAllReads}
                    >
                      Enable All Read
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setShowEnabledOnly(!showEnabledOnly)}
                    >
                      {showEnabledOnly ? "Show All" : "Show Enabled"}
                    </Button>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-2">
                  <Input
                    value={entSearch}
                    onChange={(e) => setEntSearch(e.target.value)}
                    placeholder="Search entitlements..."
                    className="flex-1"
                  />
                  <div className="flex gap-2">
                    {Object.keys(PLAN_PRESETS).map((p) => (
                      <Button
                        key={p}
                        size="sm"
                        variant="outline"
                        onClick={() => applyPreset(p)}
                      >
                        {p}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="space-y-4">
                  {entGroups.map(([groupName, keys]) => (
                    <div key={groupName} className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-medium">{groupName}</h4>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setMany(keys, true)}
                          >
                            Enable All
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setMany(keys, false)}
                          >
                            Disable All
                          </Button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {keys.map((k) => {
                          const v = !!entDraft?.[k];
                          const meta = entMeta.get(k);
                          return (
                            <div
                              key={k}
                              className={`flex items-center justify-between p-3 rounded-md border cursor-pointer transition-colors ${
                                v ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
                              }`}
                              onClick={() => toggleEntitlement(k)}
                            >
                              <div>
                                <div className="font-medium">{k}</div>
                                {meta?.desc && (
                                  <div className="text-sm opacity-90">{meta.desc}</div>
                                )}
                              </div>
                              <div className={`h-4 w-4 rounded-full border ${v ? "bg-white" : ""}`} />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>

                <Button onClick={saveEntitlements} disabled={!canEditLimitsAndEntitlements || mPatchEnt.isPending}>
                  {mPatchEnt.isPending ? "Saving..." : "Save Entitlements"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}