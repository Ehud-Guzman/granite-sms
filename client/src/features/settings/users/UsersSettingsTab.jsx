// client/src/features/settings/users/UsersSettingsTab.jsx
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { me } from "@/api/auth.api";
import { listUsers } from "./users.api";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import NewUserDialog from "./components/NewUserDialog";
import ManageUserDialog from "./components/ManageUserDialog";

function RoleBadge({ role }) {
  const r = String(role || "").toUpperCase();
  const variant = r === "SYSTEM_ADMIN" ? "default" : 
                 r === "ADMIN" ? "secondary" : "outline";
  return (
    <Badge variant={variant} className="font-normal">
      {r || "—"}
    </Badge>
  );
}

function StatusBadge({ active }) {
  return active ? (
    <Badge variant="default" className="font-normal">Active</Badge>
  ) : (
    <Badge variant="destructive" className="font-normal">Suspended</Badge>
  );
}

export default function UsersSettingsTab() {
  const [search, setSearch] = useState("");

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
    queryFn: () => listUsers(),
    staleTime: 30 * 1000,
    retry: false,
    enabled: actorRole === "SYSTEM_ADMIN",
  });

  const filtered = useMemo(() => {
    const items = usersQ.data || [];
    const s = search.trim().toLowerCase();
    if (!s) return items;

    return items.filter((u) => {
      const email = String(u.email || "").toLowerCase();
      const role = String(u.role || "").toLowerCase();
      const schoolId = String(u.schoolId || "").toLowerCase();
      return email.includes(s) || role.includes(s) || schoolId.includes(s);
    });
  }, [usersQ.data, search]);

  const total = (usersQ.data || []).length;

  if (meQ.isLoading) return (
    <div className="flex items-center justify-center min-h-[200px]">
      <div className="text-muted-foreground">Loading...</div>
    </div>
  );

  if (meQ.isError) return (
    <Card>
      <CardContent className="pt-6 text-center">
        <div className="text-lg font-medium mb-2">Failed to load identity</div>
        <Button onClick={() => meQ.refetch()}>Try Again</Button>
      </CardContent>
    </Card>
  );

  if (actorRole !== "SYSTEM_ADMIN") {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Users Management</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Access control and account governance
          </p>
        </div>
        <Card>
          <CardContent className="pt-6 text-center">
            <div className="text-lg font-medium mb-2">Access Restricted</div>
            <p className="text-muted-foreground mb-4">
              This section is platform-level and is available to <span className="font-medium">SYSTEM_ADMIN</span> only.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Users Management</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Platform-level user accounts and access control
          </p>
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

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="text-sm">
          Showing <span className="font-medium">{filtered.length}</span> of{" "}
          <span className="font-medium">{total}</span> users
        </div>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by email, role, or school ID..."
          className="sm:max-w-sm"
        />
      </div>

      {usersQ.isError ? (
        <Card>
          <CardContent className="pt-6 text-center">
            <div className="text-lg font-medium mb-2">Failed to load users</div>
            <div className="text-muted-foreground mb-4">
              Please check your permissions and try again.
            </div>
            <Button onClick={() => usersQ.refetch()}>
              Try Again
            </Button>
          </CardContent>
        </Card>
      ) : usersQ.isLoading ? (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center text-muted-foreground">Loading users...</div>
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center">
            <div className="text-lg font-medium mb-2">No users found</div>
            <p className="text-muted-foreground mb-4">
              {search ? "Try a different search term" : "Create your first user account"}
            </p>
            {!search && (
              <NewUserDialog actor={actor} onCreated={() => usersQ.refetch()} />
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {filtered.map((u) => (
            <Card key={u.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="space-y-2">
                    <div>
                      <div className="font-medium">{u.email}</div>
                      <div className="text-sm text-muted-foreground">
                        ID: <span className="font-medium">{u.id}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <RoleBadge role={u.role} />
                      <StatusBadge active={!!u.isActive} />
                      <Badge variant="outline" className="font-normal">
                        {u.schoolId || "Platform"}
                      </Badge>
                    </div>
                  </div>
                  <ManageUserDialog
                    actor={actor}
                    user={u}
                    onChanged={() => usersQ.refetch()}
                  />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}