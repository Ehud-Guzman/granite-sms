// src/middleware/features.js
import { prisma } from "../lib/prisma.js";

const TTL_MS = 3000;

// cache per schoolId to prevent cross-tenant contamination
const cacheBySchool = new Map(); // schoolId -> { settings, ts }

async function getSettingsForSchool(schoolId, { createIfMissing = true } = {}) {
  if (!schoolId) return null;

  let settings = await prisma.schoolSettings.findUnique({
    where: { schoolId: String(schoolId) },
  });

  if (!settings && createIfMissing) {
    settings = await prisma.schoolSettings.create({
      data: { schoolId: String(schoolId) },
    });
  }

  return settings;
}

async function getSettingsCachedForSchool(schoolId, opts = {}) {
  const ttl = opts.ttlMs ?? TTL_MS;
  const now = Date.now();

  const key = String(schoolId);
  const cached = cacheBySchool.get(key);

  if (cached?.settings && now - cached.ts < ttl) return cached.settings;

  const settings = await getSettingsForSchool(key, {
    createIfMissing: opts.createIfMissing ?? true,
  });

  if (settings) cacheBySchool.set(key, { settings, ts: now });
  return settings;
}

/**
 * requireFeature(flagName, options?)
 * options:
 *  - mode: "all" | "write"  (default "all")
 *      "all"   = blocks GET/POST/PATCH/DELETE when disabled
 *      "write" = blocks only non-GET requests when disabled (GET still allowed)
 *  - ttlMs: cache TTL override
 */
export function requireFeature(flagName, options = {}) {
  const mode = options.mode ?? "all";

  return async (req, res, next) => {
    try {
      // IMPORTANT: feature flags are per-tenant
      const schoolId = req.schoolId;
      if (!schoolId) {
        return res.status(400).json({ message: "Tenant required for feature flags" });
      }

      const settings = await getSettingsCachedForSchool(schoolId, {
        ttlMs: options.ttlMs,
        createIfMissing: true,
      });

      if (!settings) {
        return res.status(500).json({ message: "Settings not initialized" });
      }

      // If dev passes wrong flag name, don't silently treat it as "disabled"
      if (!(flagName in settings)) {
        return res.status(500).json({ message: `Unknown feature flag: ${flagName}` });
      }

      const enabled = Boolean(settings[flagName]);

      if (!enabled) {
        const isWrite = req.method !== "GET";
        if (mode === "all" || (mode === "write" && isWrite)) {
          return res.status(403).json({ message: `Feature disabled: ${flagName}` });
        }
      }

      req.settings = settings;
      return next();
    } catch (err) {
      console.error("FEATURE FLAG ERROR:", err);
      return res.status(500).json({ message: "Server error" });
    }
  };
}

// Optional helper: call this after updating settings so changes apply instantly
export function clearSettingsCache(schoolId) {
  if (schoolId) cacheBySchool.delete(String(schoolId));
  else cacheBySchool.clear();
}
