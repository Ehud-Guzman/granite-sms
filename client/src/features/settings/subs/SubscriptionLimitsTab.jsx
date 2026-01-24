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
    return new Date(d).toLocaleString();
  } catch {
    return String(d);
  }
}

// For <input type="datetime-local">: needs "YYYY-MM-DDTHH:mm"
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

// IMPORTANT: match your Prisma enum
const STATUS_OPTIONS = ["TRIAL", "ACTIVE", "PAST_DUE", "CANCELED", "EXPIRED"];

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

export default function SubscriptionLimitsTab() {
  const meQ = useMe();
  const role = String(meQ?.data?.user?.role || "").toUpperCase();
  const isSystemAdmin = role === "SYSTEM_ADMIN";

  const LS_KEY = "sysadmin.schoolId";

  // Committed schoolId (controls the query)
  const [schoolId, setSchoolId] = useState(() => localStorage.getItem(LS_KEY) || "");
  // Draft input (typing here should never trigger fetch)
  const [schoolIdDraft, setSchoolIdDraft] = useState(() => localStorage.getItem(LS_KEY) || "");

  const canFetch = !isSystemAdmin || !!schoolId.trim();

  const q = useQuery({
    queryKey: ["settings-subscription-overview", isSystemAdmin ? schoolId.trim() : "TENANT"],
    queryFn: () =>
      fetchSubscriptionOverview({
        schoolId: schoolId.trim(),
        isSystemAdmin,
      }),
    enabled: canFetch,
    retry: false,
  });

  const commitSchool = () => {
    const v = String(schoolIdDraft || "").trim();
    if (!v) return;
    setSchoolId(v);
    localStorage.setItem(LS_KEY, v);
    // Query key changed; refetch happens automatically, but this makes it feel instant.
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
  const flags = q.data?.flags || {};
  const scope = q.data?.scope || (isSystemAdmin ? "SYSTEM_ADMIN" : "ADMIN");

  const status = String(sub?.status || "NONE").toUpperCase();
  const isExpired = !!flags.isExpired;

  // Backend signal: whether subscription allows writes (usually ACTIVE/TRIAL and not expired)
  const canWrite = !!flags.canWrite;

  // Split permission model (important)
  const canEditMeta = isSystemAdmin; // plan/status/expiry should be fixable even if writes are blocked
  const canEditLimitsAndEntitlements = isSystemAdmin && canWrite;

  const mode = canWrite ? "WRITE_ENABLED" : "READ_ONLY";

  const enabledEntitlements = useMemo(() => {
    const ent = sub?.entitlements && typeof sub.entitlements === "object" ? sub.entitlements : {};
    return Object.entries(ent)
      .filter(([, v]) => !!v)
      .map(([k]) => k)
      .sort();
  }, [sub]);

  // -----------------------------
  // SYSTEM_ADMIN edit state
  // -----------------------------
  const [planDraft, setPlanDraft] = useState("");
  const [statusDraft, setStatusDraft] = useState("TRIAL");
  const [expiryDraft, setExpiryDraft] = useState(""); // datetime-local
  const [limitsDraft, setLimitsDraft] = useState({
    STUDENTS_MAX: "",
    TEACHERS_MAX: "",
    CLASSES_MAX: "",
  });

  const [entDraft, setEntDraft] = useState({}); // key -> boolean
  const [newEntKey, setNewEntKey] = useState("");
  const [newEntVal, setNewEntVal] = useState(true);

  // Sync drafts when data changes
  useEffect(() => {
    if (!sub) return;

    setPlanDraft(String(sub.planCode || ""));
    setStatusDraft(String(sub.status || "TRIAL").toUpperCase());
    setExpiryDraft(toDateTimeLocalValue(sub.currentPeriodEnd));

    const currentLimitsObj =
      sub?.limits && typeof sub.limits === "object" ? sub.limits : null;

    // Prefer JSON limits if present; otherwise show legacy columns
    const studentsMax = currentLimitsObj?.STUDENTS_MAX ?? sub.maxStudents ?? "";
    const teachersMax = currentLimitsObj?.TEACHERS_MAX ?? sub.maxTeachers ?? "";
    const classesMax = currentLimitsObj?.CLASSES_MAX ?? sub.maxClasses ?? "";

    setLimitsDraft({
      STUDENTS_MAX: studentsMax === null ? "null" : String(studentsMax ?? ""),
      TEACHERS_MAX: teachersMax === null ? "null" : String(teachersMax ?? ""),
      CLASSES_MAX: classesMax === null ? "null" : String(classesMax ?? ""),
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
    sub?.limits,
    sub?.entitlements,
  ]);

  const errMsg =
    q.isError ? q.error?.response?.data?.message || "Failed to load subscription overview." : null;

  // -----------------------------
  // Mutations
  // -----------------------------
  const mPatchSub = useMutation({
    mutationFn: (payload) =>
      patchSubscription({
        schoolId: schoolId.trim(),
        isSystemAdmin,
        payload,
      }),
    onSuccess: () => q.refetch(),
  });

  const mPatchLimits = useMutation({
    mutationFn: (limits) =>
      patchLimits({
        schoolId: schoolId.trim(),
        isSystemAdmin,
        limits,
      }),
    onSuccess: () => q.refetch(),
  });

  const mPatchEnt = useMutation({
    mutationFn: (entitlements) =>
      patchEntitlements({
        schoolId: schoolId.trim(),
        isSystemAdmin,
        entitlements,
      }),
    onSuccess: () => q.refetch(),
  });

  function parseLimitInput(v) {
    // UI rules:
    // - "null" => unlimited
    // - "" => ignore (don’t send)
    // - number >= 0 => send as int
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

    // expiry: allow clearing -> null
    // only send if meta editable
    payload.currentPeriodEnd = expiryDraft ? new Date(expiryDraft).toISOString() : null;

    mPatchSub.mutate(payload);
  }

  function saveLimits() {
    if (!canEditLimitsAndEntitlements) return;

    const next = {};
    for (const key of ["STUDENTS_MAX", "TEACHERS_MAX", "CLASSES_MAX"]) {
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
    setEntDraft((prev) => ({
      ...(prev || {}),
      [key]: !prev?.[key],
    }));
  }

  function addEntitlement() {
    const k = String(newEntKey || "").trim().toUpperCase();
    if (!k) return;

    if (!/^[A-Z0-9_]{3,64}$/.test(k)) {
      alert("Invalid key. Use A–Z, 0–9, underscore. Length 3–64.");
      return;
    }

    setEntDraft((prev) => ({
      ...(prev || {}),
      [k]: !!newEntVal,
    }));
    setNewEntKey("");
    setNewEntVal(true);
  }

  function saveEntitlements() {
    if (!canEditLimitsAndEntitlements) return;
    mPatchEnt.mutate(entDraft || {});
  }

  // -----------------------------
  // UI gates
  // -----------------------------
  if (meQ?.isLoading) {
    return <div className="text-sm text-muted-foreground">Loading…</div>;
  }

  // SYSTEM_ADMIN: no school selected -> show selector UI only
  if (isSystemAdmin && !schoolId.trim()) {
    return (
      <div className="space-y-3 min-w-0">
        <div className="flex items-center gap-2">
          <div className="font-medium">Subscription & Limits</div>
          <Badge variant="outline" className="text-[10px] uppercase">
            SYSTEM_ADMIN
          </Badge>
        </div>

        <Card>
          <CardContent className="p-6 space-y-3">
            <div className="text-sm text-muted-foreground">
              Enter a <span className="font-medium">schoolId</span> then press{" "}
              <span className="font-medium">Load</span>.
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                value={schoolIdDraft}
                onChange={(e) => setSchoolIdDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitSchool();
                }}
                placeholder="Paste schoolId (cuid)"
              />

              <div className="flex gap-2">
                <Button onClick={commitSchool} disabled={!String(schoolIdDraft || "").trim()}>
                  Load
                </Button>
                <Button
                  variant="outline"
                  onClick={clearSchool}
                  disabled={!String(schoolIdDraft || "").trim()}
                >
                  Clear
                </Button>
              </div>
            </div>

            <div className="text-xs text-muted-foreground">
              Only loads when you click <span className="font-medium">Load</span> or press{" "}
              <span className="font-medium">Enter</span>.
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (q.isLoading) {
    return <div className="text-sm text-muted-foreground">Loading subscription…</div>;
  }

  if (q.isError) {
    return (
      <div className="text-sm text-destructive space-y-1">
        <div>{errMsg}</div>
        <div className="text-muted-foreground">
          Backend required:{" "}
          <span className="font-medium">GET /api/settings/subscription/overview</span>. For SYSTEM_ADMIN, ensure{" "}
          <span className="font-medium">x-school-id</span> is sent.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 min-w-0">
      {/* Header row */}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <div className="font-medium">Subscription & Limits</div>

          <Badge variant="secondary" className="text-[10px] uppercase">
            {mode}
          </Badge>

          <Badge variant="outline" className="text-[10px] uppercase">
            {scope}
          </Badge>

          {isSystemAdmin && schoolId ? (
            <Badge variant="outline" className="text-[10px] uppercase">
              SCHOOL: {schoolId}
            </Badge>
          ) : null}

          {isExpired ? (
            <Badge variant="destructive" className="text-[10px] uppercase">
              EXPIRED
            </Badge>
          ) : null}

          {isSystemAdmin ? (
            <Badge variant={canEditLimitsAndEntitlements ? "secondary" : "outline"} className="text-[10px] uppercase">
              {canEditLimitsAndEntitlements ? "LIMITS/ENT: EDIT" : "LIMITS/ENT: LOCKED"}
            </Badge>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2 justify-start lg:justify-end">
          {isSystemAdmin ? (
            <div className="flex flex-wrap items-center gap-2">
              <Input
                className="h-8 w-full sm:w-[320px]"
                value={schoolIdDraft}
                onChange={(e) => setSchoolIdDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitSchool();
                }}
                placeholder="schoolId"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={commitSchool}
                disabled={!String(schoolIdDraft || "").trim()}
                className="whitespace-nowrap"
              >
                Load
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={clearSchool}
                title="Clear selected school"
                className="whitespace-nowrap"
              >
                Clear
              </Button>
            </div>
          ) : null}

          <Button size="sm" variant="outline" onClick={() => q.refetch()} className="whitespace-nowrap">
            Refresh
          </Button>
        </div>
      </div>

      {/* Overview card */}
      <Card>
        <CardContent className="p-6 space-y-3 min-w-0">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="text-sm">
              Plan: <span className="font-medium">{sub?.planCode || "-"}</span>
            </div>
            <div className="text-sm">
              Status: <span className="font-medium">{status}</span>
            </div>
            <div className="text-sm">
              Expiry: <span className="font-medium">{fmtDate(sub?.currentPeriodEnd)}</span>
            </div>
          </div>

          <div className="text-xs text-muted-foreground">
            Caps are enforced server-side on create endpoints. Usage reflects the same rules.
          </div>

          <Separator />

          <div className="grid gap-3 sm:grid-cols-3">
            <Card>
              <CardContent className="p-4 space-y-1">
                <div className="text-xs text-muted-foreground">Students</div>
                <div className="text-2xl font-semibold">{usage.studentsCount ?? 0}</div>
                <div className="text-xs text-muted-foreground">
                  Cap: <span className="font-medium text-foreground">{capLabel(sub?.maxStudents)}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Remaining:{" "}
                  <span className="font-medium text-foreground">
                    {remainingLabel(remaining.studentsRemaining)}
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4 space-y-1">
                <div className="text-xs text-muted-foreground">Teachers</div>
                <div className="text-2xl font-semibold">{usage.teachersCount ?? 0}</div>
                <div className="text-xs text-muted-foreground">
                  Cap: <span className="font-medium text-foreground">{capLabel(sub?.maxTeachers)}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Remaining:{" "}
                  <span className="font-medium text-foreground">
                    {remainingLabel(remaining.teachersRemaining)}
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4 space-y-1">
                <div className="text-xs text-muted-foreground">Classes</div>
                <div className="text-2xl font-semibold">{usage.classesCount ?? 0}</div>
                <div className="text-xs text-muted-foreground">
                  Cap: <span className="font-medium text-foreground">{capLabel(sub?.maxClasses)}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Remaining:{" "}
                  <span className="font-medium text-foreground">
                    {remainingLabel(remaining.classesRemaining)}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>

          <Separator />

          <div className="space-y-2">
            <div className="text-sm font-medium">Entitlements (Enabled)</div>

            {enabledEntitlements.length ? (
              <div className="flex flex-wrap gap-2">
                {enabledEntitlements.map((k) => (
                  <Badge key={k} variant="outline" className="text-[10px] uppercase">
                    {k}
                  </Badge>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">No entitlements enabled.</div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* SYSTEM_ADMIN controls */}
      {isSystemAdmin ? (
        <div className="space-y-4">
          {/* Plan / Status / Expiry */}
          <Card>
            <CardContent className="p-6 space-y-4 min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-medium">Subscription Meta</div>
                <Badge variant={canEditMeta ? "secondary" : "outline"} className="text-[10px] uppercase">
                  {canEditMeta ? "EDITABLE" : "LOCKED"}
                </Badge>
              </div>

              <div className="text-sm text-muted-foreground">
                Meta is editable even when writes are blocked (use this to reactivate a tenant).
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">Plan Code</div>
                  <Input
                    value={planDraft}
                    onChange={(e) => setPlanDraft(e.target.value)}
                    placeholder="FREE / BASIC / PRO"
                    disabled={!canEditMeta || mPatchSub.isPending}
                  />
                </div>

                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">Status</div>
                  <select
                    className="w-full border rounded-md h-10 px-3 bg-background text-sm"
                    value={statusDraft}
                    onChange={(e) => setStatusDraft(e.target.value)}
                    disabled={!canEditMeta || mPatchSub.isPending}
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">Current Period End</div>
                  <Input
                    type="datetime-local"
                    value={expiryDraft}
                    onChange={(e) => setExpiryDraft(e.target.value)}
                    disabled={!canEditMeta || mPatchSub.isPending}
                  />
                  <div className="text-[11px] text-muted-foreground">Clear it (empty) to remove expiry.</div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={savePlanStatusExpiry} disabled={!canEditMeta || mPatchSub.isPending}>
                  {mPatchSub.isPending ? "Saving…" : "Save Meta"}
                </Button>

                {mPatchSub.isError ? (
                  <div className="text-sm text-destructive">
                    {mPatchSub.error?.response?.data?.message || "Save failed"}
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>

          {/* Limits editor */}
          <Card>
            <CardContent className="p-6 space-y-4 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <div className="font-medium">Limits</div>
                <Badge variant={canEditLimitsAndEntitlements ? "secondary" : "outline"} className="text-[10px] uppercase">
                  {canEditLimitsAndEntitlements ? "EDITABLE" : "LOCKED"}
                </Badge>
              </div>

              <div className="text-xs text-muted-foreground">
                Enter a number (≥ 0), or type <span className="font-medium">null</span> for Unlimited. Blank = no change.
              </div>

              {!canEditLimitsAndEntitlements ? (
                <div className="text-sm text-muted-foreground">
                  Limits are locked because subscription writes are disabled. Update status/expiry first.
                </div>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">STUDENTS_MAX</div>
                  <Input
                    value={limitsDraft.STUDENTS_MAX}
                    onChange={(e) => setLimitsDraft((p) => ({ ...p, STUDENTS_MAX: e.target.value }))}
                    disabled={!canEditLimitsAndEntitlements || mPatchLimits.isPending}
                    placeholder="e.g. 500 or null"
                  />
                </div>

                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">TEACHERS_MAX</div>
                  <Input
                    value={limitsDraft.TEACHERS_MAX}
                    onChange={(e) => setLimitsDraft((p) => ({ ...p, TEACHERS_MAX: e.target.value }))}
                    disabled={!canEditLimitsAndEntitlements || mPatchLimits.isPending}
                    placeholder="e.g. 50 or null"
                  />
                </div>

                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">CLASSES_MAX</div>
                  <Input
                    value={limitsDraft.CLASSES_MAX}
                    onChange={(e) => setLimitsDraft((p) => ({ ...p, CLASSES_MAX: e.target.value }))}
                    disabled={!canEditLimitsAndEntitlements || mPatchLimits.isPending}
                    placeholder="e.g. 40 or null"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={saveLimits} disabled={!canEditLimitsAndEntitlements || mPatchLimits.isPending}>
                  {mPatchLimits.isPending ? "Saving…" : "Save Limits"}
                </Button>

                {mPatchLimits.isError ? (
                  <div className="text-sm text-destructive">
                    {mPatchLimits.error?.response?.data?.message || "Save failed"}
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>

          {/* Entitlements manager */}
          <Card>
            <CardContent className="p-6 space-y-4 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <div className="font-medium">Entitlements</div>
                <Badge variant={canEditLimitsAndEntitlements ? "secondary" : "outline"} className="text-[10px] uppercase">
                  {canEditLimitsAndEntitlements ? "EDITABLE" : "LOCKED"}
                </Badge>
              </div>

              <div className="text-xs text-muted-foreground">
                Toggle keys on/off. Add new keys in uppercase (e.g. EXAMS_WRITE). Click Save to apply.
              </div>

              {!canEditLimitsAndEntitlements ? (
                <div className="text-sm text-muted-foreground">
                  Entitlements are locked because subscription writes are disabled. Update status/expiry first.
                </div>
              ) : null}

              {/* Add new entitlement */}
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  value={newEntKey}
                  onChange={(e) => setNewEntKey(e.target.value)}
                  placeholder="NEW_KEY (A-Z0-9_)"
                  disabled={!canEditLimitsAndEntitlements || mPatchEnt.isPending}
                />
                <select
                  className="border rounded-md h-10 px-3 bg-background text-sm"
                  value={newEntVal ? "true" : "false"}
                  onChange={(e) => setNewEntVal(e.target.value === "true")}
                  disabled={!canEditLimitsAndEntitlements || mPatchEnt.isPending}
                >
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
                <Button
                  variant="outline"
                  onClick={addEntitlement}
                  disabled={
                    !canEditLimitsAndEntitlements ||
                    mPatchEnt.isPending ||
                    !String(newEntKey || "").trim()
                  }
                >
                  Add
                </Button>
              </div>

              {/* Existing entitlements */}
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {Object.keys(entDraft || {})
                  .sort()
                  .map((k) => {
                    const v = !!entDraft?.[k];
                    return (
                      <button
                        key={k}
                        type="button"
                        onClick={() => toggleEntitlement(k)}
                        disabled={!canEditLimitsAndEntitlements || mPatchEnt.isPending}
                        className={[
                          "flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm transition",
                          v ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted",
                        ].join(" ")}
                        title="Toggle"
                      >
                        <span className="font-medium">{k}</span>
                        <span className="text-xs opacity-90">{v ? "ON" : "OFF"}</span>
                      </button>
                    );
                  })}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={saveEntitlements} disabled={!canEditLimitsAndEntitlements || mPatchEnt.isPending}>
                  {mPatchEnt.isPending ? "Saving…" : "Save Entitlements"}
                </Button>

                {mPatchEnt.isError ? (
                  <div className="text-sm text-destructive">
                    {mPatchEnt.error?.response?.data?.message || "Save failed"}
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
