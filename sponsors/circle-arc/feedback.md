# Circle / Arc — Builder Feedback (Themis, Agora Hackathon 2026)

> Notes we took while building Themis, a multi-agent on-chain hedge fund, on Arc testnet.
> Where we touched Arc: ThemisVault + ThemisRegistry (Solidity 0.8.24), an ethers v6
> event indexer, three AI trading agents, and a Next.js / wagmi v2 dashboard, all
> settling in USDC on Arc testnet (chainId 5042002).

## What worked

**USDC as the native gas token is the best part.** No paymaster to wire up, so a vault
can custody the gas token directly, agent wallets top up once and run on their own, and
the story we tell depositors stays simple: one token, one mental model. We stopped
thinking about gas after day one, which is about the highest praise we can give a design
decision.

**Throughput held up for tight agent cycles.** Three agents plus an allocator firing
on-chain `allocate` / `settle` calls every cycle, no congestion, and block times steady
enough that `waitForTransactionReceipt` behaved predictably. We never had to babysit it.

**CCTP V2 being there mattered even though we dropped it.** We designed around a real
Arc to HyperEVM bridge path, then swapped it for pre-funded wallets under deadline
pressure. Having a credible bridge meant we could architect the right thing first and
cut later, instead of the reverse.

## Bugs and sharp edges we hit

### eth_newFilter subscriptions die silently after an RPC reconnect

Filter-based subscriptions (`contract.on(...)` in ethers v6) hand you a `filterId` that
the Arc testnet RPC doesn't keep across reconnects. After a reconnect, every
`eth_getFilterChanges` comes back `filter not found` and events just stop. The listener
looks alive and delivers nothing, so there's nothing to catch.

This bit us where it hurts: the indexer quietly missed `Deposited`, `Allocated`, and
`Settled` events until we noticed the dashboard had gone stale. We ended up rewriting the
whole listener layer to poll `eth_getLogs` with manual block-range chunking.

What would help: persist filter state across sessions, or at least return a real error on
a dead filter so clients can re-subscribe. Failing that, say so loudly in the testnet RPC
docs.

### eth_getLogs has an undocumented block-range cap (~10k)

Ask for more than roughly 10,000 blocks and you get an opaque error, no code and no
mention of a limit. We found the ceiling by trial and error and now chunk every query at
9,000 blocks. Putting the number in the error body (and the docs) would save every team
from rediscovering it independently.

### USYC Teller reverts with an undecoded custom error on testnet

`teller.deposit(...)` reverts with a custom error we couldn't decode, and it looks like a
KYC / allow-list gate that's active with no open path around it. That blocks the
stablecoin yield use case, which is one of Arc's headline stories, so we fell back to a
simulated 5.2% APY computed off-chain just to keep the agent cycling. An open testnet
allow-list, or even a readable revert reason telling us which gate we hit, would unblock
this for every builder.

## Docs we wish existed

**A "configure viem / wagmi / ethers for Arc" snippet.** USDC-as-native-gas quietly
breaks a common assumption: most libraries and UI components expect an 18-decimal ETH
native currency. On Arc you have to declare `nativeCurrency` as USDC at 6 decimals
(`0x3600000000000000000000000000000000000000`). Miss it and the damage is silent:
balances render as `0.000010` instead of `10.00`, gas estimates come out wrong, and
wallet UIs show the wrong symbol. One canonical chain-object snippet would save everyone
the same afternoon.

**An explorer, or any tx-status endpoint.** With no explorer on testnet, checking whether
a tx landed, reading a revert reason, or inspecting contract state all meant writing
one-off RPC scripts. That's slow, especially for custom Solidity errors where you need the
ABI to decode the revert. Even a minimal "tx hash to receipt and logs" page, or
`debug_traceTransaction`, would speed up the contract loop a lot.

**A canonical faucet link.** There's no single discoverable faucet for Arc testnet USDC.
We found Circle's generic one on our own and linked it from the dashboard. A pinned link
in Discord and the docs matters more than it sounds, especially for judges trying to
reproduce a demo.

**A "what's actually deployed on testnet" page.** We wrote Aave v3 integration code before
finding out it isn't on Arc testnet. A short table (protocol to address, or "not
available") would let teams scope integrations correctly up front.

## The short version

| Ask | Why it matters |
|---|---|
| Persist `eth_newFilter` across reconnects (or error clearly) | Event-driven indexers silently break on Arc today; the getLogs-polling workaround adds real complexity. |
| Document the `eth_getLogs` block-range cap, with the limit in the error | Every team finds this the hard way. The number in the error plus a docs line ends the surprise. |
| Open a USYC Teller testnet path | Stablecoin yield rotation is an Arc flagship use case, and a KYC-gated contract blocks it for everyone. |
| Ship an "Arc chain config" snippet for viem / wagmi / ethers | USDC-as-native-gas is novel, the config is non-obvious, and the failure mode is silent. One code block fixes it for good. |
| Host a minimal explorer or expose `debug_traceTransaction` | Debugging contracts blind is painful. Even tx hash to receipt and decoded logs would help. |
| Publish a stable faucet URL | Needed for judges replicating demos and for onboarding teammates mid-hackathon. |
| Publish a deployed-protocol list | One page of what is and isn't on testnet (Aave, USYC, others) so teams scope correctly. |

## Bottom line

The USDC-native design is the right bet, and we leaned into it on purpose. Almost all of
our friction was undocumented sharp edges and missing tooling, not anything structural.
Fix the filter persistence, document the getLogs cap, open a USYC testnet path, and ship
even a bare-bones explorer, and the Arc developer experience goes from "workable if you're
patient" to genuinely good. We'd build on Arc again.
