import { describe, it, expect } from "vitest";
import { selectContainersToRemove, type SiblingContainer } from "./swap.js";

function sibling(id: string, createdAt: number): SiblingContainer {
  return { id, name: `launchpad-app-x-${id}`, deploymentId: id, createdAt };
}

describe("selectContainersToRemove", () => {
  it("keeps the newest N and returns the rest", () => {
    const removed = selectContainersToRemove([sibling("a", 1), sibling("b", 2), sibling("c", 3)], 2);
    expect(removed.map((c) => c.id)).toEqual(["a"]);
  });

  it("removes nothing when there are fewer siblings than the cap", () => {
    expect(selectContainersToRemove([sibling("a", 1)], 2)).toEqual([]);
  });

  it("removes everything when the cap is zero — how a production swap retires its predecessor", () => {
    const removed = selectContainersToRemove([sibling("a", 1), sibling("b", 2)], 0);
    expect(removed).toHaveLength(2);
  });

  it("orders by creation time, not by input order", () => {
    const removed = selectContainersToRemove([sibling("newest", 300), sibling("oldest", 100), sibling("mid", 200)], 1);
    expect(removed.map((c) => c.id)).toEqual(["mid", "oldest"]);
  });
});
