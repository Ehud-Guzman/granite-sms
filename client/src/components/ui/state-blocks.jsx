import { AlertCircle, Loader2, RefreshCw } from "lucide-react";

import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export function LoadingState({
  title = "Loading…",
  description,
  skeletonCount = 0,
  skeletonClassName = "h-56 w-full rounded-xl",
  gridClassName = "grid gap-4 md:grid-cols-2 lg:grid-cols-3",
  className,
}) {
  return (
    <div className={cn("space-y-4", className)}>
      <div className="text-center py-8">
        <div className="inline-flex items-center justify-center p-3 rounded-full bg-muted mb-4">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
        <h3 className="font-semibold">{title}</h3>
        {description && <p className="text-muted-foreground">{description}</p>}
      </div>
      {skeletonCount > 0 && (
        <div className={gridClassName}>
          {Array.from({ length: skeletonCount }).map((_, i) => (
            <Skeleton key={i} className={skeletonClassName} />
          ))}
        </div>
      )}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
  retryLabel = "Try Again",
  actions,
  bare = false,
  className,
}) {
  const body = (
    <div className={cn("text-center", bare ? "py-8" : "p-8")}>
      <div className="mx-auto w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
        <AlertCircle className="h-7 w-7 text-destructive" />
      </div>
      <h3 className="font-semibold text-lg">{title}</h3>
      {message && <p className="text-muted-foreground mt-2 max-w-md mx-auto">{message}</p>}
      {(onRetry || actions) && (
        <div className="flex gap-2 justify-center mt-6">
          {onRetry && (
            <Button variant="outline" onClick={onRetry} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              {retryLabel}
            </Button>
          )}
          {actions}
        </div>
      )}
    </div>
  );

  if (bare) return <div className={className}>{body}</div>;

  return (
    <Card className={cn("border-destructive/20", className)}>
      <CardContent className="p-0">{body}</CardContent>
    </Card>
  );
}

export function EmptyState({
  icon,
  title = "Nothing here yet",
  description,
  action,
  size = "lg",
  bare = false,
  className,
}) {
  const Icon = icon || AlertCircle;
  const iconWrap = size === "lg" ? "w-16 h-16" : "w-12 h-12";
  const iconSize = size === "lg" ? "h-8 w-8" : "h-6 w-6";
  const pad = size === "lg" ? "p-12" : "py-12";

  const body = (
    <div className={cn("text-center", pad)}>
      <div className={cn("mx-auto rounded-full bg-muted flex items-center justify-center mb-4", iconWrap)}>
        <Icon className={cn("text-muted-foreground", iconSize)} />
      </div>
      <h3 className="font-semibold text-lg">{title}</h3>
      {description && <p className="text-muted-foreground mt-2 max-w-md mx-auto">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );

  if (bare) return <div className={className}>{body}</div>;

  return (
    <Card className={className}>
      <CardContent className="p-0">{body}</CardContent>
    </Card>
  );
}

export function PageSkeleton({
  headerLines = 2,
  showFilterBar = true,
  gridCount = 6,
  gridClassName = "grid gap-4 md:grid-cols-2 lg:grid-cols-3",
  cardClassName = "h-48 w-full",
  className,
}) {
  return (
    <div className={cn("p-6 space-y-6 max-w-7xl mx-auto", className)}>
      <div className="space-y-2">
        <Skeleton className="h-10 w-64" />
        {headerLines > 1 && <Skeleton className="h-4 w-96" />}
      </div>
      {showFilterBar && <Skeleton className="h-12 w-full" />}
      <div className={gridClassName}>
        {Array.from({ length: gridCount }).map((_, i) => (
          <Skeleton key={i} className={cardClassName} />
        ))}
      </div>
    </div>
  );
}
