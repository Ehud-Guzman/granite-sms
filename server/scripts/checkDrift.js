// Fails if the migrations folder doesn't produce exactly what schema.prisma
// describes (audit finding C3: 6 foreign keys existed only in the schema).
// Needs an EMPTY scratch database for Prisma's shadow copy:
//
//   SHADOW_DATABASE_URL=postgresql://user:pw@localhost:5432/granite_shadow node scripts/checkDrift.js
//
// Or check a real database against the schema (read-only):
//   node scripts/checkDrift.js --db "postgresql://...prod..."
import { spawnSync } from "child_process";

const dbIdx = process.argv.indexOf("--db");
const dbUrl = dbIdx > -1 ? process.argv[dbIdx + 1] : null;
const shadow = process.env.SHADOW_DATABASE_URL;

let args;
if (dbUrl) {
  args = ["prisma", "migrate", "diff", "--from-url", dbUrl, "--to-schema-datamodel", "prisma/schema.prisma", "--script", "--exit-code"];
} else {
  if (!shadow) {
    console.error("Set SHADOW_DATABASE_URL to an empty scratch database, or pass --db <url> to check a real database.");
    process.exit(2);
  }
  args = [
    "prisma", "migrate", "diff",
    "--from-migrations", "prisma/migrations",
    "--to-schema-datamodel", "prisma/schema.prisma",
    "--shadow-database-url", shadow,
    "--script", "--exit-code",
  ];
}

const r = spawnSync("npx", args, { encoding: "utf8", shell: process.platform === "win32" });
if (r.status === 0) {
  console.log(dbUrl ? "Database matches schema.prisma." : "Migrations match schema.prisma.");
  process.exit(0);
}
if (r.status === 2) {
  console.error(dbUrl ? "Database differs from schema.prisma. SQL needed to fix it:\n" : "Migrations differ from schema.prisma. Missing SQL:\n");
  console.error(r.stdout);
  process.exit(1);
}
console.error(r.stderr || r.stdout);
process.exit(r.status ?? 1);
