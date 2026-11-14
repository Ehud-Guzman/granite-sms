// Imported first by the audit-2 sweeps, before src/app.js.
// The sweeps send a few thousand requests from one test process, so the
// per-user and per-IP limits are raised for this file only. A 429 would
// otherwise hide the real answer.
process.env.RATE_LIMIT_USER_PER_MIN = "1000000";
process.env.RATE_LIMIT_IP_PER_MIN = "1000000";

export {};
