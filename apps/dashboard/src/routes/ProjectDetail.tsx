import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, Plus, Rocket, Trash2, X } from "lucide-react";
import { api, type EnvVarEnvironment, type Project } from "../lib/api.js";
import { StatusBadge } from "../components/StatusBadge.js";
import { EnvironmentBadge } from "../components/EnvironmentBadge.js";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ENV_SCOPES: EnvVarEnvironment[] = ["ALL", "PRODUCTION", "PREVIEW"];
const ENV_SCOPE_LABELS: Record<EnvVarEnvironment, string> = {
  ALL: "All environments",
  PRODUCTION: "Production",
  PREVIEW: "Preview",
};
const ENV_SCOPE_ITEMS = ENV_SCOPES.map((scope) => ({ label: ENV_SCOPE_LABELS[scope], value: scope }));

function EnvVarEditor({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const { data: envVars } = useQuery({ queryKey: ["env", projectId], queryFn: () => api.listEnvVars(projectId) });
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [environment, setEnvironment] = useState<EnvVarEnvironment>("ALL");

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["env", projectId] });
  }

  // Each call sends only the one key being changed — the API upserts it and leaves every
  // other variable's (never-decrypted) value untouched.
  const upsert = useMutation({
    mutationFn: (vars: { key: string; value: string; environment: EnvVarEnvironment }) =>
      api.setEnvVars(projectId, vars.environment, { [vars.key]: vars.value }),
    onSuccess: (_data, vars) => {
      invalidate();
      setKey("");
      setValue("");
      toast.add({ title: `${vars.key} saved`, type: "success" });
    },
  });

  const remove = useMutation({
    mutationFn: (v: { key: string; environment: EnvVarEnvironment }) =>
      api.deleteEnvVar(projectId, v.environment, v.key),
    onSuccess: (_data, vars) => {
      invalidate();
      toast.add({ title: `${vars.key} removed`, type: "success" });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Environment variables</CardTitle>
        <CardDescription>
          Values are encrypted at rest and never shown again after saving. Takes effect on the next deploy. A
          Production or Preview value overrides an "All environments" one with the same key.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {ENV_SCOPES.map((scope) => {
          const scoped = envVars?.filter((v) => v.environment === scope) ?? [];
          if (scoped.length === 0) return null;
          return (
            <div key={scope} className="space-y-1.5">
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {ENV_SCOPE_LABELS[scope]}
              </h3>
              <ul className="space-y-1">
                {scoped.map((v) => (
                  <li
                    key={v.id}
                    className="flex items-center justify-between gap-2 rounded-md bg-muted px-2.5 py-1.5 font-mono text-sm"
                  >
                    <span>
                      {v.key} <span className="text-muted-foreground">= ••••••••</span>
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => remove.mutate({ key: v.key, environment: v.environment })}
                      disabled={remove.isPending}
                      aria-label={`Remove ${v.key}`}
                    >
                      <Trash2 />
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        {envVars?.length === 0 && <p className="text-sm text-muted-foreground">None set.</p>}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (key) upsert.mutate({ key, value, environment });
          }}
          className="flex flex-wrap items-end gap-2 border-t pt-4"
        >
          <Field className="min-w-32 flex-1">
            <FieldLabel htmlFor="env-key" className="sr-only">
              Key
            </FieldLabel>
            <Input
              id="env-key"
              placeholder="KEY"
              value={key}
              onChange={(e) => setKey(e.target.value.toUpperCase())}
              className="font-mono"
            />
          </Field>
          <Field className="min-w-32 flex-1">
            <FieldLabel htmlFor="env-value" className="sr-only">
              Value
            </FieldLabel>
            <Input
              id="env-value"
              placeholder="value"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="font-mono"
            />
          </Field>
          <Select
            items={ENV_SCOPE_ITEMS}
            value={environment}
            onValueChange={(v) => setEnvironment(v as EnvVarEnvironment)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {ENV_SCOPE_ITEMS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Button type="submit" variant="secondary" disabled={upsert.isPending || !key}>
            {upsert.isPending ? <Spinner data-icon="inline-start" /> : <Plus data-icon="inline-start" />}
            Set
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function PreviewBranchEditor({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");

  const save = useMutation({
    mutationFn: (previewBranches: string[]) => api.updateProject(project.id, { previewBranches }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project", project.id] });
      setDraft("");
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Preview branches</CardTitle>
        <CardDescription>
          Pushes to these branches get their own preview deployment and URL. Every other branch is ignored.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {project.previewBranches.map((branch) => (
            <Badge
              key={branch}
              variant="secondary"
              render={
                <button
                  type="button"
                  onClick={() => save.mutate(project.previewBranches.filter((b) => b !== branch))}
                  disabled={save.isPending}
                />
              }
              className="font-mono"
            >
              {branch}
              <X data-icon="inline-end" />
            </Badge>
          ))}
          {project.previewBranches.length === 0 && (
            <span className="text-sm text-muted-foreground">None.</span>
          )}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const branch = draft.trim();
            if (branch && !project.previewBranches.includes(branch)) {
              save.mutate([...project.previewBranches, branch]);
            }
          }}
          className="flex gap-2"
        >
          <Input
            placeholder="branch name"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="font-mono"
          />
          <Button type="submit" variant="secondary" disabled={save.isPending || !draft.trim()}>
            {save.isPending ? <Spinner data-icon="inline-start" /> : <Plus data-icon="inline-start" />}
            Add
          </Button>
        </form>
        {save.isError && (
          <Alert variant="destructive">
            <AlertDescription>{(save.error as Error).message}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

export function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const projectId = id!;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [branchFilter, setBranchFilter] = useState<string | null>(null);

  const { data: project } = useQuery({ queryKey: ["project", projectId], queryFn: () => api.getProject(projectId) });
  const { data: deployments } = useQuery({
    queryKey: ["deployments", projectId],
    queryFn: () => api.listDeployments(projectId),
    refetchInterval: 3000,
  });

  const deploy = useMutation({
    mutationFn: () => api.deployProject(projectId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["deployments", projectId] });
      toast.add({ title: "Deployment queued", type: "success" });
    },
  });

  if (!project) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  const branchesSeen = [...new Set(deployments?.map((d) => d.branch) ?? [])];
  const branchFilterItems = [
    { label: "All branches", value: null as string | null },
    ...branchesSeen.map((branch) => ({ label: branch, value: branch })),
  ];
  const visible = branchFilter ? deployments?.filter((d) => d.branch === branchFilter) : deployments;

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft data-icon="inline-start" className="size-3.5" />
          Projects
        </Link>
        <div className="mt-2 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold">{project.name}</h1>
            <p className="truncate text-sm text-muted-foreground">
              {project.repoUrl} · {project.productionBranch}
            </p>
            <a
              href={project.productionUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              {project.productionUrl}
              <ExternalLink className="size-3" />
            </a>
          </div>
          <Button onClick={() => deploy.mutate()} disabled={deploy.isPending} className="shrink-0">
            {deploy.isPending ? <Spinner data-icon="inline-start" /> : <Rocket data-icon="inline-start" />}
            {deploy.isPending ? "Queuing…" : "Deploy"}
          </Button>
        </div>
        {deploy.isError && (
          <Alert variant="destructive" className="mt-3">
            <AlertDescription>{(deploy.error as Error).message}</AlertDescription>
          </Alert>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground">Deploy history</h2>
          {branchesSeen.length > 1 && (
            <Select
              items={branchFilterItems}
              value={branchFilter}
              onValueChange={setBranchFilter}
            >
              <SelectTrigger size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {branchFilterItems.map((item) => (
                    <SelectItem key={item.value ?? "__all__"} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          )}
        </div>

        {visible?.length === 0 ? (
          <Empty className="rounded-xl border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Rocket />
              </EmptyMedia>
              <EmptyTitle>No deployments yet</EmptyTitle>
              <EmptyDescription>Push to {project.productionBranch} or hit Deploy to get started.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Environment</TableHead>
                  <TableHead>Commit</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead className="text-right">Started</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible?.map((d) => (
                  <TableRow
                    key={d.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/deployments/${d.id}`)}
                  >
                    <TableCell>
                      <StatusBadge status={d.status} />
                    </TableCell>
                    <TableCell>
                      <EnvironmentBadge environment={d.environment} />
                    </TableCell>
                    <TableCell className="font-mono text-xs">{d.commitSha.slice(0, 7)}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{d.branch}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{d.trigger}</TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {new Date(d.startedAt).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <PreviewBranchEditor project={project} />
      <EnvVarEditor projectId={projectId} />
    </div>
  );
}
