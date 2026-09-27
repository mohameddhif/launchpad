-- CreateEnum
CREATE TYPE "DeploymentEnvironment" AS ENUM ('PRODUCTION', 'PREVIEW');

-- CreateEnum
CREATE TYPE "EnvVarEnvironment" AS ENUM ('PRODUCTION', 'PREVIEW', 'ALL');

-- AlterEnum
ALTER TYPE "DeploymentTrigger" ADD VALUE 'PROMOTE';

-- AlterTable: rename rather than drop+add, so the tracked branch of existing projects survives.
ALTER TABLE "Project" RENAME COLUMN "branch" TO "productionBranch";
ALTER TABLE "Project" ALTER COLUMN "productionBranch" SET DEFAULT 'main';
ALTER TABLE "Project" ADD COLUMN "previewBranches" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable: branch is added nullable, backfilled below, then made NOT NULL.
ALTER TABLE "Deployment" ADD COLUMN     "branch" TEXT,
ADD COLUMN     "containerRemovedAt" TIMESTAMP(3),
ADD COLUMN     "environment" "DeploymentEnvironment" NOT NULL DEFAULT 'PREVIEW';

-- Every deployment that predates preview support was a production deploy by definition,
-- since the production branch was the only branch that could ever be deployed.
UPDATE "Deployment" d
SET "branch" = p."productionBranch", "environment" = 'PRODUCTION'
FROM "Project" p
WHERE d."projectId" = p."id";

ALTER TABLE "Deployment" ALTER COLUMN "branch" SET NOT NULL;

-- AlterTable
ALTER TABLE "EnvVar" ADD COLUMN     "environment" "EnvVarEnvironment" NOT NULL DEFAULT 'ALL';

-- DropIndex
DROP INDEX "EnvVar_projectId_key_key";

-- CreateTable
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "environment" "DeploymentEnvironment" NOT NULL,
    "latestDeploymentId" TEXT,
    "lastPushAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedUpstream" BOOLEAN NOT NULL DEFAULT false,
    "cleanedUpAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Branch_projectId_name_key" ON "Branch"("projectId", "name");

-- CreateIndex
CREATE INDEX "Deployment_projectId_branch_startedAt_idx" ON "Deployment"("projectId", "branch", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EnvVar_projectId_key_environment_key" ON "EnvVar"("projectId", "key", "environment");

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Give every project that already had deployments a Branch row for its production branch,
-- so the dashboard's branch filter and the cleanup sweep see a consistent picture.
INSERT INTO "Branch" ("id", "projectId", "name", "environment", "latestDeploymentId", "lastPushAt", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, p."id", p."productionBranch", 'PRODUCTION', p."currentDeploymentId", NOW(), NOW(), NOW()
FROM "Project" p
WHERE EXISTS (SELECT 1 FROM "Deployment" d WHERE d."projectId" = p."id");
