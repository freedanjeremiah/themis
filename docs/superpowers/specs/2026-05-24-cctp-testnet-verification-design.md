# CCTP Testnet Verification + Soak Test — Design

**Date:** 2026-05-24  
**Deadline:** 2026-05-25 (hackathon submission)  
**Status:** Approved

## Goal

Enable real bidirectional CCTP bridging so Hermes and Pythia can complete full
Arc → HL → Arc roundtrips with `ENABLE_REAL_TRADES=true`. Verify both directions
before starting a multi-cycle soak test.

## Section 1 — .env fixes

### 1a. Switch HL values from mainnet → testnet

The `.env` currently has HL mainnet values uncommented. The verify script uses
Iris sandbox (testnet only), so the env must match.

| Variable | Current (mainnet) | Target (testnet) |
|---|---|---|
| `DEST_RPC_URL` | `https://rpc.hyperliquid.xyz/evm` | `https://rpc.hyperliquid-testnet.xyz/evm` |
| `HYPERLIQUID_CHAIN_ID` | `999` | `998` |
| `MESSAGE_TRANSMITTER_DEST` | `0x81D40F21F12A8F0E3252Bccb954D722d4c464B64` | `0xE737e5cEBEEBa77EFe34D4aa090756590b1CE275` |
| `HYPERLIQUID_API_URL` | `https://api.hyperliquid.xyz` | `https://api.hyperliquid-testnet.xyz` |
| `HYPERLIQUID_INFO_URL` | `https://api.hyperliquid.xyz/info` | `https://api.hyperliquid-testnet.xyz/info` |

Also add the missing variable:

| Variable | Value |
|---|---|
| `HYPERLIQUID_EXCHANGE_URL` | `https://api.hyperliquid-testnet.xyz/exchange` |

### 1b. Fill reverse-bridge vars

These three vars are blank in `.env` and block `bridgeHlToArc`:

| Variable | Description | Source |
|---|---|---|
| `CCTP_TOKEN_MESSENGER_HL` | TokenMessenger on HyperEVM testnet | Circle CCTP testnet contract registry |
| `MESSAGE_TRANSMITTER_ARC` | MessageTransmitter on Arc testnet | Circle CCTP testnet contract registry |
| `USDC_ADDRESS_HL` | USDC contract on HyperEVM testnet | Circle CCTP testnet contract registry |

Addresses to be looked up from Circle docs during implementation.

## Section 2 — scripts/verify-cctp-reverse.ts

New script mirroring `verify-cctp-testnet.ts` for the HL → Arc direction.

**Flow:**
1. Check required env vars at startup
2. Read USDC balance on HL testnet (HL wallet must hold ≥ $1 — the forward
   verify deposits $1 there, so balance should exist after that run)
3. `approve(CCTP_TOKEN_MESSENGER_HL, $1)`
4. `depositForBurn($1, ARC_CCTP_DOMAIN=26, wallet_as_bytes32, USDC_ADDRESS_HL)`
5. Extract `MessageSent` log, compute message hash
6. Poll Iris sandbox (10s interval, 10-min timeout)
7. `receiveMessage(messageBytes, attestation)` on Arc via `MESSAGE_TRANSMITTER_ARC`
8. Log timing, print `=== HL→ARC ROUNDTRIP COMPLETE — env values verified ===`

**Required env:**
`DEST_RPC_URL`, `USDC_ADDRESS_HL`, `CCTP_TOKEN_MESSENGER_HL`,
`ARC_CCTP_DOMAIN`, `ARC_RPC_URL`, `MESSAGE_TRANSMITTER_ARC`,
`PRIVATE_KEY_HERMES`

## Section 3 — soak test (operational)

No code changes. Pure configuration + monitoring.

**Steps:**
1. Run forward verify: `pnpm tsx scripts/verify-cctp-testnet.ts`
2. Note Iris latency from output; fill `docs/cctp-testnet.md` timings manually
3. Run reverse verify: `pnpm tsx scripts/verify-cctp-reverse.ts`
4. Note Iris latency for HL→Arc direction
5. Set `ENABLE_REAL_TRADES=true` in `.env`
6. Start `pnpm dev` from repo root
7. Monitor: dashboard + allocator logs; watch for `stuck` agent state
8. Recovery if stuck: `pnpm tsx scripts/cctp-recover.ts <agentId> <burnTxHash>`
   then `curl -X POST $ALLOCATOR_URL/stuck -d '{"agentId":"<id>","reason":null}'`

**Success bar:** ≥ 10 full cycles per Hermes/Pythia before submission.  
With 20-min cycles that is ≥ 3h 20min of clean operation.

## Out of scope

- Automating the timing fill in `docs/cctp-testnet.md`
- Soak test dashboarding beyond what already exists
- HL mainnet bridging
