import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

export interface DetectedFramework {
  name: string;
  dockerfileContents: string;
}

/**
 * Every generated Dockerfile listens on this port, which matches Project.internalPort's
 * default — so detection stays entirely contained here and no port-handling logic has to
 * leak into run/health/proxy.
 */
const PORT = 3000;

interface PackageJson {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

async function readPackageJson(contextDir: string): Promise<PackageJson | null> {
  try {
    return JSON.parse(await readFile(path.join(contextDir, "package.json"), "utf8")) as PackageJson;
  } catch {
    return null;
  }
}

function hasDependency(pkg: PackageJson, name: string): boolean {
  return Boolean(pkg.dependencies?.[name] ?? pkg.devDependencies?.[name]);
}

/** `npm ci` is reproducible but hard-fails without a lockfile, which plenty of repos lack. */
function installCommand(contextDir: string, omitDev: boolean): string {
  const lockfile = existsSync(path.join(contextDir, "package-lock.json"));
  if (lockfile) return omitDev ? "npm ci --omit=dev" : "npm ci";
  return omitDev ? "npm install --omit=dev" : "npm install";
}

function detectNextJs(pkg: PackageJson, install: string): DetectedFramework | null {
  if (!hasDependency(pkg, "next")) return null;
  // Deliberately not assuming next.config.js sets output: "standalone" — the target repo
  // didn't opt into anything for us, so the runtime stage carries node_modules. Heavier
  // image, genuinely zero-config.
  return {
    name: "nextjs",
    dockerfileContents: `FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN ${install}
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=${PORT}
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
EXPOSE ${PORT}
CMD ["npx", "next", "start", "-p", "${PORT}"]
`,
  };
}

/** Build tool -> the directory it writes its production bundle to. */
const STATIC_BUILDERS: Array<[dependency: string, outputDir: string]> = [
  ["vite", "dist"],
  ["react-scripts", "build"],
  ["gatsby", "public"],
];

function detectStaticSite(pkg: PackageJson, install: string): DetectedFramework | null {
  const match = STATIC_BUILDERS.find(([dependency]) => hasDependency(pkg, dependency));
  if (!match || !pkg.scripts?.build) return null;
  const [dependency, outputDir] = match;

  return {
    name: `static:${dependency}`,
    dockerfileContents: `FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN ${install}
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/${outputDir} /usr/share/nginx/html
RUN sed -i 's/listen\\s*80;/listen ${PORT};/' /etc/nginx/conf.d/default.conf
EXPOSE ${PORT}
`,
  };
}

function detectNodeStartScript(pkg: PackageJson, install: string): DetectedFramework | null {
  if (!pkg.scripts?.start) return null;
  return {
    name: "node-start-script",
    dockerfileContents: `FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=${PORT}
COPY package*.json ./
RUN ${install}
COPY . .
EXPOSE ${PORT}
CMD ["npm", "start"]
`,
  };
}

/**
 * Order is load-bearing. Static-site toolchains must be checked before the generic
 * start-script fallback: Create React App also defines `scripts.start`, but that runs its
 * dev server, which is not what you want serving a deployment.
 */
export async function detectFramework(contextDir: string): Promise<DetectedFramework | null> {
  const pkg = await readPackageJson(contextDir);
  if (!pkg) return null;

  // Next.js and static builders need devDependencies too (build tooling usually lives
  // there); the plain start-script fallback is the only case safe to skip them for.
  const buildInstall = installCommand(contextDir, false);
  const runtimeInstall = installCommand(contextDir, true);

  return (
    detectNextJs(pkg, buildInstall) ?? detectStaticSite(pkg, buildInstall) ?? detectNodeStartScript(pkg, runtimeInstall)
  );
}
