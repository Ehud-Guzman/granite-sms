import dotenv from "dotenv";
dotenv.config();

import { assertJwtSecretStrong } from "./src/utils/jwt.js";
import { isDemo, isDemoDatabase, dbNameOf } from "./src/config/demo.js";

// Fail loud at boot if the signing secret is missing/weak (auth bypass otherwise).
assertJwtSecretStrong();

// A demo signs strangers in with one click, so it must never run against a
// real database. Refuse to start unless the database name contains "demo".
if (isDemo() && !isDemoDatabase(process.env.DATABASE_URL)) {
  console.error(
    `DEMO_MODE is on but the database "${dbNameOf(process.env.DATABASE_URL) || "?"}" ` +
      `does not have "demo" in its name. Refusing to start.`
  );
  process.exit(1);
}
if (isDemo()) console.log("DEMO MODE: read-only, one-click demo sign-in enabled.");

const { default: app } = await import("./src/app.js");
const PORT = process.env.PORT || 5000;

// ---- Start ----
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});