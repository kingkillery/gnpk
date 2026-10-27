import { describe, expect, it, vi } from "vitest";
import { createDraftPullRequest, type DraftPrInput } from "./draft-pr.js";

const input: DraftPrInput = {
  baseBranch: "main",
  baseCommit: "a".repeat(40),
  branch: "gnpk/fix-123",
  worktree: "/fixture/worktree",
  runDir: "/fixture/worktree/.gnpk/runs/fix",
  successCount: 1,
  failCount: 0,
  agentError: null,
  hasPendingCommitFailure: false,
};

function fixture(overrides: Record<string, string> = {}) {
  const calls: string[][] = [];
  const git = vi.fn((args: string[]) => {
    calls.push(args);
    const key = args.join(" ");
    if (key in overrides) return overrides[key];
    if (key === "branch --show-current") return input.branch;
    if (key === "status --porcelain") return "";
    if (key.startsWith("merge-base --is-ancestor ")) return "";
    if (key.startsWith("rev-list --count ")) return "1";
    if (key === "config --get remote.origin.url")
      return "https://github.com/example/project.git";
    if (key === "ls-remote --heads origin refs/heads/main")
      return `${input.baseCommit}\trefs/heads/main`;
    if (key === "ls-remote --heads origin refs/heads/gnpk/fix-123") return "";
    if (key === "log -1 --format=%s") return "gnhf 1: verified change";
    if (key.startsWith("push -u origin ")) return "";
    throw new Error(`Unexpected git call: ${key}`);
  });
  const create = vi.fn(() => "https://github.com/example/project/pull/1");
  const write = vi.fn();
  return { git, create, write, calls };
}

describe("draft pull request", () => {
  it("pushes only the isolated branch and creates a draft against the unchanged base", () => {
    const f = fixture();
    expect(createDraftPullRequest(input, f)).toBe(
      "https://github.com/example/project/pull/1",
    );
    expect(f.calls).toContainEqual([
      "push",
      "-u",
      "origin",
      "HEAD:refs/heads/gnpk/fix-123",
    ]);
    expect(f.create).toHaveBeenCalledWith(
      expect.arrayContaining([
        "--draft",
        "--base",
        "main",
        "--head",
        input.branch,
        "--body-file",
      ]),
      input.worktree,
    );
    expect(f.write).toHaveBeenCalledOnce();
  });

  it.each([
    [{ successCount: 0 }, "no successful work"],
    [{ failCount: 1 }, "unresolved failures"],
    [{ agentError: "offline" }, "unresolved failures"],
    [{ hasPendingCommitFailure: true }, "unresolved failures"],
  ])("does not publish an incomplete or failed run", (change, message) => {
    const f = fixture();
    expect(() => createDraftPullRequest({ ...input, ...change }, f)).toThrow(
      message,
    );
    expect(f.git).not.toHaveBeenCalled();
    expect(f.create).not.toHaveBeenCalled();
  });

  it("refuses to publish when the base moved, branch exists, or worktree is dirty", () => {
    const cases: Record<string, string>[] = [
      {
        "ls-remote --heads origin refs/heads/main": `${"b".repeat(40)}\trefs/heads/main`,
      },
      { "ls-remote --heads origin refs/heads/gnpk/fix-123": "already-exists" },
      { "status --porcelain": " M user-file" },
    ];
    for (const overrides of cases) {
      const f = fixture(overrides);
      expect(() => createDraftPullRequest(input, f)).toThrow();
      expect(f.calls.some((args) => args[0] === "push")).toBe(false);
      expect(f.create).not.toHaveBeenCalled();
    }
  });

  it("reports PR creation failure after preserving the pushed branch", () => {
    const f = fixture();
    f.create.mockImplementation(() => {
      throw new Error("GitHub rejected PR");
    });
    expect(() => createDraftPullRequest(input, f)).toThrow(
      "GitHub rejected PR",
    );
    expect(f.calls).toContainEqual([
      "push",
      "-u",
      "origin",
      "HEAD:refs/heads/gnpk/fix-123",
    ]);
  });
});
