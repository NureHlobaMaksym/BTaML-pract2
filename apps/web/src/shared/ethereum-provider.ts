import type { Eip1193Provider } from "ethers";

export interface EthereumProvider extends Eip1193Provider {
  on(event: string, listener: (...args: unknown[]) => void): void;
  removeListener(event: string, listener: (...args: unknown[]) => void): void;
}
