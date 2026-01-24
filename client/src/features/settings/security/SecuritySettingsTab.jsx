// client/src/features/settings/security/SecuritySettingsTab.jsx
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";

import { api } from "@/api/axios";
import { useMe } from "@/hooks/useMe";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

async function getSecurityPolicy() {
  const { data } = await api.get("/api/settings/security");
  return data;
}

async function getSecurityOverview(params = {}) {
  const { data } = await api.get("/api/settings/security/overview", { params });
  return data;
}

// OPTIONAL: school search for SYSTEM_ADMIN UX
// Change endpoint if yours is different.
async function getSchools(params = {}) {
  const { data } = await api.get("/api/schools", { params }); // expects { schools: [...] }
  return data;
}

function fmtDate(v) {
  try {
    if (!v) return "-";
    return new Date(v).toLocaleString();
  } catch {
    return "-";
  }
}

function clampInt(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

function RiskBadge({ label, value, kind = "neutral" }) {
  const v = clampInt(value);
  const variant =
    kind === "danger" ? "destructive" : kind === "warn" ? "secondary" : "secondary";
  return (
    <div className="flex items-center justify-between text-sm">
      <div className="text-muted-foreground">{label}</div>
      <Badge variant={variant} className="font-medium">
        {v}
      </Badge>
    </div>
  );
}

export default function SecuritySettingsTab() {
  const { data: meData } = useMe();
  const role = String(meData?.user?.role || "").toUpperCase();
  const [, setSp] = useSearchParams();

  // UX state
  const [schoolId, setSchoolId] = useState("");
  const [schoolQuery, setSchoolQuery] = useState("");
  const [range, setRange] = useState("24h"); // UI-ready: 24h | 7d (backend can ignore)

  const overviewParams = useMemo(() => {
    const p = {};
    if (role === "SYSTEM_ADMIN" && schoolId.trim()) p.schoolId = schoolId.trim();
    if (range) p.range = range; // safe even if backend ignores
    return p;
  }, [role, schoolId, range]);

  const policyQ = useQuery({
    queryKey: ["settings-security-policy"],
    queryFn: getSecurityPolicy,
    retry: false,
  });

  const overviewQ = useQuery({
    queryKey: ["settings-security-overview", overviewParams],
    queryFn: () => getSecurityOverview(overviewParams),
    retry: false,
    keepPreviousData: true,
  });

  // optional schools search (only for SYSTEM_ADMIN)
  const schoolsQ = useQuery({
    enabled: role === "SYSTEM_ADMIN",
    queryKey: ["schools-search", schoolQuery],
    queryFn: () => getSchools({ q: schoolQuery.trim(), take: 10 }),
    retry: false,
  });

  const policy = policyQ.data;
  const overview = overviewQ.data;

  const loading = policyQ.isLoading || overviewQ.isLoading;
  const error = policyQ.isError || overviewQ.isError;

  const goToLogs = () => setSp({ tab: "logs" });

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore
    }
  };

  // derive risk signal
  const failed = clampInt(overview?.today?.loginFailed);
  const blocked = clampInt(overview?.today?.loginBlockedLocked);
  const locked = clampInt(overview?.today?.accountLocked);

  const riskLevel =
    blocked >= 10 || failed >= 25 ? "HIGH" : blocked >= 3 || failed >= 10 ? "MEDIUM" : "LOW";

  const riskVariant = riskLevel === "HIGH" ? "destructive" : "secondary";

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="text-sm text-muted-foreground">Loading security…</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Card><CardContent className="p-6 h-24" /></Card>
          <Card><CardContent className="p-6 h-24" /></Card>
        </div>
        <Card><CardContent className="p-6 h-40" /></Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-3">
        <div className="text-sm text-destructive">Failed to load security settings/overview.</div>
        <div className="text-xs text-muted-foreground">
          Backend hint: <span className="font-medium">SECURITY OVERVIEW ERROR</span>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              policyQ.refetch();
              overviewQ.refetch();
            }}
          >
            Retry
          </Button>
          <Button size="sm" onClick={goToLogs}>
            View audit logs
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="uppercase text-[10px]">
            {role || "—"}
          </Badge>

          <Badge variant={riskVariant} className="uppercase text-[10px]">
            risk: {riskLevel}
          </Badge>

          <div className="text-sm text-muted-foreground">
            Policy is enforced server-side. This page surfaces live signals and audit-driven metrics.
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              policyQ.refetch();
              overviewQ.refetch();
            }}
          >
            Refresh
          </Button>
          <Button size="sm" onClick={goToLogs}>
            View audit logs
          </Button>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="text-xs text-muted-foreground">Range</div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={range === "24h" ? "default" : "outline"}
            onClick={() => setRange("24h")}
          >
            24h
          </Button>
          <Button
            size="sm"
            variant={range === "7d" ? "default" : "outline"}
            onClick={() => setRange("7d")}
          >
            7d
          </Button>
        </div>
      </div>

      {/* SYSTEM_ADMIN scope */}
      {role === "SYSTEM_ADMIN" ? (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">Scope</div>
                <div className="text-sm text-muted-foreground">
                  Filter security signals by a school (recommended) or leave empty for platform-wide.
                </div>
              </div>

              {schoolId ? (
                <Button variant="outline" size="sm" onClick={() => copy(schoolId)}>
                  Copy schoolId
                </Button>
              ) : null}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <Input
                value={schoolId}
                onChange={(e) => setSchoolId(e.target.value)}
                placeholder="Selected schoolId (optional)"
              />

              <Input
                value={schoolQuery}
                onChange={(e) => setSchoolQuery(e.target.value)}
                placeholder="Search school name (optional)"
              />
            </div>

            {/* School search results (optional) */}
            {schoolsQ.data?.schools?.length ? (
              <div className="border rounded-md p-2 space-y-1">
                <div className="text-xs text-muted-foreground">
                  Quick pick (from /api/schools):
                </div>
                <div className="space-y-1">
                  {schoolsQ.data.schools.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSchoolId(s.id)}
                      className="w-full text-left px-2 py-1 rounded hover:bg-muted text-sm flex items-center justify-between"
                    >
                      <span className="truncate">{s.name}</span>
                      <span className="text-xs text-muted-foreground">{s.id}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setSchoolId("")}>
                Clear scope
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSchoolQuery("");
                  schoolsQ.refetch?.();
                }}
              >
                Refresh schools
              </Button>
            </div>

            {schoolsQ.isError ? (
              <div className="text-xs text-muted-foreground">
                School search unavailable (endpoint missing). You can still paste a schoolId.
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* Policy */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card>
          <CardContent className="p-6 space-y-2">
            <div className="flex items-center justify-between">
              <div className="font-medium">Login lockout policy</div>
              <Badge variant="secondary">{policy?.lockout?.enabled ? "ENABLED" : "DISABLED"}</Badge>
            </div>
            <div className="text-sm text-muted-foreground">
              Max attempts:{" "}
              <span className="text-foreground font-medium">{policy?.lockout?.maxAttempts}</span>
              {" • "}
              Lock time:{" "}
              <span className="text-foreground font-medium">{policy?.lockout?.lockMinutes} mins</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6 space-y-2">
            <div className="flex items-center justify-between">
              <div className="font-medium">Audit logs</div>
              <Badge variant="secondary">{policy?.auditLogs?.enabled ? "ENABLED" : "DISABLED"}</Badge>
            </div>
            <div className="text-sm text-muted-foreground">{policy?.notes}</div>
          </CardContent>
        </Card>
      </div>

      <Separator />

      {/* Live overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-6 space-y-3">
            <div className="flex items-center justify-between">
              <div className="font-medium">Today</div>
              <Badge variant="secondary" className="text-[10px] uppercase">
                counts
              </Badge>
            </div>

            <div className="space-y-2">
              <RiskBadge label="Login success" value={overview?.today?.loginSuccess ?? 0} />
              <RiskBadge label="Login failed" value={overview?.today?.loginFailed ?? 0} kind={failed >= 10 ? "warn" : "neutral"} />
              <RiskBadge label="Account locked" value={overview?.today?.accountLocked ?? 0} kind={locked >= 3 ? "warn" : "neutral"} />
              <RiskBadge label="Blocked (locked)" value={overview?.today?.loginBlockedLocked ?? 0} kind={blocked >= 3 ? "danger" : "neutral"} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6 space-y-2">
            <div className="flex items-center justify-between">
              <div className="font-medium">Active locks</div>
              <Badge variant="secondary" className="text-[10px] uppercase">
                signal
              </Badge>
            </div>
            <div className="text-3xl font-semibold">{overview?.activeLocks ?? 0}</div>
            <div className="text-xs text-muted-foreground">
              Backend-driven signal (exact meaning depends on your implementation).
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6 space-y-2">
            <div className="flex items-center justify-between">
              <div className="font-medium">Last security event</div>
              <Badge variant="secondary" className="text-[10px] uppercase">
                latest
              </Badge>
            </div>
            <div className="text-sm text-muted-foreground">
              Action:{" "}
              <span className="text-foreground font-medium">{overview?.lastEventAction || "-"}</span>
              <br />
              Time:{" "}
              <span className="text-foreground font-medium">{fmtDate(overview?.lastEventAt)}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Top actions */}
      <Card>
        <CardContent className="p-6 space-y-3">
          <div className="flex items-center justify-between">
            <div className="font-medium">Top actions ({range})</div>
            <Badge variant="secondary" className="text-[10px] uppercase">
              activity
            </Badge>
          </div>

          {overview?.last24hTopActions?.length ? (
            <div className="space-y-2">
              {overview.last24hTopActions.map((x) => (
                <div key={x.action} className="flex items-center justify-between text-sm">
                  <div className="text-muted-foreground">{x.action}</div>
                  <div className="font-medium">{x.count}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">No activity in this window.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
