// Runs once before the suite: checks the test database is safe to write to,
// then applies all migrations to it (same as production's `migrate deploy`).
import { execSync } from "child_process";

function dbNameOf(url) {
  const m = /^postgres(?:ql)?:\/\/[^/]+\/([^/?#]*)/i.exec(String(url || "").trim());
  return m ? decodeURIComponent(m[1]) : "";
}

export default function setup() {
  const url = process.env.TEST_DATABASE_URL || "";
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Point it at a throwaway Postgres database " +
        'whose name contains "test", e.g. postgresql://user:pw@127.0.0.1:5432/granite_test'
    );
  }
  if (!/test/i.test(dbNameOf(url))) {
    throw new Error(`Refusing to run tests: database "${dbNameOf(url)}" does not have "test" in its name.`);
  }

  execSync("npx prisma migrate deploy", {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: url },
  });
}
