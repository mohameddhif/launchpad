import { describe, it, expect } from "vitest";
import { branchFromRef, classifyBranch, deployHosts, githubPushEventSchema, hostLabel } from "./types.js";

describe("branchFromRef", () => {
  it("extracts the branch name from a heads ref", () => {
    expect(branchFromRef("refs/heads/main")).toBe("main");
    expect(branchFromRef("refs/heads/feature/x")).toBe("feature/x");
  });

  it("returns null for a tag ref", () => {
    expect(branchFromRef("refs/tags/v1.0.0")).toBeNull();
  });

  it("returns null for anything without the refs/heads/ prefix", () => {
    expect(branchFromRef("main")).toBeNull();
  });
});

describe("classifyBranch", () => {
  const project = { productionBranch: "main", previewBranches: ["staging", "feature/x"] };

  it("classifies the production branch as PRODUCTION", () => {
    expect(classifyBranch("main", project)).toBe("PRODUCTION");
  });

  it("classifies an allow-listed branch as PREVIEW", () => {
    expect(classifyBranch("staging", project)).toBe("PREVIEW");
    expect(classifyBranch("feature/x", project)).toBe("PREVIEW");
  });

  it("returns null for a branch that is not allow-listed", () => {
    expect(classifyBranch("random-branch", project)).toBeNull();
  });

  it("matches exactly — no prefix or glob behaviour", () => {
    expect(classifyBranch("staging-2", project)).toBeNull();
    expect(classifyBranch("feature/y", project)).toBeNull();
  });

  it("ignores previewBranches entirely when the list is empty", () => {
    expect(classifyBranch("anything", { productionBranch: "main", previewBranches: [] })).toBeNull();
  });
});

describe("hostLabel", () => {
  it("lowercases and replaces characters that are invalid in a DNS label", () => {
    expect(hostLabel("Feature/JIRA-42")).toBe("feature-jira-42");
  });

  it("trims leading and trailing separators", () => {
    expect(hostLabel("/weird/")).toBe("weird");
  });
});

describe("deployHosts", () => {
  const hosts = deployHosts("my-app", "127.0.0.1.nip.io");

  it("builds the bare production host from the slug alone", () => {
    expect(hosts.production).toBe("my-app.127.0.0.1.nip.io");
  });

  it("namespaces branch and deployment hosts so they can never collide with production", () => {
    expect(hosts.branch("staging")).toBe("staging--my-app.127.0.0.1.nip.io");
    expect(hosts.deployment("abc123")).toBe("abc123--my-app.127.0.0.1.nip.io");
  });

  // Long cuids would otherwise overflow nginx's server_names hash bucket.
  it("truncates a deployment id to the same 8 chars used in container names", () => {
    expect(hosts.deployment("cmt4gvw8l0004wuib9ttcupsm")).toBe("cmt4gvw8--my-app.127.0.0.1.nip.io");
  });
});

describe("githubPushEventSchema", () => {
  const base = {
    ref: "refs/heads/main",
    after: "abc123",
    repository: { clone_url: "https://github.com/x/y.git", full_name: "x/y" },
  };

  it("accepts a minimal valid push payload", () => {
    expect(githubPushEventSchema.safeParse(base).success).toBe(true);
  });

  it("defaults deleted to false when absent", () => {
    const parsed = githubPushEventSchema.parse(base);
    expect(parsed.deleted).toBe(false);
  });

  it("accepts deleted: true (branch deletion push)", () => {
    const parsed = githubPushEventSchema.parse({ ...base, deleted: true });
    expect(parsed.deleted).toBe(true);
  });

  it("rejects a payload missing repository", () => {
    const { repository, ...rest } = base;
    expect(githubPushEventSchema.safeParse(rest).success).toBe(false);
  });
});
