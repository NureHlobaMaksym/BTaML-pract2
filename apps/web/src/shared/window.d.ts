import type { EthereumProvider } from "./ethereum-provider";

declare global {
  interface Window { ethereum?: EthereumProvider; }
}
export {};
