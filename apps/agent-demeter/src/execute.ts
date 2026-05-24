/**
 * Demeter venue execution: deposit USDC into USYC (or Aave) and later redeem
 * to compute realized yield delta.
 *
 * USYC Teller is a real ERC-4626-style vault on Arc:
 *   deposit(assets, receiver) → shares
 *   redeem(shares, receiver, owner) → assets
 *
 * Aave on Arc is not yet deployed — supply() works when AAVE_POOL_ADDRESS is set.
 */
import { ethers } from "ethers";
import { AgentProposal } from "@themis/shared";
import * as dotenv from "dotenv";
dotenv.config({ path: "../../.env" });

const ENABLE_REAL_TRADES = process.env.ENABLE_REAL_TRADES === "true";

const USDC_ADDRESS        = process.env.USDC_ADDRESS ?? "0x3600000000000000000000000000000000000000";
const USYC_ADDRESS        = process.env.USYC_ADDRESS ?? "";
const USYC_TELLER_ADDRESS = process.env.USYC_TELLER_ADDRESS ?? "0x9fdF14c5B14173D74C08Af27AebFf39240dC105A";
const AAVE_POOL           = process.env.AAVE_POOL_ADDRESS ?? "";

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
] as const;

const USYC_TELLER_ABI = [
  "function deposit(uint256 assets, address receiver) returns (uint256 shares)",
  "function redeem(uint256 shares, address receiver, address owner) returns (uint256 assets)",
] as const;

const AAVE_POOL_ABI = [
  "function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)",
  "function withdraw(address asset, uint256 amount, address to) returns (uint256)",
] as const;

export type DepositResult =
  | { ok: true; venue: string; sharesHeld: bigint; depositedUsd6: bigint }
  | { ok: false; reason: string };

export type RedeemResult =
  | { ok: true; receivedUsd6: bigint }
  | { ok: false; reason: string };

export async function depositToVenue(proposal: AgentProposal, allocatedUsd: number): Promise<DepositResult> {
  const venue = proposal.venue;
  const amountUsdc6 = BigInt(Math.floor(allocatedUsd * 1_000_000));

  if (!ENABLE_REAL_TRADES) {
    console.log(`[demeter] deposit skipped (ENABLE_REAL_TRADES=false): would deposit ${allocatedUsd} USDC into ${venue}`);
    return { ok: false, reason: "real_trades_disabled" };
  }

  const provider = new ethers.JsonRpcProvider(process.env.ARC_RPC_URL!);
  const wallet   = new ethers.Wallet(process.env.PRIVATE_KEY_DEMETER!, provider);
  const usdc     = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, wallet);

  if (venue === "usyc") {
    if (!USYC_ADDRESS) return { ok: false, reason: "usyc_address_unset" };
    const usyc = new ethers.Contract(USYC_ADDRESS, ERC20_ABI, wallet);
    const sharesBefore = BigInt(await usyc.balanceOf(wallet.address));
    await (await usdc.approve(USYC_TELLER_ADDRESS, amountUsdc6)).wait();
    const teller = new ethers.Contract(USYC_TELLER_ADDRESS, USYC_TELLER_ABI, wallet);
    const tx = await teller.deposit(amountUsdc6, wallet.address);
    const receipt = await tx.wait();
    const sharesAfter = BigInt(await usyc.balanceOf(wallet.address));
    const sharesHeld = sharesAfter - sharesBefore;
    console.log(`[demeter] USYC deposit ok (tx: ${receipt?.hash}); sharesHeld delta = ${sharesHeld}`);
    return { ok: true, venue: "usyc", sharesHeld, depositedUsd6: amountUsdc6 };
  }

  if (venue === "aave") {
    if (!AAVE_POOL) return { ok: false, reason: "aave_pool_unset" };
    await (await usdc.approve(AAVE_POOL, amountUsdc6)).wait();
    const aave = new ethers.Contract(AAVE_POOL, AAVE_POOL_ABI, wallet);
    const tx = await aave.supply(USDC_ADDRESS, amountUsdc6, wallet.address, 0);
    const receipt = await tx.wait();
    console.log(`[demeter] Aave supply ok (tx: ${receipt?.hash})`);
    return { ok: true, venue: "aave", sharesHeld: amountUsdc6, depositedUsd6: amountUsdc6 };
  }

  return { ok: false, reason: `unknown_venue:${venue}` };
}

export async function redeemFromVenue(venue: string, sharesHeld: bigint, depositedUsd6: bigint): Promise<RedeemResult> {
  if (!ENABLE_REAL_TRADES) {
    return { ok: false, reason: "real_trades_disabled" };
  }
  if (sharesHeld <= 0n) {
    return { ok: false, reason: "no_shares_to_redeem" };
  }

  const provider = new ethers.JsonRpcProvider(process.env.ARC_RPC_URL!);
  const wallet   = new ethers.Wallet(process.env.PRIVATE_KEY_DEMETER!, provider);
  const usdc     = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, wallet);

  if (venue === "usyc") {
    const balBefore = BigInt(await usdc.balanceOf(wallet.address));
    const teller = new ethers.Contract(USYC_TELLER_ADDRESS, USYC_TELLER_ABI, wallet);
    const tx = await teller.redeem(sharesHeld, wallet.address, wallet.address);
    const receipt = await tx.wait();
    const balAfter = BigInt(await usdc.balanceOf(wallet.address));
    const receivedUsd6 = balAfter - balBefore;
    console.log(`[demeter] USYC redeem ok (tx: ${receipt?.hash}); received ${receivedUsd6} usdc6 vs deposited ${depositedUsd6}`);
    return { ok: true, receivedUsd6 };
  }

  if (venue === "aave") {
    if (!AAVE_POOL) return { ok: false, reason: "aave_pool_unset" };
    const balBefore = BigInt(await usdc.balanceOf(wallet.address));
    const aave = new ethers.Contract(AAVE_POOL, AAVE_POOL_ABI, wallet);
    const tx = await aave.withdraw(USDC_ADDRESS, sharesHeld, wallet.address);
    const receipt = await tx.wait();
    const balAfter = BigInt(await usdc.balanceOf(wallet.address));
    return { ok: true, receivedUsd6: balAfter - balBefore };
  }

  return { ok: false, reason: `unknown_venue:${venue}` };
}
