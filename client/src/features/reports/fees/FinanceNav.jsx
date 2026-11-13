// The finance report switcher, shared by the three fee reports.
import { TabLinks } from "@/components/insights/Insights";

export default function FinanceNav() {
  return (
    <TabLinks
      tabs={[
        { to: "/app/reports/fees/summary", label: "Summary" },
        { to: "/app/reports/fees/defaulters", label: "Who owes" },
        { to: "/app/reports/fees/collections", label: "Collections" },
      ]}
    />
  );
}
