import { defineConfig } from "vitest/config";

// Integration tests run the real Express app against a real Postgres.
// TEST_DATABASE_URL must point at a throwaway database whose name contains
// "test" — tests/globalSetup.js refuses anything else, because the suite
// writes freely to it.
const TEST_DB = process.env.TEST_DATABASE_URL || "";

export default defineConfig({
  test: {
    environment: "node",
    globalSetup: ["./tests/globalSetup.js"],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: TEST_DB,
      JWT_SECRET: "test-only-secret-not-for-production-0123456789",
      JWT_ISSUER: "sms-api",
      JWT_AUDIENCE: "sms-client",
      DEMO_MODE: "false",
    },
  },
});
