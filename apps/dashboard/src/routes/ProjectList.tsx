import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, FolderGit2, GitBranch, Plus } from "lucide-react";
import { api, type ProjectWithSecret } from "../lib/api.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function NewProjectForm({ onCreated }: { onCreated: (p: ProjectWithSecret) => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [productionBranch, setProductionBranch] = useState("main");
  const [internalPort, setInternalPort] = useState(3000);

  const create = useMutation({
    mutationFn: () =>
      api.createProject({ name, slug: slugify(name), repoUrl, productionBranch, internalPort, healthPath: "/" }),
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setName("");
      setRepoUrl("");
      onCreated(project);
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connect a repo</CardTitle>
        <CardDescription>Push to your production branch to trigger a deploy.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          id="new-project-form"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <FieldGroup className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="project-name">Project name</FieldLabel>
              <Input id="project-name" required value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="production-branch">Production branch</FieldLabel>
              <Input
                id="production-branch"
                value={productionBranch}
                onChange={(e) => setProductionBranch(e.target.value)}
              />
            </Field>
            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="repo-url">Repo URL</FieldLabel>
              <Input
                id="repo-url"
                placeholder="https://github.com/you/repo.git"
                required
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="internal-port">Container port</FieldLabel>
              <Input
                id="internal-port"
                type="number"
                value={internalPort}
                onChange={(e) => setInternalPort(Number(e.target.value))}
              />
            </Field>
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter className="justify-end">
        <Button type="submit" form="new-project-form" disabled={create.isPending}>
          {create.isPending ? <Spinner data-icon="inline-start" /> : <Plus data-icon="inline-start" />}
          {create.isPending ? "Creating…" : "Create project"}
        </Button>
      </CardFooter>
    </Card>
  );
}

export function ProjectList() {
  const { data: projects, isLoading } = useQuery({ queryKey: ["projects"], queryFn: api.listProjects });
  const [justCreated, setJustCreated] = useState<ProjectWithSecret | null>(null);

  return (
    <div className="space-y-6">
      {justCreated && (
        <Alert>
          <CheckCircle2 />
          <AlertTitle>Project created</AlertTitle>
          <AlertDescription>
            <p>Add this webhook to your repo (Settings → Webhooks) to enable push-to-deploy:</p>
            <div className="mt-2 space-y-1.5 rounded-md bg-muted p-3 font-mono text-xs text-foreground">
              <div>
                URL: <span className="break-all">/webhooks/github/{justCreated.id}</span>
              </div>
              <div>
                Secret: <span className="break-all">{justCreated.webhookSecret}</span>
              </div>
              <div>Content type: application/json</div>
            </div>
            <p className="mt-2">This secret is shown once. Store it now — Launchpad only keeps it encrypted.</p>
          </AlertDescription>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2"
            onClick={() => setJustCreated(null)}
          >
            Dismiss
          </Button>
        </Alert>
      )}

      <NewProjectForm onCreated={setJustCreated} />

      <div className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Projects</h2>

        {isLoading && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Skeleton className="h-28 rounded-xl" />
            <Skeleton className="h-28 rounded-xl" />
          </div>
        )}

        {!isLoading && projects?.length === 0 && (
          <Empty className="rounded-xl border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FolderGit2 />
              </EmptyMedia>
              <EmptyTitle>No projects yet</EmptyTitle>
              <EmptyDescription>Connect a repo above to deploy your first project.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}

        {projects && projects.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            {projects.map((p) => (
              <Link key={p.id} to={`/projects/${p.id}`} className="block">
                <Card className="h-full transition-colors hover:bg-muted/40">
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between gap-2">
                      <span className="truncate">{p.name}</span>
                      {p.previewBranches.length > 0 && (
                        <Badge variant="secondary" className="shrink-0">
                          <GitBranch data-icon="inline-start" />
                          {p.previewBranches.length}
                        </Badge>
                      )}
                    </CardTitle>
                    <CardDescription className="truncate">{p.repoUrl}</CardDescription>
                  </CardHeader>
                  <CardContent className="text-xs text-muted-foreground">
                    {p.slug} · {p.productionBranch}
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
