import pkg from "@prisma/client";

const { PrismaClient } = pkg;

const globalForPrisma = globalThis;

// Dev-only query counter (audit 2, A2-PERF-01). With QUERY_STATS=1 (never in
// production) every SQL statement Prisma sends is counted against the request
// in flight, and app.js returns the count and total database time in the
// X-Query-Count and Server-Timing headers. Used to measure slow endpoints.
// Prisma's query events don't carry the caller's async context, so a
// statement is credited to the only open request; when requests overlap the
// count is marked approximate ("~"). Time endpoints one call at a time.
export const QUERY_STATS = process.env.QUERY_STATS === "1" && process.env.NODE_ENV !== "production";
export const openRequestStats = new Set();

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: QUERY_STATS ? ["error", "warn", { emit: "event", level: "query" }] : ["error", "warn"],
  });

if (QUERY_STATS && !globalForPrisma.prismaStatsHooked) {
  globalForPrisma.prismaStatsHooked = true;
  prisma.$on("query", (e) => {
    const shared = openRequestStats.size > 1;
    for (const s of openRequestStats) {
      s.count += 1;
      s.dbMs += Number(e.duration) || 0;
      if (shared) s.approx = true;
    }
  });
}

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
