// Which modules the school's plan includes (from /api/me), so the app only
// shows what the school has. The server still checks every request; this
// keeps people from opening screens that would only say "feature locked".
import { useMe } from "@/hooks/useMe";

export const ALL_ON = Object.freeze({ exams: true, fees: true, attendance: true });

/** The module a page belongs to, or null for pages every plan has. */
export function moduleOfPath(path = "") {
  if (/^\/app\/(exams|results|report-cards|reports\/academic)(\/|$)/.test(path) || /\/report-card$/.test(path)) return "exams";
  if (/^\/app\/(fees|reports\/fees)(\/|$)/.test(path) || /\/statement$/.test(path)) return "fees";
  if (/^\/app\/(attendance|reports\/attendance)(\/|$)/.test(path)) return "attendance";
  return null;
}

/** { exams, fees, attendance }: all on until /api/me says otherwise. */
export function usePlanFeatures() {
  const { data } = useMe();
  return { ...ALL_ON, ...(data?.features || {}) };
}

// The reports each role reads; Reports goes from the menu when none are on.
const REPORT_MODULES = { ADMIN: ["fees", "exams", "attendance"], BURSAR: ["fees"], TEACHER: ["attendance"] };

/** Keeps the menu entries whose module is on the plan. */
export function filterByPlan(items, features, role) {
  return (items || []).filter((item) => {
    if (item.to === "/app/reports" && REPORT_MODULES[role]) return REPORT_MODULES[role].some((m) => features[m] !== false);
    const m = moduleOfPath(item.to);
    return !m || features[m] !== false;
  });
}
