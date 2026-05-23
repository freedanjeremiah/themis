import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
dotenv.config({ path: "../../.env" });

const config: HardhatUserConfig = {
  solidity: "0.8.24",
  networks: {
    arc: {
      url: process.env.ARC_RPC_URL ?? "",
      chainId: 5042002,
      accounts: process.env.PRIVATE_KEY_ALLOCATOR
        ? [process.env.PRIVATE_KEY_ALLOCATOR]
        : [],
    },
  },
};
export default config;
