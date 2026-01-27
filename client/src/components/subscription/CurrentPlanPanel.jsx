// client/src/components/subscription/CurrentPlanPanel.jsx
import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { api } from "@/api/axios";
import { useMe } from "@/hooks/useMe";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import {
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  CheckCircle,
  Crown,
  RefreshCw,
  EyeOff,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

async function fetchSubscriptionOverview() {
  const { data } = await api.get("/api/settings/subscription/overview");
  return data;
}

function capLabel(v) {
  if (v === null) return "∞";
  if (v === undefined || v === "") return "—";
  return String(v);
}

function formatPlanName(code) {
  if (!code) return "Free";
  return code.replace("_", " ").toUpperCase();
}

export default function SubscriptionCollapsiblePanel() {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isVisible, setIsVisible] = useState(false); // Hidden by default

  const meQ = useMe();
  const role = String(meQ.data?.user?.role || meQ.data?.role || "").toUpperCase();
  const isSystemAdmin = role === "SYSTEM_ADMIN";

  const q = useQuery({
    queryKey: ["settings-subscription-overview"],
    queryFn: fetchSubscriptionOverview,
    enabled: isSystemAdmin || role === "ADMIN",
    retry: false,
    staleTime: 30 * 1000,
  });

  const sub = q.data?.subscription || null;
  const usage = q.data?.usage || {};
  const atLimit = q.data?.atLimit || {};
  const flags = q.data?.flags || {};

  // Check if any limit is near or reached
  const isNearLimit = useMemo(() => {
    if (!q.data?.percent) return false;
    const percents = Object.values(q.data.percent).filter(p => p !== null);
    return percents.some(p => p >= 85);
  }, [q.data]);

  const isAtLimit = useMemo(() => {
    if (!atLimit) return false;
    return Object.values(atLimit).some(limit => limit === true);
  }, [atLimit]);

  // Only show for admins and if there's subscription data
  if (!isSystemAdmin && role !== "ADMIN") return null;
  if (q.isLoading || !sub) return null;

  const planCode = formatPlanName(sub?.planCode);
  const canWrite = flags.canWrite;
  const isExpired = flags.isExpired;

  // If hidden, show just a tiny toggle button
  if (!isVisible) {
    return (
      <div className="fixed top-20 right-4 z-30">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0 rounded-full shadow-md"
                onClick={() => setIsVisible(true)}
              >
                <Crown className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">
              <p className="text-xs">Show subscription status</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    );
  }

  // Collapsed view (default)
  if (!isExpanded) {
    return (
      <div className="fixed top-20 right-4 z-30">
        <Card className="w-64 shadow-lg border-l-4 border-l-primary/50">
          <CardContent className="p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Crown className="h-4 w-4 text-primary" />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium">{planCode}</span>
                    {isExpired ? (
                      <Badge variant="destructive" className="h-4 px-1 text-[10px]">
                        Expired
                      </Badge>
                    ) : !canWrite ? (
                      <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                        Read Only
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="h-4 px-1 text-[10px]">
                        Active
                      </Badge>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {isAtLimit ? "Limit reached" : isNearLimit ? "Near limit" : "All good"}
                  </div>
                </div>
              </div>
              
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => setIsExpanded(true)}
                >
                  <ChevronRight className="h-3 w-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => setIsVisible(false)}
                >
                  <EyeOff className="h-3 w-3" />
                </Button>
              </div>
            </div>

            {isNearLimit && !isAtLimit && (
              <div className="mt-2 flex items-center gap-1 text-amber-600 text-[10px]">
                <AlertTriangle className="h-3 w-3" />
                Some resources near limit
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // Expanded view
  return (
    <div className="fixed top-20 right-4 z-30">
      <Card className="w-80 shadow-xl border border-border">
        <CardContent className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Crown className="h-5 w-5 text-primary" />
              <div>
                <h3 className="font-semibold text-sm">Subscription</h3>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium">{planCode}</span>
                  {isExpired ? (
                    <Badge variant="destructive" className="h-5 px-2 text-xs">
                      Expired
                    </Badge>
                  ) : !canWrite ? (
                    <Badge variant="secondary" className="h-5 px-2 text-xs">
                      Read Only
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="h-5 px-2 text-xs">
                      Active
                    </Badge>
                  )}
                </div>
              </div>
            </div>
            
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => q.refetch()}
              >
                <RefreshCw className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setIsExpanded(false)}
              >
                <ChevronDown className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setIsVisible(false)}
              >
                <EyeOff className="h-3 w-3" />
              </Button>
            </div>
          </div>

          {/* Status Message */}
          <div className="text-xs text-muted-foreground">
            {isExpired 
              ? "Subscription expired — renew to enable writes"
              : !canWrite
              ? "Read-only mode — upgrades available"
              : "All features available"
            }
          </div>

          <Separator />

          {/* Quick Limits */}
          <div className="space-y-3">
            <div className="text-xs font-medium">Resource Usage</div>
            
            {['students', 'teachers', 'classes'].map((resource) => {
              const used = usage[`${resource}Count`] || 0;
              const cap = sub?.[`max${resource.charAt(0).toUpperCase() + resource.slice(1)}`];
              const limitReached = atLimit[resource];
              const percent = q.data?.percent?.[resource] || 0;
              
              return (
                <div key={resource} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="capitalize">{resource}</span>
                    <div className="flex items-center gap-1">
                      <span className="font-medium">{used}</span>
                      <span className="text-muted-foreground">/</span>
                      <span>{capLabel(cap)}</span>
                      {limitReached && (
                        <AlertTriangle className="h-3 w-3 text-destructive ml-1" />
                      )}
                    </div>
                  </div>
                  {cap !== null && (
                    <div className="space-y-1">
                      <Progress value={percent} className="h-1" />
                      <div className="flex justify-between text-[10px] text-muted-foreground">
                        <span>{limitReached ? "Limit reached" : `${100 - Math.round(percent)}% left`}</span>
                        <span>{Math.round(percent)}% used</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <Separator />

          {/* Actions */}
          <div className="space-y-2">
            <div className="text-xs font-medium">Actions</div>
            <div className="flex gap-2">
              {isSystemAdmin ? (
                <Button asChild size="sm" className="flex-1 text-xs h-7">
                  <Link to="/app/settings?tab=subs">Manage Plan</Link>
                </Button>
              ) : (
                <Button asChild size="sm" variant="outline" className="flex-1 text-xs h-7">
                  <Link to="/app/settings?tab=general">Contact Admin</Link>
                </Button>
              )}
              
              {isExpired && (
                <Button asChild size="sm" className="flex-1 text-xs h-7">
                  <Link to="/app/settings?tab=subs">Renew</Link>
                </Button>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="pt-2 border-t">
            <div className="text-[10px] text-muted-foreground text-center">
              Limits enforced automatically
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}