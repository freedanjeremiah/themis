import { ethers } from "hardhat";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: "../../.env" });

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying from:", deployer.address);

  const usdcAddress = process.env.USDC_ADDRESS;
  if (!usdcAddress) throw new Error("USDC_ADDRESS not set in .env");

  // 1. Deploy ThemisVault
  const Vault = await ethers.getContractFactory("ThemisVault");
  const vault = await Vault.deploy(usdcAddress, deployer.address);
  await vault.waitForDeployment();
  console.log("ThemisVault:", await vault.getAddress());

  // 2. Deploy ThemisRegistry
  const Registry = await ethers.getContractFactory("ThemisRegistry");
  const registry = await Registry.deploy(deployer.address);
  await registry.waitForDeployment();
  console.log("ThemisRegistry:", await registry.getAddress());

  // 3. Deploy TraceAnchor
  const Anchor = await ethers.getContractFactory("TraceAnchor");
  const anchor = await Anchor.deploy(await registry.getAddress());
  await anchor.waitForDeployment();
  console.log("TraceAnchor:", await anchor.getAddress());

  // 4. Copy ABIs to packages/shared
  const abiDir = join(__dirname, "../../../packages/shared/src/abis");
  mkdirSync(abiDir, { recursive: true });

  const artifactNames = ["ThemisVault", "ThemisRegistry", "TraceAnchor"];
  for (const name of artifactNames) {
    const artifact = await import(`../artifacts/contracts/${name}.sol/${name}.json`);
    writeFileSync(
      join(abiDir, `${name}.json`),
      JSON.stringify(artifact.abi, null, 2)
    );
    console.log(`Copied ABI: ${name}.json`);
  }

  // 5. Print .env additions
  console.log("\nAdd these to your .env:");
  console.log(`VAULT_ADDRESS=${await vault.getAddress()}`);
  console.log(`REGISTRY_ADDRESS=${await registry.getAddress()}`);
  console.log(`ANCHOR_ADDRESS=${await anchor.getAddress()}`);
}

main().catch(console.error);
