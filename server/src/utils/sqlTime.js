// src/utils/sqlTime.js
// Grouping by the school's local day inside Postgres (audit 2, A2-PERF-01).
// Prisma stores DateTime as `timestamp(3)` without a zone, holding UTC. These
// helpers turn such a column into the school's local "YYYY-MM-DD" (or
// "YYYY-MM"), and pass instants in as UTC, so the result never depends on
// the database session's TimeZone setting.
import { Prisma } from "@prisma/client";

const COLUMN = /^"[A-Za-z_][A-Za-z0-9_]*"(\."[A-Za-z_][A-Za-z0-9_]*")?$/;

function zoned(column, tz) {
  // Column names are fixed in the code, never user input; checked anyway.
  if (!COLUMN.test(column)) throw new Error(`Bad column for local time: ${column}`);
  return Prisma.sql`((${Prisma.raw(column)} AT TIME ZONE 'UTC') AT TIME ZONE ${tz})`;
}

/** SQL for the local calendar day of a UTC timestamp column, as 'YYYY-MM-DD'. */
export function localDaySql(column, tz) {
  return Prisma.sql`to_char(${zoned(column, tz)}, 'YYYY-MM-DD')`;
}

/** SQL for an instant, comparable with a UTC timestamp column. */
export function utcSql(instant) {
  return Prisma.sql`(${new Date(instant).toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
}
