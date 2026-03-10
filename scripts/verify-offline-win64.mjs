import path from "node:path";
import { resolveRetrievalConfig } from "../dist/retrieval/config.js";
import { getInternalQmdHealth } from "../dist/retrieval/qmd-health.js";

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current?.startsWith("--")) continue;
    const key = current.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args.set(key, "true");
      continue;
    }
    args.set(key, next);
    index += 1;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const cwd = path.resolve(args.get("cwd") || process.cwd());
const requireModels = args.get("require-models") !== "false";
const config = await resolveRetrievalConfig(cwd);
const health = await getInternalQmdHealth(cwd, config.qmd);

const failures = [];

if (health.integrationMode !== "internal-runtime") {
  failures.push("qmd.integrationMode must be internal-runtime");
}
if (!health.offlineStrict) {
  failures.push("qmd.offlineStrict must be true");
}
if (health.targetPlatform !== "win32-x64") {
  failures.push(`qmd.targetPlatform must be win32-x64 (current: ${health.targetPlatform})`);
}
if (!health.vendorRuntimeBuilt) {
  failures.push("vendored qmd runtime is not built");
}
if (!health.vendorCliBuilt) {
  failures.push("vendored qmd CLI entry is not built");
}
for (const dependency of health.nativeDependencies) {
  if (!dependency.ok) {
    failures.push(`native dependency missing: ${dependency.name}`);
  }
}
if (requireModels) {
  for (const model of health.models) {
    if (!model.exists) {
      failures.push(`required model missing: ${model.role} -> ${model.path}`);
    }
  }
}

console.log(
  JSON.stringify(
    {
      cwd,
      requireModels,
      ok: failures.length === 0,
      failures,
      health,
    },
    null,
    2
  )
);

if (failures.length > 0) {
  process.exitCode = 1;
}
