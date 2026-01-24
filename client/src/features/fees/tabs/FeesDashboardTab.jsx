import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function FeesDashboardTab() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Fees overview</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        Use Reports tab for class summary / defaulters / collections.
        <div className="mt-2">
          Recommended workflow: Create items → Create plan → Generate invoice → Record payment → Print receipt.
        </div>
      </CardContent>
    </Card>
  );
}
