// src/components/demo/DemoBanner.jsx
import { useLocation } from "react-router-dom";
import { IS_DEMO, PORTFOLIO_URL } from "@/lib/demo";
import { getToken, logout } from "@/api/auth.api";

// A thin strip at the top of every screen of the demo, in the page flow so it
// never covers anything: what this is, a way to try another role, and the
// way back to the portfolio.
export default function DemoBanner() {
  const { pathname } = useLocation();
  if (!IS_DEMO) return null;

  const signedIn = !!getToken() && !pathname.startsWith("/auth/login");

  return (
    <div
      role="note"
      className="w-full bg-slate-900 px-3 py-1.5 text-center text-xs font-medium text-white"
    >
      Live demo · sample data · read-only
      {signedIn && (
        <>
          {" · "}
          <button type="button" onClick={logout} className="underline underline-offset-2">
            Try another role
          </button>
        </>
      )}
      {PORTFOLIO_URL && (
        <>
          {" · "}
          <a href={PORTFOLIO_URL} className="underline underline-offset-2">
            Back to portfolio
          </a>
        </>
      )}
    </div>
  );
}
