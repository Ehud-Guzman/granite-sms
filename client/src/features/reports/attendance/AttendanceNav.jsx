// The attendance report switcher.
import { TabLinks } from "@/components/insights/Insights";

export default function AttendanceNav() {
  return (
    <TabLinks
      tabs={[
        { to: "/app/reports/attendance/summary", label: "Summary" },
        { to: "/app/reports/attendance/defaulters", label: "Frequent absences" },
      ]}
    />
  );
}
