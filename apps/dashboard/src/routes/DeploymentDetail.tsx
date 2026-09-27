import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowUpCircle, ExternalLink, RotateCcw } from "lucide-react";
import { api } from "../lib/api.js";
import { StatusBadge } from "../components/StatusBadge.js";
import { EnvironmentBadge } from "../components/EnvironmentBadge.js";
import { LogPanel } from "../components/LogPanel.js";
import { useDeploymentLogs } from "../hooks/useDeploymentLogs.js";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const TERMINAL_STATUSES = new Set(["SUCCESS", "FAILED", "SUPERSEDED"]);

export function DeploymentDetail() {
  const { id } = useParams<{ id: string }>();
  const deploymentId = id!;
  const queryClient = useQueryClient();

  const { data: deployment } = useQuery({
    queryKey: ["deployment", deploymentId],
    queryFn: () => api.getDeployment(deploymentId),
    refetchInterval: (query) => (query.state.data && TERMINAL_STATUSES.has(query.state.data.status) ? false : 2000),
  });

  const { lines } = useDeploymentLogs(deploymentId);

  function invalidateProject() {
    if (deployment) queryClient.invalidateQueries({ queryKey: ["deployments", deployment.projectId] });
  }

  const rollback = useMutation({
    mutationFn: () => api.rollback(deploymentId),
    onSuccess: () => {
      invalidateProject();
      toast.add({ title: "Redeploy queued", type: "success" });
    },
  });
  const promote = useMutation({
    mutationFn: () => api.promote(deploymentId),
    onSuccess: () => {
      invalidateProject();
      toast.add({ title: "Promoted to production", type: "success" });
    },
  });

  if (!deployment) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-[28rem] w-full rounded-xl" />
      </div>
    );
  }

  const isSuccess = deployment.status === "SUCCESS";

  return (
    <div className="space-y-6">
      <div>
        <Link
          to={`/projects/${deployment.projectId}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft data-icon="inline-start" className="size-3.5" />
          Back to project
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={deployment.status} />
            <EnvironmentBadge environment={deployment.environment} />
            <h1 className="font-mono text-lg">{deployment.commitSha.slice(0, 7)}</h1>
            <span className="font-mono text-xs text-muted-foreground">{deployment.branch}</span>
            <span className="text-xs text-muted-foreground">{deployment.trigger}</span>
          </div>
          <div className="flex gap-2">
            {isSuccess && deployment.environment === "PREVIEW" && (
              <Button onClick={() => promote.mutate()} disabled={promote.isPending}>
                {promote.isPending ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <ArrowUpCircle data-icon="inline-start" />
                )}
                {promote.isPending ? "Promoting…" : "Promote to production"}
              </Button>
            )}
            {isSuccess && (
              <Button variant="secondary" onClick={() => rollback.mutate()} disabled={rollback.isPending}>
                {rollback.isPending ? <Spinner data-icon="inline-start" /> : <RotateCcw data-icon="inline-start" />}
                {rollback.isPending ? "Rolling back…" : "Redeploy this build"}
              </Button>
            )}
          </div>
        </div>
        {deployment.commitMessage && (
          <p className="mt-1 text-sm text-muted-foreground">{deployment.commitMessage}</p>
        )}

        <div className="mt-2 space-y-0.5 text-sm">
          {deployment.branchUrl && (
            <div>
              <a
                href={deployment.branchUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                {deployment.branchUrl}
                <ExternalLink className="size-3" />
              </a>
              <span className="ml-2 text-xs text-muted-foreground">branch alias — follows the newest deploy</span>
            </div>
          )}
          {deployment.immutableUrl && (
            <div>
              <a
                href={deployment.immutableUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                {deployment.immutableUrl}
                <ExternalLink className="size-3" />
              </a>
              <span className="ml-2 text-xs text-muted-foreground">this build, permanently</span>
            </div>
          )}
          {isSuccess && deployment.containerRemovedAt && (
            <p className="text-xs text-muted-foreground">Container removed — this build is no longer served.</p>
          )}
        </div>

        {deployment.error && (
          <Alert variant="destructive" className="mt-3">
            <AlertDescription>{deployment.error}</AlertDescription>
          </Alert>
        )}
        {promote.isError && (
          <Alert variant="destructive" className="mt-3">
            <AlertDescription>{(promote.error as Error).message}</AlertDescription>
          </Alert>
        )}
        {rollback.isError && (
          <Alert variant="destructive" className="mt-3">
            <AlertDescription>{(rollback.error as Error).message}</AlertDescription>
          </Alert>
        )}
      </div>

      <Card className="py-0">
        <CardHeader className="border-b py-3">
          <CardTitle className="text-sm text-muted-foreground">Build logs</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <LogPanel lines={lines} />
        </CardContent>
      </Card>
    </div>
  );
}
