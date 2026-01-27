// src/components/subscription/SubscriptionBlockerProvider.jsx
import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { subscriptionEvents } from "@/api/axios";
import { useMe } from "@/hooks/useMe";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

function capLabel(v) {
  if (v === null) return "Unlimited";
  if (v === undefined) return "—";
  return String(v);
}

function prettyResource(r) {
  const s = String(r || "").toLowerCase().trim();
  if (!s) return "Resource";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function SubscriptionBlockerProvider({ children }) {
  const navigate = useNavigate();
  const meQ = useMe();

  const role =
    String(meQ.data?.user?.role || meQ.data?.role || "").toUpperCase() || "UNKNOWN";
  const isSystemAdmin = role === "SYSTEM_ADMIN";

  const [open, setOpen] = useState(false);
  const [payload, setPayload] = useState(null);

  useEffect(() => {
    function onBlock(e) {
      setPayload(e?.detail || null);
      setOpen(true);
    }
    subscriptionEvents.addEventListener("subscription:block", onBlock);
    return () => subscriptionEvents.removeEventListener("subscription:block", onBlock);
  }, []);

  const close = useCallback(() => setOpen(false), []);

  const goManage = useCallback(() => {
    close();
    navigate("/app/settings?tab=subs");
  }, [navigate, close]);

  const goContact = useCallback(() => {
    close();
    // choose any tab that EVERY role can open
    navigate("/app/settings?tab=general");
  }, [navigate, close]);

  const view = useMemo(() => {
    const p = payload;
    const data = p?.data || {};
    const type = String(p?.type || "").toUpperCase();

    if (!type) {
      return {
        title: "Action blocked",
        desc: "This action is currently blocked.",
        chips: [],
        primaryText: "Close",
        secondaryText: null,
        onPrimary: close,
        onSecondary: null,
      };
    }

    const mkCtas = () => {
      // ✅ this is the main fix
      if (isSystemAdmin) {
        return {
          primaryText: "Manage subscription",
          secondaryText: "Close",
          onPrimary: goManage,
          onSecondary: close,
        };
      }
      return {
        primaryText: "Contact admin",
        secondaryText: "Close",
        onPrimary: goContact,
        onSecondary: close,
      };
    };

    if (type === "LIMIT_REACHED") {
      const res = prettyResource(data.resource);
      const ctas = mkCtas();
      return {
        title: `${res} limit reached`,
        desc: data?.message || `You've hit your ${res.toLowerCase()} limit.`,
        chips: [
          { label: "Used", value: String(data.used ?? "—") },
          { label: "Limit", value: capLabel(data.limit) },
          { label: "Plan", value: String(data.planCode ?? "—") },
        ],
        ...ctas,
      };
    }

    if (type === "SUBSCRIPTION_EXPIRED") {
      const ctas = mkCtas();
      return {
        title: "Subscription expired",
        desc: data?.message || "Renew to continue creating or editing records.",
        chips: [],
        ...ctas,
      };
    }

    if (type === "SUBSCRIPTION_INACTIVE") {
      const ctas = mkCtas();
      return {
        title: "Subscription inactive",
        desc: data?.message || "Reactivate subscription to continue.",
        chips: [],
        ...ctas,
      };
    }

    if (type === "NO_SUBSCRIPTION") {
      const ctas = mkCtas();
      return {
        title: "Subscription required",
        desc: data?.message || "Please activate a plan to continue.",
        chips: [],
        ...ctas,
      };
    }

    const ctas = mkCtas();
    return {
      title: "Action blocked",
      desc: data?.message || "This action is blocked by subscription policy.",
      chips: [],
      ...ctas,
    };
  }, [payload, isSystemAdmin, close, goManage, goContact]);

  return (
    <>
      {children}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {view.title}
              <Badge variant="outline" className="text-[10px] uppercase">
                {String(payload?.type || "BLOCKED")}
              </Badge>
              <Badge variant="secondary" className="text-[10px] uppercase">
                {role}
              </Badge>
            </DialogTitle>
            <DialogDescription>{view.desc}</DialogDescription>
          </DialogHeader>

          {view.chips?.length ? (
            <div className="grid grid-cols-3 gap-2">
              {view.chips.map((c) => (
                <div key={c.label} className="rounded-md border p-3">
                  <div className="text-[11px] text-muted-foreground">{c.label}</div>
                  <div className="text-sm font-medium">{c.value}</div>
                </div>
              ))}
            </div>
          ) : null}

          <div className="flex flex-wrap justify-end gap-2 pt-2">
            {view.secondaryText ? (
              <Button variant="outline" onClick={view.onSecondary || close}>
                {view.secondaryText}
              </Button>
            ) : null}

            <Button onClick={view.onPrimary || close}>{view.primaryText || "Close"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
