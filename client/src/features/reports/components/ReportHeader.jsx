export default function ReportHeader({ title, subtitle }) {
  return (
    <div className="hidden print:block mb-4">
      <div className="text-lg font-semibold">{title}</div>
      {subtitle && <div className="text-sm opacity-70">{subtitle}</div>}
      <div className="mt-2 border-b" />
    </div>
  );
}
