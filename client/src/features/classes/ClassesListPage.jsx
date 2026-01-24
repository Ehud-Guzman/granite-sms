// src/features/classes/ClassesListPage.jsx
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { useMe } from "@/hooks/useMe";
import { useClasses } from "./classes.queries";
import ClassFormDrawer from "./ClassFormDrawer";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

function classLabel(c) {
  const s = c.stream ? ` ${c.stream}` : "";
  return `${c.name}${s}`;
}

export default function ClassesListPage() {
  const { data: meData, isLoading: meLoading } = useMe();
  const role = meData?.role ?? meData?.user?.role;

  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [q, setQ] = useState("");

  const yearNum = year ? Number(year) : undefined;

  const { data, isLoading, isError, error } = useClasses(
    Number.isFinite(yearNum) ? yearNum : undefined
  );

  const rows = useMemo(() => {
    const list = Array.isArray(data) ? data : [];
    const needle = q.trim().toLowerCase();
    if (!needle) return list;

    return list.filter((c) => {
      const txt = `${c.name} ${c.stream || ""} ${c.year}`.toLowerCase();
      return txt.includes(needle);
    });
  }, [data, q]);

  if (meLoading) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Loading...
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Classes</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Browse classes by year. Admins can create classes.
          </p>
        </div>

        {role === "ADMIN" && (
          <ClassFormDrawer defaultYear={Number(year) || new Date().getFullYear()}>
            <Button>Create class</Button>
          </ClassFormDrawer>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <Input
          className="sm:w-44"
          type="number"
          value={year}
          onChange={(e) => setYear(e.target.value)}
          placeholder="Year e.g. 2026"
        />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search class name/stream…"
        />
      </div>

      {isLoading && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Loading classes…
          </CardContent>
        </Card>
      )}

      {isError && (
        <Card>
          <CardContent className="p-6 text-sm">
            <div className="font-medium">Failed to load classes</div>
            <div className="text-muted-foreground mt-1">
              {error?.response?.data?.message || error?.message || "Server error"}
            </div>
          </CardContent>
        </Card>
      )}

      {!isLoading && !isError && (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {rows.map((c) => (
            <Link key={c.id} to={`/app/classes/${c.id}`} className="block">
              <Card className="hover:shadow-sm transition">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center justify-between gap-2">
                    <span>{classLabel(c)}</span>
                    <Badge variant="secondary" className="text-[10px]">
                      {c.year}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  Click to view students in this class.
                </CardContent>
              </Card>
            </Link>
          ))}

          {rows.length === 0 && (
            <Card className="md:col-span-2 lg:col-span-3">
              <CardContent className="p-6 text-sm text-muted-foreground">
                No classes found for this year.
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
