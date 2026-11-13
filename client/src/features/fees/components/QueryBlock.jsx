import { getErrorMessage } from "@/lib/errors";
import { RowsSkeleton } from "@/components/ui/state-blocks";

export default function QueryBlock({
  isLoading,
  isError,
  error,
  empty,
  emptyText = "No data found.",
  children,
}) {
  if (isLoading) {
    return <RowsSkeleton />;
  }

  if (isError) {
    const msg = getErrorMessage(error, "Something went wrong.");
    return <div className="text-sm text-destructive">{msg}</div>;
  }

  if (empty) {
    return <div className="text-sm text-muted-foreground">{emptyText}</div>;
  }

  // ✅ only render children when safe
  return <>{children}</>;
}
