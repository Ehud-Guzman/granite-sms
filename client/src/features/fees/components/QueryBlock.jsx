export default function QueryBlock({
  isLoading,
  isError,
  error,
  empty,
  emptyText = "No data found.",
  children,
}) {
  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Loading…</div>;
  }

  if (isError) {
    const msg =
      error?.response?.data?.message ||
      error?.message ||
      "Something went wrong.";
    return <div className="text-sm text-destructive">{msg}</div>;
  }

  if (empty) {
    return <div className="text-sm text-muted-foreground">{emptyText}</div>;
  }

  // ✅ only render children when safe
  return <>{children}</>;
}
