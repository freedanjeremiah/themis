/**
 * Circle Gateway Nanopayments helper.
 * Signs EIP-3009 transferWithAuthorization for per-call data API payments.
 * See: https://developers.circle.com/gateway/nanopayments
 */
import { ethers } from "ethers";
import * as dotenv from "dotenv";
dotenv.config({ path: "../../.env" });

const GATEWAY_WALLET = process.env.GATEWAY_WALLET_ADDRESS ?? "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";
const USDC_ADDRESS  = process.env.USDC_ADDRESS ?? "0x3600000000000000000000000000000000000000";
const ARC_CHAIN_ID  = Number(process.env.ARC_CHAIN_ID ?? "5042002");

// EIP-3009 domain + type hashes
const EIP3009_TYPEHASH = ethers.id(
  "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
);
const DOMAIN_TYPEHASH = ethers.id(
  "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
);

/**
 * Sign a nanopayment authorization for a data API call.
 * Amount is in micro-USDC (e.g. 1000 = $0.001).
 * Returns the payment header value to attach to the request.
 */
export async function signNanopayment(
  signer: ethers.Wallet,
  amountMicroUsdc: number,
  recipient: string
): Promise<{ header: string; amountUsdc: number }> {
  const now = Math.floor(Date.now() / 1000);
  const validAfter = now - 60;
  const validBefore = now + 300; // 5 min window
  const nonce = ethers.hexlify(ethers.randomBytes(32));
  const value = BigInt(amountMicroUsdc); // 6-decimal USDC units

  // EIP-712 domain separator
  const domainSeparator = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
    ["bytes32", "bytes32", "bytes32", "uint256", "address"],
    [
      DOMAIN_TYPEHASH,
      ethers.id("USD Coin"),
      ethers.id("2"),
      BigInt(ARC_CHAIN_ID),
      USDC_ADDRESS,
    ]
  ));

  // EIP-3009 struct hash
  const structHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
    ["bytes32", "address", "address", "uint256", "uint256", "uint256", "bytes32"],
    [EIP3009_TYPEHASH, signer.address, recipient, value, BigInt(validAfter), BigInt(validBefore), nonce]
  ));

  // Final EIP-712 hash
  const digest = ethers.keccak256(
    ethers.concat(["0x1901", domainSeparator, structHash])
  );

  const sig = signer.signingKey.sign(digest);
  const signature = ethers.Signature.from(sig).serialized;

  const payload = JSON.stringify({
    from: signer.address,
    to: recipient,
    value: value.toString(),
    validAfter,
    validBefore,
    nonce,
    signature,
  });

  return {
    header: Buffer.from(payload).toString("base64"),
    amountUsdc: amountMicroUsdc / 1_000_000,
  };
}

/** Sign a nanopayment and return the X-Payment header value, or null on failure. */
export async function payForDataCall(
  signer: ethers.Wallet,
  source: string,
  amountMicroUsdc = 1000 // $0.001 per call
): Promise<string | null> {  // returns X-Payment header value or null on failure
  try {
    const { header, amountUsdc } = await signNanopayment(signer, amountMicroUsdc, GATEWAY_WALLET);
    console.log(`[pythia] Nanopayment signed — $${amountUsdc.toFixed(6)} USDC for ${source}`);
    return header;
  } catch (err) {
    console.warn("[pythia] Nanopayment signing failed (non-fatal):", err);
    return null;
  }
}
