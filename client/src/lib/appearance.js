// src/lib/appearance.js
import { applyTheme } from "./theme";
import { applyBrandingVars, resetBrandingVars, normalizeHex } from "./branding";

/**
 * ✅ Appearance = Theme preset knobs + optional brand color overrides
 *
 * Contract for brand colors (handled by branding.js):
 * - undefined => do nothing (keep current inline value / let CSS decide)
 * - null / "" => clear inline override (revert to CSS preset/default)
 * - "#rrggbb" => set inline override
 *
 * Why this design works:
 * - Presets are CSS-driven via data-theme.
 * - Overrides are inline CSS vars (only when user actually sets them).
 * - No "always reset" flicker.
 */

/** Normalize incoming settings from API or UI */
export function normalizeAppearance(raw = {}) {
  const s = raw?.branding ?? raw ?? {};

  // normalize hex-ish inputs (allow "", null)
  const p = s.brandPrimaryColor;
  const q = s.brandSecondaryColor;

  return {
    themeKey: s.themeKey ?? "royal-blue",
    mode: s.mode ?? "light",
    density: s.density ?? "normal",
    radius: s.radius ?? "rounded",

    // Keep these as: undefined | null | "" | "#rrggbb"
    brandPrimaryColor: p === undefined ? undefined : (p ? normalizeHex(p) : p),
    brandSecondaryColor: q === undefined ? undefined : (q ? normalizeHex(q) : q),
  };
}

/**
 * Apply appearance to the DOM:
 * 1) Apply theme preset knobs first (dataset + dark class)
 * 2) Apply optional brand overrides (inline vars)
 */
export function applyAppearance(settings = {}) {
  const s = normalizeAppearance(settings);

  // 1) preset baseline
  applyTheme({
    theme: s.themeKey,
    mode: s.mode,
    density: s.density,
    radius: s.radius,
  });

  // 2) optional overrides
  applyBrandingVars({
    brandPrimaryColor: s.brandPrimaryColor,
    brandSecondaryColor: s.brandSecondaryColor,
  });
}

/**
 * Hard reset:
 * - removes inline overrides
 * - resets theme knobs to defaults
 */
export function resetAppearance() {
  resetBrandingVars();
  applyTheme({
    theme: "royal-blue",
    mode: "light",
    density: "normal",
    radius: "rounded",
  });
}

/**
 * Helper for "Use preset colors" UX:
 * Clear only the brand overrides, keep current preset/mode/density/radius.
 */
export function clearBrandOverrides(keep = {}) {
  applyAppearance({
    ...keep,
    brandPrimaryColor: null,
    brandSecondaryColor: null,
  });
}
