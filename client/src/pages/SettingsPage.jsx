// client/src/pages/SettingsPage.jsx
import { useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
  { key: "users", label: "Users" },
  { key: "security", label: "Security" },
  { key: "subs", label: "Subscriptions" },
  { key: "backup", label: "Backups" },
  { key: "logs", label: "Logs" },
  { key: "branding", label: "Branding" },
];

// Tabs that are platform-only (SYSTEM_ADMIN-only)
const SYSTEM_ONLY = new Set(["schools", "backup", "subs"]);

// Tabs that require tenant scope for SYSTEM_ADMIN (selected school)
const TENANT_SCOPE_REQUIRED_FOR_SYSADMIN = new Set([
  "users",
  "security",
  "subs",
  "backup",
  "logs",
  "branding",
  "general",
]);

function Notice({ title, text, actions = null }) {
  return (
    <div className="rounded-md border bg-muted/20 p-3 text-sm">
      <div className="font-medium mb-1">{title}</div>
      <div className="text-muted-foreground">{text}</div>
      {actions && <div className="mt-2 flex gap-2">{actions}</div>}
    </div>
  );
}

function getTabPolicy(tabKey, caps, ctx) {
  const { isSystemAdmin, hasSelectedSchool } = ctx;

  // Capability allow rules
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

  if (!capAllowed) {
    if (SYSTEM_ONLY.has(tabKey)) {
      return {
        canAccess: false,
        reason: "SYSTEM_ADMIN only",
        hint: "Only the platform owner can access this section.",
      };
    }
    return {
      canAccess: false,
      reason: "Not permitted",
      hint: "Your role does not have access to this section.",
    };
  }

  // SYSTEM_ADMIN needs selected school for tenant-scoped tabs
  if (
    isSystemAdmin &&
    !hasSelectedSchool &&
    TENANT_SCOPE_REQUIRED_FOR_SYSADMIN.has(tabKey) &&
    tabKey !== "schools"
  ) {
    return {
      canAccess: false,
      reason: "Select a school first",
      hint: "Pick a school context to manage tenant settings.",
    };
  }

  return { canAccess: true, reason: null, hint: null };
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const meQ = useMe();

  const role = String(meQ.data?.user?.role || "").toUpperCase() || "STUDENT";
  const caps = capsFor(role);

  const isSystemAdmin = role === "SYSTEM_ADMIN";
  const selectedSchool = getSelectedSchool();
  const hasSelectedSchool = !!selectedSchool?.id;

  const ctx = useMemo(
    () => ({ isSystemAdmin, hasSelectedSchool }),
    [isSystemAdmin, hasSelectedSchool]
  );

  const [sp, setSp] = useSearchParams();
  const rawTab = sp.get("tab") || "";

  // Build tab list with policies
  const tabList = useMemo(() => {
    return ALL_TABS.map((t) => {
      const policy = getTabPolicy(t.key, caps, ctx);
      return { ...t, ...policy };
    });
  }, [caps, ctx]);

  // Default tab: first allowed, else general
  const defaultTab = useMemo(() => {
    const firstAllowed = tabList.find((t) => t.canAccess);
    return firstAllowed?.key || "general";
  }, [tabList]);

  const effectiveTab = useMemo(() => {
    if (rawTab && ALL_TABS.some((t) => t.key === rawTab)) return rawTab;
    return defaultTab;
  }, [rawTab, defaultTab]);

  // Keep URL synced on first load
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

  function renderScopeNoticeIfNeeded() {
    if (!isSystemAdmin) return null;
    if (hasSelectedSchool) return null;

    return (
      <Notice
        title="Platform mode active"
        text="You're currently not scoped to a school. Tenant settings require a selected school."
        actions={
          <>
            <Button size="sm" onClick={() => navigate("/select-school")}>
              Select school
            </Button>
          </>
        }
      />
    );
  }

  const renderTab = () => {
    if (!currentTab?.canAccess) {
      return (
        <div className="py-8 text-center">
          <div className="text-lg font-medium mb-2">{currentTab?.reason || "Locked"}</div>
          <div className="text-muted-foreground max-w-md mx-auto">
            {currentTab?.hint || "You do not have access to this section."}
          </div>
          {isSystemAdmin && !hasSelectedSchool && currentTab?.reason === "Select a school first" && (
            <Button className="mt-4" onClick={() => navigate("/select-school")}>
              Select School
            </Button>
          )}
        </div>
      );
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
        return <div className="text-sm text-muted-foreground">Select a tab above.</div>;
    }
  };

  if (meQ.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-muted-foreground">Loading settings...</div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Settings</h1>
          <p className="text-muted-foreground mt-1">
            System configuration and management
          </p>
        </div>
        
        <div className="flex items-center gap-2">
          {isSystemAdmin && (
            <div className="text-sm text-muted-foreground">
              {hasSelectedSchool ? (
                <span className="font-medium">{selectedSchool?.name || selectedSchool?.id}</span>
              ) : (
                "Platform"
              )}
            </div>
          )}
          <Badge variant="outline" className="font-normal">
            {role}
          </Badge>
        </div>
      </div>

      {renderScopeNoticeIfNeeded()}

      <Tabs value={effectiveTab} onValueChange={(value) => setSp({ tab: value })}>
        <div className="overflow-x-auto pb-2">
          <TabsList className="inline-flex">
            {tabList.map((t) => (
              <TabsTrigger
                key={t.key}
                value={t.key}
                disabled={!t.canAccess}
                className="relative"
              >
                {t.label}
                {!t.canAccess && (
                  <span className="ml-1.5 opacity-60">🔒</span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </Tabs>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">{tabLabel}</CardTitle>
          {currentTab?.hint && currentTab.canAccess && (
            <CardDescription className="text-sm">
              {currentTab.hint}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {renderTab()}
        </CardContent>
      </Card>
    </div>
  );
}