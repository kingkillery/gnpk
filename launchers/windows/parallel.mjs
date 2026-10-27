#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { runGnhf } from "./entry.mjs";

const HELP = `Usage: gnpk "<objective>" [GNPK options]

Launch from a Git repository in a PK-Herdr pane. Each launch prefixes the
objective with a unique instance ID and creates a fresh isolated worktree.
Run this command in multiple Herdr panes for simultaneous independent tasks.

Defaults: --worktree --draft-pr --prevent-sleep off
GNPK agent, model and runtime limit options pass through unchanged.
--current-branch runs on the current branch instead of creating a draft PR.
--no-pr disables draft-PR creation for an isolated worktree.
--push is unavailable; worktree runs publish only their completed branch.
Completed worktrees remain available for review; GNPK handles empty cleanup.

Examples:
  gnpk "Implement feature X" --agent pi --max-iterations 3
  gnpk "Add tests for Y" --agent ompk --max-iterations 3

Use gnhf --help for the complete option reference (legacy alias).
`;

const VALUE_FLAGS = new Set([
  "--agent",
  "--model",
  "--max-iterations",
  "--max-tokens",
  "--max-rate-limit-wait",
  "--fallback-model",
  "--stop-when",
  "--prevent-sleep",
  "--meteor-frequency",
]);

function parallelArgs(args) {
  const forwarded = [];
  let objective;
  let preventSleepSet = false;
  let currentBranch = false;
  let explicitWorktree = false;
  let noPr = false;
  let literal = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!literal && arg === "--") {
      literal = true;
      continue;
    }
    if (!literal && ["--help", "-h"].includes(arg)) {
      return { help: true };
    }
    if (!literal && ["--version", "-V"].includes(arg)) {
      return { upstream: ["--version"] };
    }
    if (!literal && /^--(?:push|no-worktree)(?:=|$)/.test(arg)) {
      throw new Error(`${arg.split("=")[0]} cannot be used with gnpk.`);
    }
    if (!literal && arg === "--current-branch") { currentBranch = true; continue; }
    if (!literal && arg === "--worktree") { explicitWorktree = true; continue; }
    if (!literal && arg === "--no-pr") { noPr = true; continue; }
    if (!literal && arg === "--draft-pr") continue;
    if (!literal && arg.startsWith("-")) {
      const flag = arg.split("=", 1)[0];
      if (flag === "--prevent-sleep") preventSleepSet = true;
      forwarded.push(arg);
      if (VALUE_FLAGS.has(flag) && !arg.includes("=")) {
        if (index + 1 >= args.length || args[index + 1].startsWith("--")) {
          throw new Error(`${flag} requires a value.`);
        }
        forwarded.push(args[++index]);
      }
      continue;
    }
    if (objective !== undefined) {
      throw new Error("Provide one quoted objective, followed by GNHF options.");
    }
    objective = arg;
  }
  if (objective === undefined || !objective.trim()) {
    throw new Error('An objective is required. Use gnpk --help.');
  }
  if (currentBranch && explicitWorktree) throw new Error("--current-branch cannot be combined with --worktree.");
  const instanceObjective = `[instance ${randomUUID()}] ${objective}\n\nKeep changes inside this run's working directory. Preserve other checkouts and unrelated work. Do not push, merge, create pull requests, or change production yourself; the launcher handles draft PR publication. Do not use paid API fallbacks.`;
  return {
    upstream: [
      ...(currentBranch ? ["--current-branch"] : ["--worktree", ...(!noPr ? ["--draft-pr"] : [])]),
      ...(!preventSleepSet ? ["--prevent-sleep", "off"] : []),
      ...forwarded,
      "--",
      instanceObjective,
    ],
  };
}

try {
  const parsed = parallelArgs(process.argv.slice(2));
  if (parsed.help) {
    process.stdout.write(HELP);
  } else {
    await runGnhf(parsed.upstream);
  }
} catch (error) {
  console.error(`gnpk: ${error.message}`);
  process.exitCode = 1;
}
