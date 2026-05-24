import { ethers } from "ethers";
import * as dotenv from "dotenv";
dotenv.config();

const VAULT_ABI = [
  "function agentAllocation(address) view returns (uint256)",
  "function totalAssets() view returns (uint256)",
  "function liquidReserve() view returns (uint256)",
  "function agentSidelined(address) view returns (bool)",
  "function depositedBy(address) view returns (uint256)",
] as const;

const USDC_ABI = ["function balanceOf(address) view returns (uint256)"] as const;

const provider = new ethers.JsonRpcProvider(process.env.ARC_RPC_URL!);
const vault = new ethers.Contract(process.env.VAULT_ADDRESS!, VAULT_ABI, provider);
const usdc = new ethers.Contract(process.env.USDC_ADDRESS!, USDC_ABI, provider);

const agents: Record<string, string> = {
  hermes:  process.env.AGENT_ADDRESS_HERMES!,
  pythia:  process.env.AGENT_ADDRESS_PYTHIA!,
  demeter: process.env.AGENT_ADDRESS_DEMETER!,
};

async function main() {
  const [total, liquid] = await Promise.all([vault.totalAssets(), vault.liquidReserve()]);
  console.log(`vault totalAssets : $${Number(total)/1e6}`);
  console.log(`vault liquidReserve: $${Number(liquid)/1e6}`);
  console.log();

  for (const [name, addr] of Object.entries(agents)) {
    const [alloc, sidelined, deposited, walletBal] = await Promise.all([
      vault.agentAllocation(addr),
      vault.agentSidelined(addr),
      vault.depositedBy(addr),
      usdc.balanceOf(addr),
    ]);
    console.log(`${name.padEnd(8)} addr=${addr}`);
    console.log(`         alloc=$${Number(alloc)/1e6}  deposited=$${Number(deposited)/1e6}  walletUsdc=$${Number(walletBal)/1e6}  sidelined=${sidelined}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
