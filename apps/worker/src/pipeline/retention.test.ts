import { describe, it, expect } from "vitest";
import { selectImagesToRemove, type ImageInfo } from "./retention.js";

function img(tag: string, createdAt: number): ImageInfo {
  return { id: `sha256:${tag}`, tag, createdAt };
}

describe("selectImagesToRemove", () => {
  it("keeps the newest N and removes the rest", () => {
    const images = [img("a", 1), img("b", 2), img("c", 3), img("d", 4), img("e", 5), img("f", 6), img("g", 7)];
    const removed = selectImagesToRemove(images, 5, new Set());
    expect(removed.map((i) => i.tag).sort()).toEqual(["a", "b"]);
  });

  it("removes nothing when under the keep threshold", () => {
    const images = [img("a", 1), img("b", 2)];
    expect(selectImagesToRemove(images, 5, new Set())).toEqual([]);
  });

  it("never removes a protected tag even if it's the oldest", () => {
    const images = [img("a", 1), img("b", 2), img("c", 3), img("d", 4), img("e", 5), img("f", 6)];
    // "a" is the oldest and would normally be pruned, but it's the currently-live image
    // (e.g. after a rollback pinned an older build back to current).
    const removed = selectImagesToRemove(images, 5, new Set(["a"]));
    expect(removed.map((i) => i.tag)).not.toContain("a");
  });

  it("is a no-op on an empty image list", () => {
    expect(selectImagesToRemove([], 5, new Set())).toEqual([]);
  });

  it("breaks createdAt ties deterministically without losing or duplicating images", () => {
    const images = [img("a", 1), img("b", 1), img("c", 1)];
    const removed = selectImagesToRemove(images, 1, new Set());
    expect(removed).toHaveLength(2);
  });
});
