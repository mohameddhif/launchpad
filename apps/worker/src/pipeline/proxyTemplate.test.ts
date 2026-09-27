import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import Handlebars from "handlebars";
import { buildProxyTargets, toLiveContainers, type LiveContainer } from "./proxyTargets.js";

const TEMPLATE_DIR = path.resolve(import.meta.dirname, "../../../nginx-templates");

function render(templateName: string, targets: ReturnType<typeof buildProxyTargets>, domain = OPTIONS.domain): string {
  const src = readFileSync(path.join(TEMPLATE_DIR, templateName), "utf8");
  return Handlebars.compile(src)({ targets, domain });
}

const OPTIONS = { slug: "my-app", domain: "127.0.0.1.nip.io", productionBranch: "main", internalPort: 3000 };

function container(overrides: Partial<LiveContainer> & Pick<LiveContainer, "branch" | "deploymentId">): LiveContainer {
  return {
    containerName: `launchpad-app-my-app-${overrides.deploymentId.slice(0, 8)}`,
    createdAt: 1000,
    ...overrides,
  };
}

describe("buildProxyTargets", () => {
  it("gives the current production container the bare host, its branch alias, and its own host", () => {
    const targets = buildProxyTargets([container({ branch: "main", deploymentId: "dep11111" })], OPTIONS);
    expect(targets).toHaveLength(1);
    expect(targets[0]!.serverNames).toEqual([
      "dep11111--my-app.127.0.0.1.nip.io",
      "main--my-app.127.0.0.1.nip.io",
      "my-app.127.0.0.1.nip.io",
    ]);
  });

  it("never gives a preview branch the bare production host", () => {
    const targets = buildProxyTargets([container({ branch: "feat", deploymentId: "dep22222" })], OPTIONS);
    expect(targets[0]!.serverNames).toEqual([
      "dep22222--my-app.127.0.0.1.nip.io",
      "feat--my-app.127.0.0.1.nip.io",
    ]);
  });

  it("moves the branch alias to the newest container but keeps older immutable hosts", () => {
    const targets = buildProxyTargets(
      [
        container({ branch: "feat", deploymentId: "old00000", createdAt: 100 }),
        container({ branch: "feat", deploymentId: "new00000", createdAt: 200 }),
      ],
      OPTIONS,
    );

    const newest = targets.find((t) => t.serverNames[0]!.startsWith("new00000"))!;
    const older = targets.find((t) => t.serverNames[0]!.startsWith("old00000"))!;
    expect(newest.serverNames).toContain("feat--my-app.127.0.0.1.nip.io");
    expect(older.serverNames).toEqual(["old00000--my-app.127.0.0.1.nip.io"]);
  });

  it("keeps each branch's alias independent", () => {
    const targets = buildProxyTargets(
      [
        container({ branch: "main", deploymentId: "prod0000" }),
        container({ branch: "feat", deploymentId: "prev0000" }),
      ],
      OPTIONS,
    );
    const hosts = targets.flatMap((t) => t.serverNames);
    expect(hosts).toContain("main--my-app.127.0.0.1.nip.io");
    expect(hosts).toContain("feat--my-app.127.0.0.1.nip.io");
    expect(hosts.filter((h) => h === "my-app.127.0.0.1.nip.io")).toHaveLength(1);
  });

  it("sanitizes branch names that are not valid DNS labels", () => {
    const targets = buildProxyTargets([container({ branch: "feature/JIRA-12", deploymentId: "dep33333" })], OPTIONS);
    expect(targets[0]!.serverNames).toContain("feature-jira-12--my-app.127.0.0.1.nip.io");
  });
});

describe("toLiveContainers", () => {
  it("ignores containers missing the branch or deployment label", () => {
    const live = toLiveContainers([
      { Names: ["/a"], Created: 1, Labels: { "launchpad.branch": "main", "launchpad.deployment": "d1" } },
      { Names: ["/b"], Created: 2, Labels: { "launchpad.branch": "main" } },
      { Names: ["/c"], Created: 3, Labels: {} },
    ]);
    expect(live).toHaveLength(1);
    expect(live[0]!.containerName).toBe("a");
  });
});

describe("http.conf.hbs", () => {
  it("renders one server block per live container", () => {
    const out = render(
      "http.conf.hbs",
      buildProxyTargets(
        [
          container({ branch: "main", deploymentId: "prod0000" }),
          container({ branch: "feat", deploymentId: "prev0000" }),
        ],
        OPTIONS,
      ),
    );
    expect(out.match(/listen 80;/g)).toHaveLength(2);
    expect(out).toContain("server_name prod0000--my-app.127.0.0.1.nip.io main--my-app.127.0.0.1.nip.io my-app.127.0.0.1.nip.io;");
    expect(out).toContain("proxy_pass http://launchpad-app-my-app-prod0000:3000;");
    expect(out).not.toContain("ssl_certificate");
  });
});

describe("tls.conf.hbs", () => {
  it("renders an HTTPS block plus an HTTP->HTTPS redirect for the same hosts", () => {
    const out = render("tls.conf.hbs", buildProxyTargets([container({ branch: "main", deploymentId: "prod0000" })], OPTIONS));
    expect(out).toContain("listen 443 ssl;");
    expect(out).toContain("return 301 https://$host$request_uri;");
    expect(out).toContain("proxy_pass http://launchpad-app-my-app-prod0000:3000;");
    expect(out).toContain("ssl_certificate     /etc/nginx/certs/live/127.0.0.1.nip.io/fullchain.pem;");
  });
});

describe("template variable substitution", () => {
  const targets = buildProxyTargets([container({ branch: "main", deploymentId: "prod0000" })], OPTIONS);

  it("does not leave any unresolved handlebars tokens", () => {
    for (const name of ["http.conf.hbs", "tls.conf.hbs"]) {
      expect(render(name, targets)).not.toMatch(/\{\{.*\}\}/);
    }
  });

  it("renders nothing at all when a project has no live containers", () => {
    for (const name of ["http.conf.hbs", "tls.conf.hbs"]) {
      expect(render(name, []).trim()).toBe("");
    }
  });

  it("substitutes a different project/domain distinctly (no cross-project bleed)", () => {
    const other = render(
      "http.conf.hbs",
      buildProxyTargets(
        [{ containerName: "launchpad-app-other-app-ffff0000", branch: "main", deploymentId: "ffff0000", createdAt: 1 }],
        { ...OPTIONS, slug: "other-app", domain: "example.com" },
      ),
    );
    expect(other).toContain("other-app.example.com;");
    expect(other).not.toContain("my-app");
  });
});
