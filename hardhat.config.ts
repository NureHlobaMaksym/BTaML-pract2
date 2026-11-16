import "dotenv/config";
import { defineConfig } from "hardhat/config";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
export default defineConfig({
  solidity: {
    version: "0.8.38",
    path: require.resolve("solc/soljson.js"),
    preferWasm: true,
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" }
  },
  networks: {
    default: { type: "edr-simulated", chainType: "l1", chainId: 31337 },
    localhost: { type: "http", chainType: "l1", url: process.env.RPC_URL || "http://127.0.0.1:8545", chainId: 31337 },
    sepolia: { type: "http", chainType: "l1", url: process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com", chainId: 11155111 }
  }
});
