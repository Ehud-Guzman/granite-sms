import { useQuery } from "@tanstack/react-query";
import { getPrintSettings } from "@/api/printSettings.api";



export default function PrintFooter() {
  const printQ = useQuery({
    queryKey: ["settings", "print"],
    queryFn: getPrintSettings,
    staleTime: 60_000,
  });

  const s = printQ.data || {};
  const footerText = s.printFooterText || "";





  return (
    <div className="print-footer">
      {footerText ? (
        <div className="print-footer__text">{footerText}</div>
      ) : null}

    </div>
  );
}
