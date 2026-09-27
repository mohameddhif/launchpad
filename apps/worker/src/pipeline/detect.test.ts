import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { detectFramework } from "./detect.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "launchpad-detect-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writePackageJson(contents: Record<string, unknown>): Promise<void> {
  await writeFile(path.join(dir, "package.json"), JSON.stringify(contents), "utf8");
}

describe("detectFramework", () => {
  it("returns null when there is no package.json to inspect", async () => {
    expect(await detectFramework(dir)).toBeNull();
  });

  it("returns null for a package.json with no start script and no known framework", async () => {
    await writePackageJson({ name: "lib", scripts: { test: "vitest" } });
    expect(await detectFramework(dir)).toBeNull();
  });

  it("detects Next.js and serves it on port 3000", async () => {
    await writePackageJson({ dependencies: { next: "15.0.0" }, scripts: { build: "next build" } });
    const detected = await detectFramework(dir);
    expect(detected?.name).toBe("nextjs");
    expect(detected?.dockerfileContents).toContain("next");
    expect(detected?.dockerfileContents).toContain("EXPOSE 3000");
  });

  it("prefers Next.js over the generic start-script fallback", async () => {
    await writePackageJson({
      dependencies: { next: "15.0.0" },
      scripts: { build: "next build", start: "next start" },
    });
    expect((await detectFramework(dir))?.name).toBe("nextjs");
  });

  // CRA defines scripts.start too, but it runs the dev server — detecting it as a static
  // site is what keeps a deployment from serving webpack-dev-server.
  it("detects a static site before falling back to the start script", async () => {
    await writePackageJson({
      devDependencies: { "react-scripts": "5.0.0" },
      scripts: { build: "react-scripts build", start: "react-scripts start" },
    });
    const detected = await detectFramework(dir);
    expect(detected?.name).toBe("static:react-scripts");
    expect(detected?.dockerfileContents).toContain("/app/build /usr/share/nginx/html");
  });

  it("maps each static builder to its own output directory", async () => {
    await writePackageJson({ devDependencies: { vite: "5.0.0" }, scripts: { build: "vite build" } });
    expect((await detectFramework(dir))?.dockerfileContents).toContain("/app/dist /usr/share/nginx/html");
  });

  it("falls back to the start script for a plain Node app", async () => {
    await writePackageJson({ dependencies: { express: "4.0.0" }, scripts: { start: "node server.js" } });
    const detected = await detectFramework(dir);
    expect(detected?.name).toBe("node-start-script");
    expect(detected?.dockerfileContents).toContain('CMD ["npm", "start"]');
  });

  it("uses npm install, not npm ci, when there is no lockfile", async () => {
    await writePackageJson({ dependencies: { express: "4.0.0" }, scripts: { start: "node server.js" } });
    expect((await detectFramework(dir))?.dockerfileContents).toContain("RUN npm install --omit=dev");
  });

  it("uses npm ci when a lockfile is present", async () => {
    await writePackageJson({ dependencies: { express: "4.0.0" }, scripts: { start: "node server.js" } });
    await writeFile(path.join(dir, "package-lock.json"), "{}", "utf8");
    expect((await detectFramework(dir))?.dockerfileContents).toContain("RUN npm ci --omit=dev");
  });

  it("does not treat a static builder without a build script as a static site", async () => {
    await writePackageJson({ devDependencies: { vite: "5.0.0" }, scripts: { start: "node server.js" } });
    expect((await detectFramework(dir))?.name).toBe("node-start-script");
  });

  it("only looks at the repo root, not nested packages", async () => {
    await mkdir(path.join(dir, "apps", "web"), { recursive: true });
    await writeFile(
      path.join(dir, "apps", "web", "package.json"),
      JSON.stringify({ dependencies: { next: "15.0.0" } }),
      "utf8",
    );
    expect(await detectFramework(dir)).toBeNull();
  });
});
