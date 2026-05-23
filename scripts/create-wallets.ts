/**
 * Creates Circle developer-controlled wallets for each agent + allocator.
 * Run once, then paste the printed addresses into .env.
 *
 * Prerequisites:
 *   CIRCLE_API_KEY       — from Circle Developer Console
 *   CIRCLE_ENTITY_SECRET — 32-byte hex entity secret (from Circle Console)
 *
 * Usage: pnpm tsx scripts/create-wallets.ts
 */
import crypto from "crypto";

const BASE = "https://api.circle.com/v1/w3s";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function circlePost(path: string, body: unknown, apiKey: string): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Circle API ${path} failed ${res.status}: ${text}`);
  }
  return res.json();
}

async function main() {
  const apiKey = requireEnv("CIRCLE_API_KEY");
  const entitySecret = requireEnv("CIRCLE_ENTITY_SECRET");

  // Derive entity secret ciphertext (required for developer-controlled wallets)
  // Circle requires the entity secret encrypted with their public key.
  // For the hackathon, use the Circle SDK's helper or construct manually.
  // Here we call the /config/entity/publicKey endpoint to get the public key.
  const pkRes = await fetch(`${BASE}/config/entity/publicKey`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!pkRes.ok) throw new Error(`Failed to fetch entity public key: ${pkRes.status}`);
  const { data: pkData } = (await pkRes.json()) as { data: { publicKey: string } };

  // Encrypt entity secret with Circle's RSA-OAEP public key
  const secretBytes = Buffer.from(entitySecret.replace(/^0x/, ""), "hex");
  const ciphertext = crypto.publicEncrypt(
    { key: pkData.publicKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    secretBytes
  );
  const entitySecretCiphertext = ciphertext.toString("base64");

  // Create a wallet set for Themis
  const idempotencyKey = crypto.randomUUID();
  const wsRes = (await circlePost(
    "/developer/walletSets",
    { idempotencyKey, name: "Themis Hackathon", entitySecretCiphertext },
    apiKey
  )) as { data: { walletSet: { id: string } } };
  const walletSetId = wsRes.data.walletSet.id;
  console.log(`Created wallet set: ${walletSetId}`);
  console.log(`Add to .env: CIRCLE_WALLET_SET_ID=${walletSetId}\n`);

  const agents = ["hermes", "pythia", "demeter", "allocator"] as const;
  const addresses: Record<string, string> = {};

  for (const agent of agents) {
    const wRes = (await circlePost(
      "/developer/wallets",
      {
        idempotencyKey: crypto.randomUUID(),
        accountType: "EOA",
        blockchains: ["EVM"],
        count: 1,
        walletSetId,
        entitySecretCiphertext,
        metadata: [{ name: `themis-${agent}`, refId: agent }],
      },
      apiKey
    )) as { data: { wallets: { id: string; address: string }[] } };
    const wallet = wRes.data.wallets[0];
    addresses[agent] = wallet.address;
    console.log(`${agent}: ${wallet.address}  (walletId: ${wallet.id})`);
  }

  console.log("\n--- Add these to your .env ---");
  console.log(`AGENT_ADDRESS_HERMES=${addresses["hermes"]}`);
  console.log(`AGENT_ADDRESS_PYTHIA=${addresses["pythia"]}`);
  console.log(`AGENT_ADDRESS_DEMETER=${addresses["demeter"]}`);
  console.log(`PRIVATE_KEY_ALLOCATOR=<export from Circle Console for allocator wallet>`);
  console.log("--- End ---");
  console.log("\nNote: Circle developer-controlled wallets sign server-side.");
  console.log("Export private keys from the Circle Console if needed for direct ethers.js signing.");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
