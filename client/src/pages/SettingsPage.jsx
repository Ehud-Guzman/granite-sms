// client/src/pages/SettingsPage.jsx
import { useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";

import { useMe } from "@/hooks/useMe";
import { capsFor } from "@/config/capabilities";
import { getSelectedSchool } from "@/api/auth.api";

// Tabs
import GeneralSettingsTab from "@/features/settings/general/GeneralSettingsTab.jsx";
import SchoolsSettingsTab from "@/features/settings/schools/SchoolsSettingsTab.jsx";
import UsersSettingsTab from "@/features/settings/users/UsersSettingsTab.jsx";
import SecuritySettingsTab from "@/features/settings/security/SecuritySettingsTab.jsx";
import SubscriptionLimitsTab from "@/features/settings/subs/SubscriptionLimitsTab.jsx";
import BackupsRestoreTab from "@/features/settings/backup/BackupsRestoreTab.jsx";
import AuditLogsTab from "@/features/settings/logs/AuditLogsTab.jsx";
import BrandingPrintTab from "@/features/settings/branding/BrandingPrintTab.jsx";

const ALL_TABS = [
  { key: "general", label: "General" },
  { key: "schools", label: "Schools" },
  { key: "users", label: "Users & Roles" },
  { key: "security", label: "Security" },
  { key: "subs", label: "Subscriptions & Limits" },
  { key: "backup", label: "Backups & Restore" },
  { key: "logs", label: "Logs & Monitoring" },
  { key: "branding", label: "Branding & Print" },
];

// Policy: tabs that are platform-only (SYSTEM_ADMIN-only)
const SYSTEM_ONLY = new Set(["schools", "backup", "subs"]);

// Optional: tabs that require tenant scope for SYSTEM_ADMIN (selected school)
// In your backend, many settings endpoints require x-school-id; this prevents 403 spam.
const TENANT_SCOPE_REQUIRED_FOR_SYSADMIN = new Set([
  "users",
  "security",
  "subs",
  "backup",
  "logs",
  "branding",
  "general",
]);

function ForbiddenNotice({ title, text }) {
  return (
    <div className="rounded-md border bg-muted/30 p-3 text-sm">
      <div className="font-medium">{title}</div>
      <div className="mt-1 text-muted-foreground">{text}</div>
    </div>
  );
}

function getTabPolicy(tabKey, caps, ctx) {
  const { role, isSystemAdmin, hasSelectedSchool } = ctx;

  // Base allow by capability (your existing model)
  const capAllowed = (() => {
    switch (tabKey) {
      case "schools":
        return !!caps.canManageSchools;
      case "backup":
        return !!caps.canBackupRestore;
      case "subs":
        return !!caps.canManageSubscriptions;
      case "logs":
        return !!caps.canViewAuditLogs;
      default:
        return true;
    }
  })();

  // If capability says no → locked
  if (!capAllowed) {
    // Friendly reason based on policy
    if (SYSTEM_ONLY.has(tabKey)) {
      return {
        canAccess: false,
        reason: "SYSTEM_ADMIN only",
        hint: "Only the platform owner can access this.",
      };
    }
    return {
      canAccess: false,
      reason: "Not permitted",
      hint: "Your role does not have access to this section.",
    };
  }

  // SYSTEM_ADMIN: require selected school for tenant-scoped settings
  // (But allow “Schools” tab to still work without selection if your backend supports platform listing)
  if (
    isSystemAdmin &&
    !hasSelectedSchool &&
    TENANT_SCOPE_REQUIRED_FOR_SYSADMIN.has(tabKey) &&
    tabKey !== "schools"
  ) {
    return {
      canAccess: false,
      reason: "Select a school first",
      hint: "Pick a school context to manage tenant settings (x-school-id required).",
    };
  }

  // Otherwise allowed
  return { canAccess: true, reason: null, hint: null };
}

export default function SettingsPage() {
  const meQ = useMe();
  const role = String(meQ.data?.user?.role || "").toUpperCase() || "STUDENT";
  const caps = capsFor(role);

  const isSystemAdmin = role === "SYSTEM_ADMIN";
  const selectedSchool = getSelectedSchool();
  const hasSelectedSchool = !!selectedSchool?.id;

  const ctx = useMemo(
    () => ({ role, isSystemAdmin, hasSelectedSchool }),
    [role, isSystemAdmin, hasSelectedSchool]
  );

  const [sp, setSp] = useSearchParams();
  const rawTab = sp.get("tab") || "";

  // Tabs with access policy (we DO NOT hide them anymore)
  const tabList = useMemo(() => {
    return ALL_TABS.map((t) => {
      const policy = getTabPolicy(t.key, caps, ctx);
      return { ...t, ...policy };
    });
  }, [caps, ctx]);

  // Default tab choice: first allowed tab (fallback to general)
  const defaultTab = useMemo(() => {
    const firstAllowed = tabList.find((t) => t.canAccess);
    return firstAllowed?.key || "general";
  }, [tabList]);

  const effectiveTab = useMemo(() => {
    // if URL tab exists (even if locked), keep it for debugging transparency
    if (rawTab && ALL_TABS.some((t) => t.key === rawTab)) return rawTab;
    return defaultTab;
  }, [rawTab, defaultTab]);

  // Keep URL synced only if tab is invalid (not in ALL_TABS)
  useEffect(() => {
    if (!rawTab) {
      setSp({ tab: effectiveTab }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentTab = useMemo(() => {
    return tabList.find((t) => t.key === effectiveTab) || tabList[0];
  }, [tabList, effectiveTab]);

  const tabLabel = currentTab?.label || "Settings";

  const renderTab = () => {
    // Hard-guard: locked tabs render a useful message (no silent redirect)
    if (!currentTab?.canAccess) {
      const reason = currentTab?.reason || "Locked";
      const hint = currentTab?.hint || "You do not have access to this section.";
      return <ForbiddenNotice title={reason} text={hint} />;
    }

    switch (effectiveTab) {
      case "general":
        return <GeneralSettingsTab />;

      case "schools":
        return <SchoolsSettingsTab />;

      case "users":
        return <UsersSettingsTab />;

      case "security":
        return <SecuritySettingsTab />;

      case "subs":
        return <SubscriptionLimitsTab />;

      case "backup":
        return <BackupsRestoreTab />;

      case "logs":
        return <AuditLogsTab />;

      case "branding":
        return <BrandingPrintTab />;

      default:
        return (
          <div className="text-sm text-muted-foreground">
            Unknown tab. Pick one above.
          </div>
        );
    }
  };

  if (!meQ.isLoading && tabList.length === 0) {
    return (
      <div className="p-4 md:p-6">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your role does not have access to settings.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Control plane for governance, tenant management, and operational visibility.
          </p>
        </div>

        <div className="flex flex-col items-end gap-1">
          <Badge variant="secondary" className="uppercase text-[10px]">
            {role}
          </Badge>

          {isSystemAdmin ? (
            <div className="text-[11px] text-muted-foreground">
              Scope:{" "}
              <span className="font-medium text-foreground">
                {hasSelectedSchool ? selectedSchool?.name || selectedSchool?.id : "Platform (no school selected)"}
              </span>
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {tabList.map((t) => {
          const locked = !t.canAccess;
          return (
            <Button
              key={t.key}
              size="sm"
              variant={effectiveTab === t.key ? "default" : "outline"}
              onClick={() => setSp({ tab: t.key })}
              disabled={locked}
              title={locked ? `${t.reason}: ${t.hint}` : ""}
              className={locked ? "opacity-70 cursor-not-allowed" : ""}
            >
              {t.label}
            </Button>
          );
        })}
      </div>

      <Separator />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{tabLabel}</CardTitle>
        </CardHeader>
        <CardContent>{renderTab()}</CardContent>
      </Card>
    </div>
  );
}
