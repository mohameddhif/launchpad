import { cn } from "@/lib/utils";
import type { DeploymentStatus } from "../lib/api.js";

const DOT_STYLES: Record<DeploymentStatus, string> = {
  QUEUED: "bg-muted-foreground/50",
  BUILDING: "bg-amber-500 animate-pulse",
  DEPLOYING: "bg-amber-500 animate-pulse",
  SUCCESS: "bg-emerald-500",
  FAILED: "bg-red-500",
  SUPERSEDED: "bg-muted-foreground/30",
};

const LABELS: Record<DeploymentStatus, string> = {
  QUEUED: "Queued",
  BUILDING: "Building",
  DEPLOYING: "Deploying",
  SUCCESS: "Ready",
  FAILED: "Failed",
  SUPERSEDED: "Superseded",
};

const TEXT_STYLES: Record<DeploymentStatus, string> = {
  QUEUED: "text-muted-foreground",
  BUILDING: "text-amber-600",
  DEPLOYING: "text-amber-600",
  SUCCESS: "text-emerald-600",
  FAILED: "text-red-600",
  SUPERSEDED: "text-muted-foreground",
};

export function StatusBadge({ status }: { status: DeploymentStatus }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm font-medium", TEXT_STYLES[status])}>
      <span className={cn("size-1.5 shrink-0 rounded-full", DOT_STYLES[status])} />
      {LABELS[status]}
    </span>
  );
}
