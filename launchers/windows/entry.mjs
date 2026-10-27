#!/usr/bin/env node
import childProcess from "node:child_process";
import { realpathSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { fileURLToPath } from "node:url";

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

export function isInformationRequest(args) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") return false;
    if (["--help", "-h", "--version", "-V"].includes(arg)) return true;
    if (VALUE_FLAGS.has(arg)) index += 1;
  }
  return false;
}

export function requireHerdrPane(env = process.env) {
  const ids = ["HERDR_WORKSPACE_ID", "HERDR_TAB_ID", "HERDR_PANE_ID"];
  if (
    env.HERDR_ENV !== "1" ||
    ids.some((name) => typeof env[name] !== "string" || !env[name].trim())
  ) {
    throw new Error(
      "Start GNPK from a PK-Herdr pane. The required Herdr session context is missing. Help and version are available from any terminal.",
    );
  }
}

let subprocessesPatched = false;

function copyCustomProperties(original, replacement) {
  for (const key of Reflect.ownKeys(original)) {
    if (["name", "length", "prototype", "arguments", "caller"].includes(key)) {
      continue;
    }
    Object.defineProperty(
      replacement,
      key,
      Object.getOwnPropertyDescriptor(original, key),
    );
  }
  return replacement;
}

export function hideWindowsSubprocesses() {
  if (process.platform !== "win32" || subprocessesPatched) return;
  subprocessesPatched = true;

  // All asynchronous public APIs (spawn, execFile, exec and fork) eventually
  // use this method. Patching here preserves their overloads and native
  // promisify implementations, while also covering direct ChildProcess use.
  const originalSpawn = childProcess.ChildProcess.prototype.spawn;
  childProcess.ChildProcess.prototype.spawn = function spawn(options) {
    return Reflect.apply(originalSpawn, this, [
      { ...options, windowsHide: true },
    ]);
  };

  // Synchronous APIs use internal bindings rather than ChildProcess.spawn.
  // Supply options at the documented overload position for each API.
  for (const name of ["spawnSync", "execFileSync", "execSync"]) {
    const original = childProcess[name];
    childProcess[name] = copyCustomProperties(original, function (...args) {
      const optionIndex =
        name === "execSync"
          ? 1
          : Array.isArray(args[1]) ||
              (args.length >= 3 && (args[1] === undefined || args[1] === null))
            ? 2
            : 1;
      const options = args[optionIndex];
      if (
        options === undefined ||
        options === null ||
        (typeof options === "object" && !Array.isArray(options))
      ) {
        args[optionIndex] = { ...options, windowsHide: true };
      }
      return Reflect.apply(original, this, args);
    });
  }

  // Publish the replacements to named ESM imports before the bundled CLI loads.
  syncBuiltinESMExports();
}

export function resolveAgentAliases(args) {
  // The named ACP target keeps this simple for both `sm gnhf` and direct use.
  // Do not rewrite values after `--`: they are literal objective text.
  const resolvedArgs = [...args];
  for (let index = 0; index < resolvedArgs.length; index += 1) {
    if (resolvedArgs[index] === "--") break;
    if (resolvedArgs[index] === "--agent" && resolvedArgs[index + 1] === "ompk") {
      resolvedArgs[index + 1] = "acp:ompk";
      index += 1;
    } else if (resolvedArgs[index] === "--agent=ompk") {
      resolvedArgs[index] = "--agent=acp:ompk";
    } else if (VALUE_FLAGS.has(resolvedArgs[index])) {
      index += 1;
    }
  }
  return resolvedArgs;
}

export async function runGnhf(args = process.argv.slice(2)) {
  if (!isInformationRequest(args)) requireHerdrPane();
  if (process.env.GNPK_TELEMETRY === undefined && process.env.GNHF_TELEMETRY === undefined) {
    process.env.GNPK_TELEMETRY = "0";
  }
  hideWindowsSubprocesses();
  const resolvedArgs = resolveAgentAliases(args);
  process.argv = [
    process.execPath,
    fileURLToPath(new URL("./entry.mjs", import.meta.url)),
    ...resolvedArgs,
  ];
  await import(new URL("../../dist/cli.mjs", import.meta.url).href);
}

let invokedDirectly = false;
try {
  invokedDirectly =
    Boolean(process.argv[1]) &&
    realpathSync(process.argv[1]) ===
      realpathSync(fileURLToPath(import.meta.url));
} catch {
  // An embedding process may not have a filesystem entry point.
}

if (invokedDirectly) {
  await runGnhf().catch((error) => {
    console.error(`gnpk: ${error.message}`);
    process.exitCode = 1;
  });
}
