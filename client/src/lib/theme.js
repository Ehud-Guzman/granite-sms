const PRESETS = {
  "royal-blue": {
    primary: "#111827",
    secondary: "#2563eb",
    primaryHsl: "222 47% 11%",
    secondaryHsl: "221 83% 53%",
  },
  emerald: {
    primary: "#064e3b",
    secondary: "#10b981",
    primaryHsl: "164 94% 16%",
    secondaryHsl: "160 84% 39%",
  },
  maroon: {
    primary: "#3f0d12",
    secondary: "#9f1239",
    primaryHsl: "353 64% 15%",
    secondaryHsl: "346 78% 35%",
  },
  amber: {
    primary: "#1f2937",
    secondary: "#f59e0b",
    primaryHsl: "215 28% 17%",
    secondaryHsl: "38 92% 50%",
  },
  slate: {
    primary: "#0f172a",
    secondary: "#64748b",
    primaryHsl: "222 47% 11%",
    secondaryHsl: "215 19% 47%",
  },
};

const RADII = {
  sharp: "0.25rem",
  rounded: "0.75rem",
  pill: "1.25rem",
};

export function applyTheme(opts = {}) {
  const {
    theme = "royal-blue",
    mode = "light",
    density = "normal",
    radius = "rounded",
  } = opts;

  const root = document.documentElement;

  // keep dataset (useful for debugging + optional CSS hooks)
  root.dataset.theme = PRESETS[theme] ? theme : "royal-blue";

  // density
  if (density && density !== "normal") root.dataset.density = density;
  else delete root.dataset.density;

  // radius -> feeds Tailwind via --radius
  const r = RADII[radius] ? radius : "rounded";
  root.dataset.radius = r;
  root.style.setProperty("--radius", RADII[r]);

  // mode
  if (mode === "dark") root.classList.add("dark");
  else root.classList.remove("dark");

  // preset -> set brand vars (so your Tailwind tokens change)
  const preset = PRESETS[root.dataset.theme];

  root.style.setProperty("--brand-primary", preset.primary);
  root.style.setProperty("--brand-secondary", preset.secondary);
  root.style.setProperty("--brand-primary-hsl", preset.primaryHsl);
  root.style.setProperty("--brand-secondary-hsl", preset.secondaryHsl);

  // ring follows secondary in your tokens
  root.style.setProperty("--ring", preset.secondaryHsl);
}
