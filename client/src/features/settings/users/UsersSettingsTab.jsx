// client/src/features/settings/users/UsersSettingsTab.jsx
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { me } from "@/api/auth.api";
import { listUsers } from "./users.api";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

import NewUserDialog from "./components/NewUserDialog";
import ManageUserDialog from "./components/ManageUserDialog";

function RoleBadge({ role }) {
  const r = String(role || "").toUpperCase();
  const variant = r === "SYSTEM_ADMIN" ? "default" : r === "ADMIN" ? "secondary" : "outline";
  return (
    <Badge variant={variant} className="text-[10px] uppercase">
      {r || "—"}
    </Badge>
  );
}

function StatusBadge({ active }) {
  return active ? (
    <Badge className="text-[10px]" variant="secondary">Active</Badge>
  ) : (
    <Badge className="text-[10px]" variant="destructive">Suspended</Badge>
  );
}

export default function UsersSettingsTab() {
  const [q, setQ] = useState("");

  const meQ = useQuery({
    queryKey: ["me"],
    queryFn: me,
    staleTime: 60 * 1000,
    retry: false,
  });

  const actor = meQ.data?.user ?? meQ.data;
  const actorRole = String(actor?.role || "").toUpperCase();

  const usersQ = useQuery({
    queryKey: ["users"],
    // ✅ wrap so listUsers DOESN'T receive React Query context object
    queryFn: () => listUsers(),
    staleTime: 30 * 1000,
    retry: false,
    // ✅ /api/users is SYSTEM_ADMIN only
    enabled: actorRole === "SYSTEM_ADMIN",
  });

  const filtered = useMemo(() => {
    const items = usersQ.data || [];
    const s = q.trim().toLowerCase();
    if (!s) return items;

    return items.filter((u) => {
      const email = String(u.email || "").toLowerCase();
      const role = String(u.role || "").toLowerCase();
      const schoolId = String(u.schoolId || "").toLowerCase();
      return email.includes(s) || role.includes(s) || schoolId.includes(s);
    });
  }, [usersQ.data, q]);

  const total = (usersQ.data || []).length;

  if (meQ.isLoading) return <div className="p-4">Loading…</div>;
  if (meQ.isError) return <div className="p-4">Failed to load identity.</div>;

  // ✅ Non-system admins shouldn't even try to fetch /api/users
  if (actorRole !== "SYSTEM_ADMIN") {
    return (
      <div className="p-4 space-y-2">
        <div className="font-medium">Users</div>
        <div className="text-sm text-muted-foreground">
          This section is platform-level and is available to{" "}
          <span className="font-medium">SYSTEM_ADMIN</span> only.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="font-medium">Users</div>
          <div className="text-sm text-muted-foreground">
            Access control and account governance.
          </div>
        </div>

        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => usersQ.refetch()}
            disabled={usersQ.isLoading}
          >
            Refresh
          </Button>

          <NewUserDialog actor={actor} onCreated={() => usersQ.refetch()} />
        </div>
      </div>

      <Separator />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by email, role, schoolId…"
          className="sm:max-w-sm"
        />
        <div className="text-xs text-muted-foreground">
          {usersQ.isLoading ? "Loading…" : `${filtered.length}/${total} user(s)`}
        </div>
      </div>

      {usersQ.isError ? (
        <div className="text-sm text-red-600">
          Failed to load users. Confirm token + role + /api/users.
        </div>
      ) : null}

      <div className="divide-y rounded-lg border bg-background">
        {usersQ.isLoading ? (
          <div className="p-4 text-sm text-muted-foreground">Loading users…</div>
        ) : filtered.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">No users found.</div>
        ) : (
          filtered.map((u) => (
            <div key={u.id} className="p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium truncate">{u.email}</div>
                <div className="text-xs text-muted-foreground truncate">
                  ID: <span className="font-medium">{u.id}</span>
                </div>
                <div className="mt-1 flex items-center gap-2 flex-wrap">
                  <RoleBadge role={u.role} />
                  <StatusBadge active={!!u.isActive} />
                  <Badge variant="outline" className="text-[10px]">
                    {u.schoolId || "platform"}
                  </Badge>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <ManageUserDialog
                  actor={actor}
                  user={u}
                  onChanged={() => usersQ.refetch()}
                />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
