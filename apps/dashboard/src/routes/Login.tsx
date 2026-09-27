import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Rocket } from "lucide-react";
import { useAuth } from "../hooks/useAuth.js";
import { ApiError } from "../lib/api.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";

export function Login() {
  const { isAuthenticated, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    login.mutate(
      { email, password },
      { onSuccess: () => navigate("/") },
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="mb-1 flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Rocket className="size-4.5" />
          </div>
          <CardTitle className="text-lg">Sign in to Launchpad</CardTitle>
          <CardDescription>Manage your deployments and preview environments.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="password">Password</FieldLabel>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
              {login.isError && (
                <Alert variant="destructive">
                  <AlertDescription>
                    {login.error instanceof ApiError ? login.error.message : "Login failed"}
                  </AlertDescription>
                </Alert>
              )}
              <Button type="submit" disabled={login.isPending} className="w-full">
                {login.isPending && <Spinner data-icon="inline-start" />}
                {login.isPending ? "Signing in…" : "Sign in"}
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
