// src/middleware/rateLimits.js
// A whole school usually reaches the internet through ONE public IP address,
// so per-IP limits must be generous and the tight limits must key on the
// account (email or user id) instead. See audit finding H3.
import rateLimit from "express-rate-limit";

const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
const common = { standardHeaders: true, legacyHeaders: false };
const emailOf = (req) => String(req.body?.email || "").trim().toLowerCase();

/** Flood protection per IP. Sized for a full staff room on one connection. */
export const ipLimiter = rateLimit({
  ...common,
  windowMs: 60 * 1000,
  max: num(process.env.RATE_LIMIT_IP_PER_MIN, 1500),
  message: { message: "Too many requests from this network. Please slow down.", code: "RATE_LIMITED" },
});

/** Per signed-in user, mounted after requireAuth. */
export const userLimiter = rateLimit({
  ...common,
  windowMs: 60 * 1000,
  max: num(process.env.RATE_LIMIT_USER_PER_MIN, 300),
  keyGenerator: (req) => `user:${req.user?.id || req.ip}`,
  message: { message: "Too many requests. Please slow down.", code: "RATE_LIMITED" },
});

/**
 * Failed sign-ins for one email from one network. Successful sign-ins don't
 * count, so colleagues sharing the school's IP never block each other, and a
 * stranger on another network can't use up a real user's attempts.
 */
export const loginPerAccountLimiter = rateLimit({
  ...common,
  windowMs: 15 * 60 * 1000,
  max: num(process.env.RATE_LIMIT_LOGIN_PER_ACCOUNT, 10),
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `login:${req.ip}:${emailOf(req)}`,
  message: {
    message: "Too many failed sign-in attempts for this account. Try again in 15 minutes.",
    code: "AUTH_RATE_LIMITED",
  },
});

/** Failed sign-ins from one network across all emails (password spraying). */
export const loginPerIpLimiter = rateLimit({
  ...common,
  windowMs: 15 * 60 * 1000,
  max: num(process.env.RATE_LIMIT_LOGIN_PER_IP, 100),
  skipSuccessfulRequests: true,
  message: { message: "Too many failed sign-in attempts from this network. Try again later.", code: "AUTH_RATE_LIMITED" },
});
