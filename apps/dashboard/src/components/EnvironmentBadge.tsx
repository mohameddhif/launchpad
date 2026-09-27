import { Badge } from "@/components/ui/badge";
import type { DeployEnvironment } from "../lib/api.js";

const LABELS: Record<DeployEnvironment, string> = {
  PRODUCTION: "Production",
  PREVIEW: "Preview",
};

export function EnvironmentBadge({ environment }: { environment: DeployEnvironment }) {
  return (
    <Badge variant={environment === "PRODUCTION" ? "default" : "secondary"}>{LABELS[environment]}</Badge>
  );
}
