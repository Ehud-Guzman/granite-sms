export function normalizeHex(v) {
  const s = String(v ?? "").trim();
  if (!s) return "";
  return s.startsWith("#") ? s : `#${s}`;
}

export function isValidHex(v) {
  if (v == null) return true; // null allowed (means clear)
  const s = String(v).trim();
  if (!s) return true; // empty allowed
  return /^#([0-9a-fA-F]{6})$/.test(s.startsWith("#") ? s : `#${s}`);
}

// ---- HEX -> HSL (returns "H S% L%" triplet) ----
function hexToHslTriplet(hex) {
  const h = normalizeHex(hex);
  if (!h || h.length !== 7) return null;

  const r = parseInt(h.slice(1, 3), 16) / 255;
  const g = parseInt(h.slice(3, 5), 16) / 255;
  const b = parseInt(h.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;

  let hh = 0;
  let ss = 0;
  const ll = (max + min) / 2;

  if (d !== 0) {
    ss = d / (1 - Math.abs(2 * ll - 1));
    switch (max) {
      case r:
        hh = ((g - b) / d) % 6;
        break;
      case g:
        hh = (b - r) / d + 2;
        break;
      case b:
        hh = (r - g) / d + 4;
        break;
    }
    hh = Math.round(hh * 60);
    if (hh < 0) hh += 360;
  }

  const S = Math.round(ss * 100);
  const L = Math.round(ll * 100);
  return `${hh} ${S}% ${L}%`;
}

/**
 * Smart apply:
 * - undefined => do nothing (lets preset/theme decide)
 * - null/""   => clear (revert to CSS defaults)
 * - "#rrggbb" => set and compute HSL vars
 */
export function applyBrandingVars(branding = {}) {
  const root = document.documentElement;

  const primary = branding.brandPrimaryColor;
  const secondary = branding.brandSecondaryColor;

  // Primary
  if (primary === undefined) {
    // do nothing
  } else {
    const p = normalizeHex(primary);
    if (!p) {
      root.style.removeProperty("--brand-primary");
      root.style.removeProperty("--brand-primary-hsl");
    } else {
      root.style.setProperty("--brand-primary", p);
      const hsl = hexToHslTriplet(p);
      if (hsl) root.style.setProperty("--brand-primary-hsl", hsl);
    }
  }

  // Secondary
  if (secondary === undefined) {
    // do nothing
  } else {
    const s = normalizeHex(secondary);
    if (!s) {
      root.style.removeProperty("--brand-secondary");
      root.style.removeProperty("--brand-secondary-hsl");
      // ring usually tracks secondary
      root.style.removeProperty("--ring");
    } else {
      root.style.setProperty("--brand-secondary", s);
      const hsl = hexToHslTriplet(s);
      if (hsl) {
        root.style.setProperty("--brand-secondary-hsl", hsl);
        root.style.setProperty("--ring", hsl);
      }
    }
  }
}

export function resetBrandingVars() {
  const root = document.documentElement;
  root.style.removeProperty("--brand-primary");
  root.style.removeProperty("--brand-secondary");
  root.style.removeProperty("--brand-primary-hsl");
  root.style.removeProperty("--brand-secondary-hsl");
  root.style.removeProperty("--ring");
}
