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

async function getSchools(params = {}) {
  const { data } = await api.get("/api/schools", { params });
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
  return (
    <div className="flex items-center justify-between text-sm">
      <div className="text-muted-foreground">{label}</div>
      <Badge variant={kind === "danger" ? "destructive" : "secondary"} className="font-normal">
        {v}
      </Badge>
    </div>
  );
}

export default function SecuritySettingsTab() {
  const { data: meData } = useMe();
  const role = String(meData?.user?.role || "").toUpperCase();
  const [, setSp] = useSearchParams();

  const [schoolId, setSchoolId] = useState("");
  const [schoolQuery, setSchoolQuery] = useState("");
  const [range, setRange] = useState("24h");

  const overviewParams = useMemo(() => {
    const p = {};
    if (role === "SYSTEM_ADMIN" && schoolId.trim()) p.schoolId = schoolId.trim();
    if (range) p.range = range;
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
  } catch (err) {
    // Silently fail - it's a non-critical feature
    // But at least log in development
    if (import.meta.env.DEV) {
      console.warn('Failed to copy to clipboard:', err);
    }
  }
};

  const failed = clampInt(overview?.today?.loginFailed);
  const blocked = clampInt(overview?.today?.loginBlockedLocked);
  const locked = clampInt(overview?.today?.accountLocked);

  const riskLevel =
    blocked >= 10 || failed >= 25 ? "HIGH" : blocked >= 3 || failed >= 10 ? "MEDIUM" : "LOW";

  const riskVariant = riskLevel === "HIGH" ? "destructive" : "secondary";

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card><CardContent className="p-6 h-32" /></Card>
          <Card><CardContent className="p-6 h-32" /></Card>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card><CardContent className="p-6 h-48" /></Card>
          <Card><CardContent className="p-6 h-48" /></Card>
          <Card><CardContent className="p-6 h-48" /></Card>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="pt-6 text-center">
            <div className="text-lg font-medium mb-2">Failed to load security settings</div>
            <div className="text-muted-foreground mb-4">
              Please check your connection and try again.
            </div>
            <div className="flex justify-center gap-2">
              <Button variant="outline" onClick={() => { policyQ.refetch(); overviewQ.refetch(); }}>
                Retry
              </Button>
              <Button onClick={goToLogs}>View Audit Logs</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Security Overview</h2>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant="outline" className="font-normal">{role}</Badge>
            <Badge variant={riskVariant} className="font-normal">
              Risk Level: {riskLevel}
            </Badge>
          </div>
        </div>
        
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => { policyQ.refetch(); overviewQ.refetch(); }}>
            Refresh
          </Button>
          <Button size="sm" onClick={goToLogs}>Audit Logs</Button>
        </div>
      </div>

      {/* Time Range Selector */}
      <div className="flex items-center gap-4">
        <div className="text-sm font-medium">Time Range</div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={range === "24h" ? "default" : "outline"}
            onClick={() => setRange("24h")}
          >
            24 Hours
          </Button>
          <Button
            size="sm"
            variant={range === "7d" ? "default" : "outline"}
            onClick={() => setRange("7d")}
          >
            7 Days
          </Button>
        </div>
      </div>

      {/* SYSTEM_ADMIN Scope Selector */}
      {role === "SYSTEM_ADMIN" && (
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-4">
              <div>
                <h3 className="text-base font-medium mb-1">Filter by School</h3>
                <p className="text-sm text-muted-foreground">
                  View security data for a specific school or leave blank for platform-wide overview.
                </p>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <div className="text-sm font-medium mb-1.5">School ID</div>
                  <Input
                    value={schoolId}
                    onChange={(e) => setSchoolId(e.target.value)}
                    placeholder="Enter school ID"
                  />
                </div>
                
                <div>
                  <div className="text-sm font-medium mb-1.5">Search School Name</div>
                  <Input
                    value={schoolQuery}
                    onChange={(e) => setSchoolQuery(e.target.value)}
                    placeholder="Search by name"
                  />
                </div>
              </div>

              {/* School Search Results */}
              {schoolsQ.data?.schools?.length > 0 && (
                <div className="border rounded-md p-3">
                  <div className="text-sm font-medium mb-2">Quick Select</div>
                  <div className="space-y-2">
                    {schoolsQ.data.schools.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setSchoolId(s.id)}
                        className="w-full text-left p-2 rounded hover:bg-muted text-sm flex items-center justify-between"
                      >
                        <span>{s.name}</span>
                        <Badge variant="outline" className="text-xs">{s.id}</Badge>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setSchoolId("")}>
                  Clear Filter
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => schoolsQ.refetch?.()}
                >
                  Refresh Schools
                </Button>
                {schoolId && (
                  <Button variant="outline" size="sm" onClick={() => copy(schoolId)}>
                    Copy ID
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Policy Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-medium">Login Lockout Policy</h3>
                <Badge variant={policy?.lockout?.enabled ? "default" : "secondary"}>
                  {policy?.lockout?.enabled ? "Enabled" : "Disabled"}
                </Badge>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Max Attempts</span>
                  <span className="font-medium">{policy?.lockout?.maxAttempts}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Lock Duration</span>
                  <span className="font-medium">{policy?.lockout?.lockMinutes} minutes</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-medium">Audit Logs</h3>
                <Badge variant={policy?.auditLogs?.enabled ? "default" : "secondary"}>
                  {policy?.auditLogs?.enabled ? "Enabled" : "Disabled"}
                </Badge>
              </div>
              <div className="text-sm text-muted-foreground">
                {policy?.notes || "System activity is being logged and monitored."}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Today's Activity */}
      <div>
        <h3 className="text-lg font-medium mb-3">Today's Security Activity</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="space-y-4">
                <div>
                  <h4 className="font-medium mb-2">Authentication Events</h4>
                  <div className="space-y-2">
                    <RiskBadge label="Successful Logins" value={overview?.today?.loginSuccess ?? 0} />
                    <RiskBadge label="Failed Logins" value={failed} kind={failed >= 10 ? "warn" : "neutral"} />
                    <RiskBadge label="Account Locked" value={locked} kind={locked >= 3 ? "warn" : "neutral"} />
                    <RiskBadge label="Blocked (Locked)" value={blocked} kind={blocked >= 3 ? "danger" : "neutral"} />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="space-y-3">
                <h4 className="font-medium">Active Account Locks</h4>
                <div className="text-3xl font-semibold">{overview?.activeLocks ?? 0}</div>
                <div className="text-sm text-muted-foreground">
                  Currently locked accounts due to security policy violations.
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="space-y-3">
                <h4 className="font-medium">Latest Security Event</h4>
                <div className="space-y-2 text-sm">
                  <div>
                    <div className="text-muted-foreground">Action</div>
                    <div className="font-medium">{overview?.lastEventAction || "None"}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Time</div>
                    <div className="font-medium">{fmtDate(overview?.lastEventAt)}</div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Recent Activity */}
      <Card>
        <CardContent className="pt-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-medium">Recent Security Events ({range})</h3>
              <Badge variant="outline">Activity</Badge>
            </div>
            
            {overview?.last24hTopActions?.length ? (
              <div className="space-y-3">
                {overview.last24hTopActions.map((x) => (
                  <div key={x.action} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{x.action}</span>
                    <Badge variant="secondary" className="font-normal">{x.count}</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-4 text-muted-foreground">
                No security events in the selected time period.
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}