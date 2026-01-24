export function normalizeHex(v) {
  const s = (v || "").trim();
  if (!s) return "";
  return s.startsWith("#") ? s : `#${s}`;
}

export function isValidHex(v) {
  if (!v) return true;
  return /^#([0-9a-fA-F]{6})$/.test(String(v).trim());
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
      default:
        break;
    }
    hh = Math.round(hh * 60);
    if (hh < 0) hh += 360;
  }

  const S = Math.round(ss * 100);
  const L = Math.round(ll * 100);
  return `${hh} ${S}% ${L}%`;
}

export function applyBrandingVars(branding) {
  const root = document.documentElement;

  const primaryHex = branding?.brandPrimaryColor || "#111827";
  const secondaryHex = branding?.brandSecondaryColor || "#2563eb";

  root.style.setProperty("--brand-primary", primaryHex);
  root.style.setProperty("--brand-secondary", secondaryHex);

  const primaryHsl = hexToHslTriplet(primaryHex);
  const secondaryHsl = hexToHslTriplet(secondaryHex);

  if (primaryHsl) root.style.setProperty("--brand-primary-hsl", primaryHsl);
  if (secondaryHsl) root.style.setProperty("--brand-secondary-hsl", secondaryHsl);
}

export function resetBrandingVars() {
  const root = document.documentElement;
  root.style.removeProperty("--brand-primary");
  root.style.removeProperty("--brand-secondary");
  root.style.removeProperty("--brand-primary-hsl");
  root.style.removeProperty("--brand-secondary-hsl");
}
