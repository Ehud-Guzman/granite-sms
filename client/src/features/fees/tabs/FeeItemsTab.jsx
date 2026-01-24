import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { listFeeItems, createFeeItem, updateFeeItem } from "@/api/fees.api";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import QueryBlock from "../components/QueryBlock";

function normStr(s) {
  return String(s || "").trim();
}

function normCode(s) {
  const x = String(s || "").trim();
  return x ? x.toUpperCase() : "";
}

export default function FeeItemsTab() {
  const qc = useQueryClient();

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [q, setQ] = useState("");
  const [formError, setFormError] = useState("");

  const itemsQ = useQuery({
    queryKey: ["feeItems"],
    queryFn: listFeeItems,
  });

  const items = Array.isArray(itemsQ.data) ? itemsQ.data : [];

  const filtered = useMemo(() => {
    const s = normStr(q).toLowerCase();
    if (!s) return items;
    return items.filter((it) => {
      const n = normStr(it?.name).toLowerCase();
      const c = normStr(it?.code).toLowerCase();
      return n.includes(s) || c.includes(s);
    });
  }, [items, q]);

  const createMut = useMutation({
    mutationFn: createFeeItem,
    onSuccess: () => {
      setName("");
      setCode("");
      setFormError("");
      qc.invalidateQueries({ queryKey: ["feeItems"] });
    },
    onError: (err) => {
      const msg =
        err?.response?.data?.message ||
        err?.message ||
        "Failed to create fee item.";
      setFormError(msg);
    },
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, isActive }) => updateFeeItem(id, { isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["feeItems"] }),
  });

  const onCreate = () => {
    setFormError("");

    const n = normStr(name);
    const c = normCode(code);

    if (n.length < 2) {
      setFormError("Name must be at least 2 characters.");
      return;
    }

    // basic duplicate guards (frontend only; backend should also enforce)
    const nameDup = items.some(
      (it) => normStr(it?.name).toLowerCase() === n.toLowerCase()
    );
    if (nameDup) {
      setFormError("That fee item name already exists.");
      return;
    }

    if (c) {
      const codeDup = items.some(
        (it) => normStr(it?.code).toLowerCase() === c.toLowerCase()
      );
      if (codeDup) {
        setFormError("That fee item code already exists.");
        return;
      }
    }

    createMut.mutate({ name: n, code: c || null });
  };

  return (
    <div className="grid gap-3">
      {/* CREATE */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Create fee item</CardTitle>
        </CardHeader>

        <CardContent className="grid gap-2 md:grid-cols-3">
          <Input
            placeholder="Name (e.g. Tuition)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={createMut.isPending}
          />

          <Input
            placeholder="Code (optional) e.g. TUI"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            disabled={createMut.isPending}
          />

          <Button
            onClick={onCreate}
            disabled={createMut.isPending || normStr(name).length < 2}
          >
            {createMut.isPending ? "Creating…" : "Create"}
          </Button>

          {/* inline validation/error */}
          {formError ? (
            <div className="md:col-span-3 text-sm text-destructive">
              {formError}
            </div>
          ) : (
            <div className="md:col-span-3 text-xs text-muted-foreground">
              Tip: Use short codes like <span className="font-medium">TUI</span>,{" "}
              <span className="font-medium">LUNCH</span>,{" "}
              <span className="font-medium">EXAM</span> for cleaner reports.
            </div>
          )}
        </CardContent>
      </Card>

      {/* LIST */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">Items</CardTitle>

            <Input
              className="max-w-xs"
              placeholder="Search by name or code…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </CardHeader>

        <CardContent>
          <QueryBlock
            isLoading={itemsQ.isLoading}
            isError={itemsQ.isError}
            error={itemsQ.error}
            empty={filtered.length === 0}
            emptyText={q ? "No matching items." : "No fee items yet."}
          >
            <div className="grid gap-2">
              {filtered.map((it) => {
                const isMutating = toggleMut.isPending; // global (simple)
                return (
                  <div
                    key={it.id}
                    className="flex items-center justify-between gap-2 border rounded-md p-3"
                  >
                    <div>
                      <div className="font-medium">{it.name}</div>
                      <div className="text-xs text-muted-foreground">
                        Code: {it.code || "—"} •{" "}
                        {it.isActive ? "Active" : "Inactive"}
                      </div>
                    </div>

                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isMutating}
                      onClick={() =>
                        toggleMut.mutate({ id: it.id, isActive: !it.isActive })
                      }
                    >
                      {isMutating
                        ? "Updating…"
                        : it.isActive
                        ? "Disable"
                        : "Enable"}
                    </Button>
                  </div>
                );
              })}
            </div>
          </QueryBlock>
        </CardContent>
      </Card>
    </div>
  );
}
