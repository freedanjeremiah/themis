# Themis backend deployment

Single-VM docker-compose stack for the 5 always-on services:

| Service | Port (internal) | Public via Caddy | Storage |
|---|---|---|---|
| allocator | 3001 | no (internal-only) | volume `allocator-data` (SQLite) |
| indexer | 3002 | yes (`${INDEXER_DOMAIN}` → 3002) | volume `indexer-data` (SQLite) |
| agent-hermes | — | no | — |
| agent-pythia | — | no | — |
| agent-demeter | — | no | — |
| caddy | 80 + 443 | yes (TLS terminator) | volumes `caddy-data`, `caddy-config` |

The dashboard runs on Vercel separately. It needs `NEXT_PUBLIC_INDEXER_URL=https://${INDEXER_DOMAIN}` and `NEXT_PUBLIC_INDEXER_WS_URL=wss://${INDEXER_DOMAIN}` set in Vercel's project env.

## Prerequisites

- A Linux VM with Docker + Docker Compose v2. Tested on Ubuntu 22.04 with 2 vCPU / 2 GB RAM. (USYC + HL trading is light; LLM calls happen out-of-process at Anthropic.)
- A domain with an A record pointed at the VM's public IP (for HTTPS).
- Ports 80 + 443 open to the public internet.
- The repo cloned on the VM, with `.env` populated at the repo root (do NOT commit `.env`).

## First-time bring-up

```bash
# On the VM
git clone https://github.com/freedanjeremiah/themis.git
cd themis
cp .env.example .env
# Edit .env — fill in:
#   - PRIVATE_KEY_ALLOCATOR / _HERMES / _PYTHIA / _DEMETER
#   - VAULT_ADDRESS, REGISTRY_ADDRESS, ANCHOR_ADDRESS
#   - AGENT_ADDRESS_HERMES / _PYTHIA / _DEMETER
#   - CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, CIRCLE_WALLET_SET_ID
#   - ANTHROPIC_API_KEY, PINATA_JWT, TWITTER_BEARER_TOKEN
#   - Reverse-CCTP env: CCTP_TOKEN_MESSENGER_HL, MESSAGE_TRANSMITTER_ARC, USDC_ADDRESS_HL
#   - INDEXER_DOMAIN=indexer.your-domain.example  (the public hostname for the indexer)

cd infra
docker compose --env-file ../.env up -d --build
```

The build runs `pnpm install` + `pnpm --filter @themis/contracts build` + `pnpm tsx scripts/sync-abis.ts` inside the base image, so the contracts compile and shared ABIs populate on every fresh build.

## Verify

```bash
# All services healthy?
docker compose ps

# Allocator + indexer health:
curl -fsS http://localhost:3001/state  # via the host (only if you've forwarded 3001 for debug)
curl -fsS https://${INDEXER_DOMAIN}/tvl

# Tail an agent:
docker compose logs -f agent-hermes
```

The dashboard at `https://<your-vercel-domain>` should immediately show TVL + (eventually) live reasoning traces once the agents start their first 20-minute cycle.

## Restarts + state

- `restart: unless-stopped` on every service — they survive Docker daemon restarts, host reboots.
- `depends_on: condition: service_healthy` on the three agents — they only start after allocator + indexer report healthy.
- Persistent volumes:
  - `allocator-data` ↔ `/data/allocator/state.db` (allocator SQLite; trades_completed, cumulative PnL, stuck_reason)
  - `indexer-data` ↔ `/data/indexer/themis.db` (deposits / allocations / settlements / traces)
  - `caddy-data` + `caddy-config` (Let's Encrypt account + certs)
- **Not persistent across restarts** (acceptable hackathon risk, per Phase 2 spec):
  - `apps/agent-pythia/.headline-cache.json` — regenerates on next successful Twitter/RSS fetch
  - `apps/agent-demeter/.shares-held.json` — if Demeter crashes mid-cycle, the redeem step won't fire on restart. Operator must either (a) manually call `teller.redeem` from Demeter's wallet, or (b) admin call `vault.forceSettle(demeter, 0)` to zero the allocation.

## Common operator commands

| Goal | Command |
|---|---|
| Update to latest main | `git pull && docker compose up -d --build` |
| Stop everything | `docker compose down` |
| Reset agent state (drop the SQLite files) | `docker compose down && docker volume rm themis_allocator-data themis_indexer-data && docker compose up -d` |
| Clear a stuck agent | `curl -X POST https://${INDEXER_DOMAIN}/stuck` won't reach the allocator (internal). Either: (a) exec into agent's network and POST to `http://allocator:3001/stuck`, or (b) bind 3001 to the host for ops and POST from there. |
| Recover a stuck CCTP burn | From the host: `docker compose exec agent-hermes pnpm tsx /app/scripts/cctp-recover.ts hermes <burnTx> arc-to-hl` |
| Tail one service | `docker compose logs -f --tail 100 <service>` |
| Tail everything | `docker compose logs -f --tail 30` |

## Reverse-bridge gotcha

Hermes and Pythia stay stuck after their first cycle if any of these env vars are empty:

- `CCTP_TOKEN_MESSENGER_HL`
- `MESSAGE_TRANSMITTER_ARC`
- `USDC_ADDRESS_HL`

Run `pnpm tsx scripts/verify-cctp-testnet.ts` against your testnet wallet ONCE before bringing up agents in real-trades mode. See `docs/cctp-testnet.md`.

To start in dry-run mode (no real trades, no real CCTP), keep `ENABLE_REAL_TRADES=false` in `.env` (the default). The agents log every cycle's intended actions and report $0 settlement — useful for testing the pipeline shape before exposing real testnet capital.

## Security notes

- `.env` contains private keys + API secrets. Do not commit it. On the VM, set `chmod 600 .env`.
- Agent EOAs hold a small amount of Arc testnet USDC for gas + bridging — keep balances minimal.
- Caddy only exposes the indexer. Allocator + agents have no public ports.
- The internal docker network (`themis`) is isolated from the host. Service-to-service traffic stays in-cluster.
- Rotate `ANTHROPIC_API_KEY`, `PINATA_JWT`, `CIRCLE_API_KEY` quarterly. After rotation, `docker compose up -d --force-recreate` to pick up new values.

## Resource budget

| | Per-day |
|---|---|
| Anthropic (3 agents × 72 cycles × ~2k tokens on Haiku) | ~$3 |
| Pinata (4320 pins/day on the paid Picnic tier) | ~$20/mo prorated |
| VM (e.g. Hetzner CX22) | ~$5/mo prorated |
| HL testnet fees | $0 (testnet) |
| Iris attestations | $0 (sandbox) |

Total operating cost: roughly **$5/day** for an always-on testnet demo.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `caddy` keeps restarting | DNS not pointed at the VM yet, or ports 80/443 blocked. Caddy can't get a TLS cert. |
| All agents stuck on cycle 1 | Reverse-bridge env vars empty (see above). |
| Allocator `503` to agent `POST /proposals` | Allocator hasn't finished startup; check `docker compose logs allocator`. |
| WS connection on dashboard drops every few seconds | Caddy is healthy but indexer container is restarting — check `docker compose logs indexer`. |
| `pnpm install` fails during build | Network issue inside the build sandbox; retry `docker compose build --no-cache`. |
| Vault calls revert with "agent sidelined" | An agent breached the −5% daily loss cap. Admin: `vault.unsidelineAgent(<addr>)`. |
