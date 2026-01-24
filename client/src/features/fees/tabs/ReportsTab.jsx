import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { listClasses } from "@/api/classes.api";
import { feesCollections, feesDefaulters, feesClassSummary } from "@/api/fees.api";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

import QueryBlock from "../components/QueryBlock";
import { money } from "../components/FeeMoney";

export default function ReportsTab() {
  const [classId, setClassId] = useState("");
  const [year, setYear] = useState(new Date().getFullYear());
  const [term, setTerm] = useState("TERM1");
  const [minBalance, setMinBalance] = useState(1);

  const [from, setFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));

  const classesQ = useQuery({
    queryKey: ["classes"],
    queryFn: () => listClasses({}),
    staleTime: 5 * 60 * 1000,
  });

  const classes = Array.isArray(classesQ.data) ? classesQ.data : [];

  const classSummaryQ = useQuery({
    queryKey: ["feesReportClassSummary", { classId, year, term }],
    queryFn: () => feesClassSummary({ classId, year, term }),
    enabled: !!classId,
    retry: 1,
  });

  const defaultersQ = useQuery({
    queryKey: ["feesReportDefaulters", { classId, year, term, minBalance }],
    queryFn: () => feesDefaulters({ classId, year, term, minBalance }),
    enabled: !!classId,
    retry: 1,
  });

  const collectionsQ = useQuery({
    queryKey: ["feesReportCollections", { from, to }],
    queryFn: () => feesCollections({ from, to }),
    enabled: !!from && !!to,
    retry: 1,
  });

  // ✅ Normalize responses (prevents "reading 'x' of undefined")
  const classSummary = classSummaryQ.data ?? null;
  const totalBilled = classSummary?.totalBilled ?? 0;
  const totalPaid = classSummary?.totalPaid ?? 0;
  const totalBalance = classSummary?.totalBalance ?? 0;
  const invoiceCount = classSummary?.invoiceCount ?? 0;

  const defaulters = defaultersQ.data ?? null;
  const defaulterRows = useMemo(
    () => (Array.isArray(defaulters?.rows) ? defaulters.rows : []),
    [defaulters]
  );
  const defaulterCount = defaulters?.count ?? defaulterRows.length ?? 0;

  const collections = collectionsQ.data ?? null;
  const totalCollected = collections?.totalCollected ?? 0;
  const paymentsCount = collections?.count ?? 0;
  const byMethod = collections?.byMethod ?? {};

  return (
    <div className="grid gap-3">
      {/* FILTERS */}
      <Card>
       <div className="grid gap-3 print:gap-2" id="fees-reports-print">
          <CardTitle className="text-base">Class filters</CardTitle>
        </div>

        <CardContent className="grid gap-3 md:grid-cols-4">
          <select
            className="h-10 rounded-md border bg-background px-3 text-sm"
            value={classId}
            onChange={(e) => setClassId(e.target.value)}
          >
            <option value="">Select class…</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.stream ? ` ${c.stream}` : ""} ({c.year})
              </option>
            ))}
          </select>

          <Input
            type="number"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          />

          <select
            className="h-10 rounded-md border bg-background px-3 text-sm"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          >
            <option value="TERM1">TERM1</option>
            <option value="TERM2">TERM2</option>
            <option value="TERM3">TERM3</option>
          </select>

          <Input
            type="number"
            value={minBalance}
            onChange={(e) => setMinBalance(Number(e.target.value))}
            placeholder="Min balance"
          />
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-2">
        {/* CLASS SUMMARY */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Class summary</CardTitle>
          </CardHeader>

          <CardContent className="text-sm">
            {!classId && <div className="text-muted-foreground">Pick a class.</div>}

            {!!classId && (
              <QueryBlock
                isLoading={classSummaryQ.isLoading}
                isError={classSummaryQ.isError}
                error={classSummaryQ.error}
                empty={!classSummaryQ.isLoading && !classSummaryQ.isError && !classSummary}
                emptyText="No summary found for these filters."
              >
                <div className="space-y-1">
                  <div>
                    Total billed: <b>{money(totalBilled)}</b>
                  </div>
                  <div>
                    Total paid: <b>{money(totalPaid)}</b>
                  </div>
                  <div>
                    Balance: <b>{money(totalBalance)}</b>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Invoices: {invoiceCount}
                  </div>
                </div>
              </QueryBlock>
            )}
          </CardContent>
        </Card>

        {/* DEFAULTERS */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Defaulters</CardTitle>
          </CardHeader>

          <CardContent className="text-sm space-y-2">
            {!classId && <div className="text-muted-foreground">Pick a class.</div>}

            {!!classId && (
              <QueryBlock
                isLoading={defaultersQ.isLoading}
                isError={defaultersQ.isError}
                error={defaultersQ.error}
                empty={!defaultersQ.isLoading && !defaultersQ.isError && defaulterRows.length === 0}
                emptyText="No defaulters for current filters."
              >
                <div className="space-y-2">
                  <div className="text-xs text-muted-foreground">
                    Count: {defaulterCount}
                  </div>

                  <div className="grid gap-2">
                    {defaulterRows.slice(0, 10).map((r) => (
                      <div key={r.invoiceId} className="border rounded-md p-2">
                        <div className="font-medium">
                          {r.student?.firstName || ""} {r.student?.lastName || ""} (
                          {r.student?.admissionNo || "—"})
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Balance: <b>{money(r.balance ?? 0)}</b> • Paid: {money(r.paid ?? 0)} •
                          Total: {money(r.total ?? 0)} • {r.status || "—"}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </QueryBlock>
            )}
          </CardContent>
        </Card>
      </div>

      {/* COLLECTIONS */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Collections</CardTitle>
        </CardHeader>

        <CardContent className="grid gap-3 md:grid-cols-4">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />

          <div className="md:col-span-2 text-sm">
            <QueryBlock
              isLoading={collectionsQ.isLoading}
              isError={collectionsQ.isError}
              error={collectionsQ.error}
              empty={!collectionsQ.isLoading && !collectionsQ.isError && !collections}
              emptyText="No collections found for this date range."
            >
              <div className="space-y-1">
                <div>
                  Total collected: <b>{money(totalCollected)}</b>
                </div>
                <div className="text-xs text-muted-foreground">
                  Payments: {paymentsCount}
                </div>
              </div>
            </QueryBlock>
          </div>

          {!!collections && (
            <div className="md:col-span-4 text-xs text-muted-foreground">
              By method:{" "}
              {Object.entries(byMethod)
                .map(([k, v]) => `${k}: ${money(v ?? 0)}`)
                .join(" • ")}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
