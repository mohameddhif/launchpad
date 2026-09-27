import { docker } from "../docker.js";
import type { DeployLogger } from "../deployLogger.js";

export const KEEP_IMAGE_COUNT = 5;

export interface ImageInfo {
  id: string;
  tag: string;
  createdAt: number;
}

/**
 * Pure selection logic: given every built image for a project, decide which ones are safe
 * to remove. Keeps the newest N by build time and never selects a protected tag (the image
 * behind the currently running container, or the last successful deployment), regardless of
 * age — a rollback can make an "old" image current again.
 */
export function selectImagesToRemove(
  images: ImageInfo[],
  keep: number,
  protectedTags: ReadonlySet<string>,
): ImageInfo[] {
  const sorted = [...images].sort((a, b) => b.createdAt - a.createdAt);
  const keepTags = new Set<string>();
  for (const img of sorted) {
    if (keepTags.size >= keep) break;
    keepTags.add(img.tag);
  }
  return sorted.filter((img) => !keepTags.has(img.tag) && !protectedTags.has(img.tag));
}

/**
 * Removes everything selectImagesToRemove() flags, labeled to this project. Best-effort:
 * an image still referenced by some other container fails to remove and is logged, not
 * thrown — retention pruning should never fail the deployment that triggered it.
 */
export async function pruneOldImages(
  projectSlug: string,
  protectedTags: string[],
  logger: DeployLogger,
): Promise<void> {
  const raw = await docker.listImages({
    filters: JSON.stringify({ label: [`launchpad.project=${projectSlug}`] }),
  });

  const images: ImageInfo[] = raw
    .filter((img) => img.RepoTags && img.RepoTags.length > 0)
    .map((img) => ({ id: img.Id, tag: img.RepoTags![0]!, createdAt: img.Created }));

  const toRemove = selectImagesToRemove(images, KEEP_IMAGE_COUNT, new Set(protectedTags));
  if (toRemove.length === 0) return;

  for (const img of toRemove) {
    try {
      await docker.getImage(img.id).remove({ force: false });
      logger.system(`pruned old image ${img.tag}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.log("stderr", `warning: failed to prune image ${img.tag}: ${message}`);
    }
  }
}
