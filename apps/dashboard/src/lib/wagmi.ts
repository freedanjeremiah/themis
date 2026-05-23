import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";

// Arc uses USDC as native gas — no ETH sourcing needed. Set PAYMASTER_URL in
// .env if your Arc deployment supports ERC-4337 Paymaster (currently optional).
export const arcTestnet = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
} as const;

export const wagmiConfig = createConfig({
  chains: [arcTestnet],
  connectors: [injected()],
  transports: { [arcTestnet.id]: http("https://rpc.testnet.arc.network") },
});
