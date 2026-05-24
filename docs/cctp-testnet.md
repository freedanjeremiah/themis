# CCTP V2 testnet — Themis notes

## Verified environment values

| Variable | Value | Source |
|---|---|---|
| `ARC_CCTP_DOMAIN` | `26` | Arc testnet domain ID |
| `HYPERLIQUID_CCTP_DOMAIN` | `19` | HyperEVM testnet domain ID |
| `CCTP_TOKEN_MESSENGER` | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` | Arc testnet TokenMessengerV2 |
| `MESSAGE_TRANSMITTER_DEST` | `0xE737e5cEBEEBa77EFe34D4aa090756590b1CE275` | HyperEVM testnet MessageTransmitterV2 |
| `CCTP_TOKEN_MESSENGER_HL` | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` | HyperEVM testnet TokenMessengerV2 |
| `MESSAGE_TRANSMITTER_ARC` | `0xE737e5cEBEEBa77EFe34D4aa090756590b1CE275` | Arc testnet MessageTransmitterV2 |
| `USDC_ADDRESS_HL` | `0x2B3370eE501B4a559b57D449569354196457D8Ab` | HyperEVM testnet USDC |
| Iris sandbox URL | `https://iris-api-sandbox.circle.com/attestations` | Circle CCTP V2 testnet docs |

## Observed timings

- **Iris attestation latency**: _measured_ ~Xs after burn confirmed
- **Total roundtrip (burn → mint)**: _measured_ ~Xs

(Operator: edit this file after running the verifier script, replace `X` with observed numbers.)

## Known gotchas

- HL testnet RPC may rate-limit during attestation polling — keep poll interval >= 10s.
- The `MessageSent(bytes)` event topic is `0x` + `keccak256("MessageSent(bytes)")`. Verify in the burn receipt before computing the message hash.
- The `mintRecipient` must be a left-zero-padded 32-byte representation of the destination wallet address.

## Recovery flow

If a burn succeeds but the mint never lands (Iris attestation appears but `receiveMessage` was never called), run:

```
pnpm tsx scripts/cctp-recover.ts <agentId> <burnTxHash>
```

The script re-fetches the attestation from Iris and calls `receiveMessage` on the destination chain.
