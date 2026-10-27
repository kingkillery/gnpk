import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { gitForDraftPr } from "./git.js";

export interface DraftPrInput {
  baseBranch: string;
  baseCommit: string;
  branch: string;
  worktree: string;
  runDir: string;
  successCount: number;
  failCount: number;
  agentError: string | null;
  hasPendingCommitFailure: boolean;
}

export interface DraftPrDeps {
  git?: (args: string[], cwd: string) => string;
  create?: (args: string[], cwd: string) => string;
  write?: (path: string, body: string) => void;
}

/** Publish only the finished isolated branch; never push or merge the base. */
export function createDraftPullRequest(
  input: DraftPrInput,
  deps: DraftPrDeps = {},
): string {
  const git = deps.git ?? gitForDraftPr;
  const write =
    deps.write ?? ((path, body) => writeFileSync(path, body, "utf-8"));
  const create =
    deps.create ??
    ((args, cwd) =>
      execFileSync("gh", args, {
        cwd,
        encoding: "utf-8",
        stdio: "pipe",
        windowsHide: true,
        timeout: 60_000,
        env: {
          ...process.env,
          GH_PROMPT_DISABLED: "1",
          GIT_TERMINAL_PROMPT: "0",
        },
      }).trim());
  const cwd = input.worktree;
  if (!input.baseBranch || !input.branch.startsWith("gnpk/"))
    throw new Error("Invalid base or worktree branch.");
  if (
    input.successCount < 1 ||
    input.failCount > 0 ||
    input.agentError ||
    input.hasPendingCommitFailure
  ) {
    throw new Error(
      "The run has no successful work or has unresolved failures; its worktree is preserved for review.",
    );
  }
  if (git(["branch", "--show-current"], cwd) !== input.branch)
    throw new Error("The worktree branch changed.");
  if (git(["status", "--porcelain"], cwd))
    throw new Error("The worktree contains uncommitted changes.");
  git(["merge-base", "--is-ancestor", input.baseCommit, "HEAD"], cwd);
  const commitCount = Number(
    git(["rev-list", "--count", `${input.baseCommit}..HEAD`], cwd),
  );
  if (!Number.isSafeInteger(commitCount) || commitCount < 1)
    throw new Error("No completed commits are available for a pull request.");
  const remote = git(["config", "--get", "remote.origin.url"], cwd);
  const match = remote.match(
    /^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i,
  );
  if (!match)
    throw new Error(
      "origin must be a GitHub repository without embedded credentials.",
    );
  const repo = match[1];
  const baseRef = `refs/heads/${input.baseBranch}`;
  const branchRef = `refs/heads/${input.branch}`;
  const remoteBase = git(
    ["ls-remote", "--heads", "origin", baseRef],
    cwd,
  ).split(/\s+/)[0];
  if (remoteBase !== input.baseCommit)
    throw new Error(
      "The remote base branch differs from the run's starting commit; review manually.",
    );
  if (git(["ls-remote", "--heads", "origin", branchRef], cwd))
    throw new Error(
      "The run branch already exists on origin; refusing to overwrite it.",
    );
  const title =
    git(["log", "-1", "--format=%s"], cwd)
      .replace(/[\r\n]+/g, " ")
      .slice(0, 180) || "GNHF worktree changes";
  const bodyPath = join(input.runDir, "draft-pr-body.md");
  write(
    bodyPath,
    `Automated GNHF worktree run with ${commitCount} commit(s).\n\nReview the changes and validation evidence before merging.\n`,
  );
  git(["push", "-u", "origin", `HEAD:${branchRef}`], cwd);
  return create(
    [
      "pr",
      "create",
      "--repo",
      repo,
      "--draft",
      "--head",
      input.branch,
      "--base",
      input.baseBranch,
      "--title",
      title,
      "--body-file",
      bodyPath,
    ],
    cwd,
  );
}
