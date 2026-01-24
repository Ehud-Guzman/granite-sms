import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/axios";
import { useMe } from "@/hooks/useMe";
import { getBranding } from "@/api/settingsBranding.api";
import { getPrintSettings } from "@/api/settingsPrint.api";

/**
 * Extract server origin from API baseURL.
 * Example:
 *  - baseURL: http://localhost:5000/api
 *  - result:  http://localhost:5000
 */
function serverOriginFromApi() {
  const base = api?.defaults?.baseURL || "http://localhost:5000/api";
  return String(base)
    .replace(/\/api\/?$/, "")
    .replace(/\/$/, "");
}

/**
 * Convert relative public paths (e.g. /uploads/...)
 * into absolute URLs pointing to the server origin.
 */
function toAbsUrl(p) {
  if (!p) return null;
  const s = String(p);
  if (s.startsWith("http://") || s.startsWith("https://")) return s;

  const origin = serverOriginFromApi();
  return `${origin}${s.startsWith("/") ? "" : "/"}${s}`;
}

export default function PrintLetterhead() {
  const meQ = useMe();

  const brandingQ = useQuery({
    queryKey: ["settings", "branding", "print-letterhead"],
    queryFn: getBranding,
    staleTime: 60_000,
    retry: false,
  });

  const printQ = useQuery({
    queryKey: ["settings", "print", "print-letterhead"],
    queryFn: getPrintSettings,
    staleTime: 60_000,
    retry: false,
  });

  const schoolName =
    meQ.data?.school?.name ||
    meQ.data?.user?.school?.name ||
    "School";

  // default = show logo unless explicitly disabled
  const showLogo = printQ.data?.printShowLogo !== false;
  const headerText = printQ.data?.printHeaderText || "";

  const logoSrc = useMemo(() => {
    const abs = toAbsUrl(brandingQ.data?.brandLogoUrl);
    if (!abs) return null;

    // cache-bust on branding / print update
    const v = brandingQ.data?.updatedAt || printQ.data?.updatedAt;
    return v ? `${abs}?v=${encodeURIComponent(String(v))}` : abs;
  }, [
    brandingQ.data?.brandLogoUrl,
    brandingQ.data?.updatedAt,
    printQ.data?.updatedAt,
  ]);

  return (
    <div className="print-letterhead">
      {showLogo && logoSrc ? (
        <div className="print-letterhead__logoWrap">
          <img
            src={logoSrc}
            alt="School logo"
            className="print-letterhead__logo"
          />
        </div>
      ) : null}

      <div className="print-letterhead__schoolName">
        {String(schoolName).toUpperCase()}
      </div>

      {headerText ? (
        <div className="print-letterhead__headerText">
          {headerText}
        </div>
      ) : null}

      <div className="print-letterhead__rule" />
    </div>
  );
}
