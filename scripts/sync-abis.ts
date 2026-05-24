/**
 * Reads compiled Hardhat artifacts and writes their ABIs into the shared
 * package so every off-chain service has a single source of truth.
 *
 * Usage: pnpm tsx scripts/sync-abis.ts
 * Exits non-zero on any missing artifact (CI uses this to fail loudly).
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const ARTIFACTS = join(ROOT, "apps/contracts/artifacts/contracts");
const SHARED_ABIS = join(ROOT, "packages/shared/src/abis");

const CONTRACTS = ["ThemisVault", "ThemisRegistry", "TraceAnchor"] as const;

let failed = false;
for (const name of CONTRACTS) {
  const artifactPath = join(ARTIFACTS, `${name}.sol`, `${name}.json`);
  const outPath = join(SHARED_ABIS, `${name}.json`);
  if (!existsSync(artifactPath)) {
    console.error(`[sync-abis] MISSING artifact: ${artifactPath}`);
    console.error(`[sync-abis] Run \`pnpm --filter @themis/contracts hardhat compile\` first.`);
    failed = true;
    continue;
  }
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
  if (!Array.isArray(artifact.abi)) {
    console.error(`[sync-abis] Artifact ${name} has no .abi array`);
    failed = true;
    continue;
  }
  writeFileSync(outPath, JSON.stringify(artifact.abi, null, 2) + "\n");
  console.log(`[sync-abis] wrote ${outPath} (${artifact.abi.length} entries)`);
}

if (failed) process.exit(1);
console.log("[sync-abis] done.");
