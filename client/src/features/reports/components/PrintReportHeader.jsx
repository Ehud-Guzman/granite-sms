import { useMe } from "@/hooks/useMe";

function safeText(v, fallback = "—") {
  const s = String(v ?? "").trim();
  return s ? s : fallback;
}

export default function PrintReportHeader({ title, subtitle }) {
  const { data } = useMe();

  // Try common shapes (adjusts automatically, no crash)
  const schoolName =
    data?.school?.name ||
    data?.user?.school?.name ||
    data?.schoolName ||
    null;

  const schoolCode =
    data?.school?.code ||
    data?.user?.school?.code ||
    null;

  return (
    <div className="hidden print:block mb-4">
      <div className="flex items-start justify-between gap-6">
        <div>
          <div className="text-lg font-semibold">{safeText(schoolName, "School")}</div>
          {schoolCode ? (
            <div className="text-xs opacity-70">Code: {schoolCode}</div>
          ) : null}
        </div>

        <div className="text-right">
          <div className="text-lg font-semibold">{title}</div>
          {subtitle ? <div className="text-sm opacity-70">{subtitle}</div> : null}
        </div>
      </div>

      <div className="mt-2 border-b" />
    </div>
  );
}
